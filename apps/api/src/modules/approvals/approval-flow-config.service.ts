import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type {
  ApprovalFlowDetail,
  ApprovalFlowListItem,
  ApprovalFlowNodeInput,
  ApprovalFormType as SharedApprovalFormType,
  PaginatedResult,
} from '@micromatrix/shared'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../../common/auth-user'
import {
  ApprovalExecuteTiming,
  ApprovalFlow,
  ApprovalFormType,
  ApprovalNodeType,
  Prisma,
} from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ApprovalFlowPageQueryDto,
  CreateApprovalFlowDto,
  FlowNodeDto,
  UpdateApprovalFlowDto,
} from './dto/approval.dto'
import {
  flowNodesEqual,
  FORM_TYPE_PREFIX,
  fromDbFormType,
  normalizeFlowNodes,
  toDbFormType,
} from './approval-flow-config.utils'

type FlowListRecord = Prisma.ApprovalFlowGetPayload<{
  include: { currentVersion: { select: { version: true } } }
}>

type FlowDetailRecord = Prisma.ApprovalFlowGetPayload<{
  include: {
    currentVersion: {
      include: {
        nodes: { include: { approver: true } }
        links: true
      }
    }
  }
}>

@Injectable()
export class ApprovalFlowConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    user: AuthUser,
    query: ApprovalFlowPageQueryDto,
  ): Promise<PaginatedResult<ApprovalFlowListItem>> {
    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 10
    const where: Prisma.ApprovalFlowWhereInput = {
      tenantId: user.tenantId,
      deletedAt: null,
      formType: { not: ApprovalFormType.RECEIVABLE_RECORD_LEGACY },
      ...(query.keyword?.trim()
        ? {
            OR: [
              { number: { contains: query.keyword.trim(), mode: 'insensitive' as const } },
              { name: { contains: query.keyword.trim(), mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...(query.formType ? { formType: toDbFormType(query.formType) } : {}),
      ...(query.enabled ? { enabled: query.enabled === 'true' } : {}),
    }
    const sortBy = query.sortBy ?? 'updatedAt'
    const sortOrder = query.sortOrder ?? 'desc'

    const [flows, total] = await this.prisma.$transaction([
      this.prisma.approvalFlow.findMany({
        where,
        include: { currentVersion: { select: { version: true } } },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.approvalFlow.count({ where }),
    ])
    const userNames = await this.loadUserNames(flows)
    return {
      items: flows.map((flow) => this.toListItem(flow, userNames)),
      total,
      page,
      pageSize,
    }
  }

  async detail(user: AuthUser, id: string): Promise<ApprovalFlowDetail> {
    const flow = await this.getFlowDetail(user.tenantId, id)
    const userNames = await this.loadUserNames([flow])
    return this.toDetail(flow, userNames)
  }

  async create(user: AuthUser, dto: CreateApprovalFlowDto): Promise<ApprovalFlowDetail> {
    const formType = dto.formType as SharedApprovalFormType
    await this.validateWrite(user, formType, dto, dto.createNodes)

    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const number = await this.nextFlowNumber(tx, user.tenantId, formType)
        const flow = await tx.approvalFlow.create({
          data: {
            tenantId: user.tenantId,
            number,
            formType: toDbFormType(formType),
            currentVersionId: null,
            ...this.mainFields(dto, user.id),
          },
        })
        const version = await tx.approvalFlowVersion.create({
          data: {
            flowId: flow.id,
            tenantId: user.tenantId,
            version: 1,
            createdById: user.id,
          },
        })
        await this.createLinearGraph(tx, version.id, dto.createNodes)
        await tx.approvalFlow.update({
          where: { id: flow.id },
          data: { currentVersionId: version.id },
        })
        return flow.id
      })
      return this.detail(user, id)
    } catch (error) {
      if (this.isUniqueError(error)) {
        throw new ConflictException('该表单类型已存在流程')
      }
      throw error
    }
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateApprovalFlowDto,
  ): Promise<ApprovalFlowDetail> {
    const origin = await this.getFlowDetail(user.tenantId, id)
    const formType = fromDbFormType(origin.formType)
    if (!formType) throw new NotFoundException('流程不存在')
    await this.validateWrite(user, formType, dto, dto.createNodes)

    const existingNodes = this.approverInputs(origin)
    const nodeChanged = !flowNodesEqual(existingNodes, dto.createNodes)

    await this.prisma.$transaction(async (tx) => {
      let currentVersionId = origin.currentVersionId
      if (nodeChanged) {
        const latest = await tx.approvalFlowVersion.aggregate({
          where: { flowId: id },
          _max: { version: true },
        })
        const version = await tx.approvalFlowVersion.create({
          data: {
            flowId: id,
            tenantId: user.tenantId,
            version: (latest._max.version ?? 0) + 1,
            createdById: user.id,
          },
        })
        await this.createLinearGraph(tx, version.id, dto.createNodes)
        currentVersionId = version.id
      }
      await tx.approvalFlow.update({
        where: { id },
        data: {
          ...this.mainFields(dto, user.id),
          currentVersionId,
        },
      })
    })
    return this.detail(user, id)
  }

  async updateEnabled(user: AuthUser, id: string, enabled: boolean) {
    const flow = await this.getFlowDetail(user.tenantId, id)
    const formType = fromDbFormType(flow.formType)
    if (!formType) throw new NotFoundException('流程不存在')
    if (enabled) {
      await this.validateRunnable(
        formType,
        flow.createExecute,
        flow.updateExecute,
        flow.deleteExecute,
        this.approverInputs(flow),
      )
    }
    await this.prisma.approvalFlow.update({
      where: { id },
      data: { enabled, updatedById: user.id },
    })
    return { id, name: flow.name }
  }

  async remove(user: AuthUser, id: string) {
    const flow = await this.getFlowDetail(user.tenantId, id)
    if (flow.enabled) throw new ConflictException('启用中的流程不能删除，请先停用')

    const instances = await this.prisma.approvalInstance.findMany({
      where: { tenantId: user.tenantId, flowId: id, status: 'PENDING' },
      select: { id: true, module: true, targetId: true },
    })
    const instanceIds = instances.map((instance) => instance.id)

    await this.prisma.$transaction(async (tx) => {
      await tx.approvalFlow.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: user.id },
      })
      if (instanceIds.length > 0) {
        await tx.approvalTask.updateMany({
          where: { instanceId: { in: instanceIds }, status: 'PENDING' },
          data: { status: 'SKIPPED' },
        })
        await tx.approvalInstance.updateMany({
          where: { id: { in: instanceIds } },
          data: { status: 'CANCELED', finishedAt: new Date() },
        })
        await this.resetBusinessStatuses(tx, user.tenantId, instances)
      }
    })
    return { id, name: flow.name }
  }

  private async getFlowDetail(tenantId: string, id: string): Promise<FlowDetailRecord> {
    const flow = await this.prisma.approvalFlow.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
        formType: { not: ApprovalFormType.RECEIVABLE_RECORD_LEGACY },
      },
      include: {
        currentVersion: {
          include: {
            nodes: { include: { approver: true }, orderBy: { sort: 'asc' } },
            links: { orderBy: { sort: 'asc' } },
          },
        },
      },
    })
    if (!flow?.currentVersion) throw new NotFoundException('流程不存在')
    return flow
  }

  private async validateWrite(
    user: AuthUser,
    formType: SharedApprovalFormType,
    dto: CreateApprovalFlowDto | UpdateApprovalFlowDto,
    nodes: FlowNodeDto[],
  ) {
    if (!dto.name.trim()) throw new BadRequestException('流程名称不能为空')
    if (formType === 'quotation') {
      if (!dto.createExecute && !dto.updateExecute && !dto.deleteExecute) {
        throw new UnprocessableEntityException('报价审批至少需要开启一种执行时机')
      }
    } else {
      if (!dto.createExecute) {
        throw new UnprocessableEntityException('当前业务对象至少需要开启新建时审批')
      }
      if (dto.updateExecute || dto.deleteExecute) {
        throw new UnprocessableEntityException('当前业务对象的编辑和删除审批尚未接入')
      }
    }
    if (
      dto.allowBatchProcess ||
      dto.allowWithdraw ||
      dto.allowAddSign ||
      dto.duplicateApproverRule !== 'FIRST_ONLY' ||
      dto.requireComment
    ) {
      throw new UnprocessableEntityException('所选高级审批设置尚未接入运行时')
    }
    if (nodes.length > 100) throw new BadRequestException('审批节点不能超过 100 个')
    for (const node of nodes) {
      if (!node.name.trim()) throw new BadRequestException('节点名称不能为空')
      if (
        (node.approverType === 'USER' || node.approverType === 'ROLE') &&
        (node.approverIds?.length ?? 0) === 0
      ) {
        throw new BadRequestException(`节点「${node.name}」必须选择审批对象`)
      }
    }
    await this.validateReferences(user.tenantId, nodes)
    if (dto.enabled) {
      await this.validateRunnable(
        formType,
        dto.createExecute,
        dto.updateExecute,
        dto.deleteExecute,
        nodes,
      )
    }
  }

  private async validateRunnable(
    formType: SharedApprovalFormType,
    createExecute: boolean,
    updateExecute: boolean,
    deleteExecute: boolean,
    nodes: Array<ApprovalFlowNodeInput | FlowNodeDto>,
  ) {
    if (formType === 'invoice') {
      throw new ConflictException('发票审批业务链路尚未接入，当前流程只能保持停用')
    }
    const hasExecuteTiming =
      formType === 'quotation'
        ? createExecute || updateExecute || deleteExecute
        : createExecute
    if (!hasExecuteTiming || nodes.length === 0) {
      throw new ConflictException('启用的流程至少需要一个审批执行时机和有效审批节点')
    }
  }

  private async validateReferences(tenantId: string, nodes: FlowNodeDto[]) {
    const userIds = [
      ...new Set(
        nodes.flatMap((node) => [
          ...(node.approverType === 'USER' ? (node.approverIds ?? []) : []),
          ...(node.ccUserIds ?? []),
        ]),
      ),
    ]
    const roleIds = [
      ...new Set(
        nodes
          .filter((node) => node.approverType === 'ROLE')
          .flatMap((node) => node.approverIds ?? []),
      ),
    ]
    const [userCount, roleCount] = await Promise.all([
      userIds.length
        ? this.prisma.user.count({
            where: { id: { in: userIds }, tenantId, status: 'ACTIVE' },
          })
        : 0,
      roleIds.length ? this.prisma.role.count({ where: { id: { in: roleIds }, tenantId } }) : 0,
    ])
    if (userCount !== userIds.length) throw new BadRequestException('存在无效或跨租户审批成员')
    if (roleCount !== roleIds.length) throw new BadRequestException('存在无效或跨租户审批角色')
  }

  private mainFields(dto: CreateApprovalFlowDto | UpdateApprovalFlowDto, userId: string) {
    return {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      enabled: dto.enabled,
      createExecute: dto.createExecute,
      updateExecute: dto.updateExecute,
      deleteExecute: dto.deleteExecute,
      submitterCanRevoke: dto.submitterCanRevoke,
      allowBatchProcess: dto.allowBatchProcess,
      allowWithdraw: dto.allowWithdraw,
      allowAddSign: dto.allowAddSign,
      duplicateApproverRule: dto.duplicateApproverRule,
      requireComment: dto.requireComment,
      condition: dto.condition
        ? ({ amountGte: dto.condition.amountGte } as Prisma.InputJsonValue)
        : Prisma.DbNull,
      updatedById: userId,
      ...('formType' in dto ? { createdById: userId } : {}),
    }
  }

  private async nextFlowNumber(
    tx: Prisma.TransactionClient,
    tenantId: string,
    formType: SharedApprovalFormType,
  ) {
    const counter = await tx.approvalFlowNumberCounter.upsert({
      where: { tenantId_formType: { tenantId, formType: toDbFormType(formType) } },
      update: { nextValue: { increment: 1 } },
      create: { tenantId, formType: toDbFormType(formType), nextValue: 2 },
    })
    return `${FORM_TYPE_PREFIX[formType]}-${String(counter.nextValue - 1).padStart(5, '0')}`
  }

  private async createLinearGraph(
    tx: Prisma.TransactionClient,
    flowVersionId: string,
    inputNodes: FlowNodeDto[],
  ) {
    const nodes = normalizeFlowNodes(inputNodes)
    const startId = randomUUID()
    const endId = randomUUID()
    const approverIds = nodes.map(() => randomUUID())
    await tx.approvalNode.create({
      data: {
        id: startId,
        flowVersionId,
        number: 'PN001',
        name: '开始',
        nodeType: ApprovalNodeType.START,
        executeTiming: ApprovalExecuteTiming.CREATE,
        sort: 0,
      },
    })
    for (const [index, node] of nodes.entries()) {
      await tx.approvalNode.create({
        data: {
          id: approverIds[index],
          flowVersionId,
          number: `PN${String(index + 2).padStart(3, '0')}`,
          name: node.name,
          nodeType: ApprovalNodeType.APPROVER,
          executeTiming: ApprovalExecuteTiming.CREATE,
          sort: index + 1,
          approver: {
            create: {
              approverType: node.approverType,
              approverIds: node.approverIds,
              ccUserIds: node.ccUserIds ?? [],
              mode: node.mode,
            },
          },
        },
      })
    }
    await tx.approvalNode.create({
      data: {
        id: endId,
        flowVersionId,
        number: `PN${String(nodes.length + 2).padStart(3, '0')}`,
        name: '结束',
        nodeType: ApprovalNodeType.END,
        executeTiming: ApprovalExecuteTiming.CREATE,
        sort: nodes.length + 1,
      },
    })

    const orderedIds = [startId, ...approverIds, endId]
    await tx.approvalNodeLink.createMany({
      data: orderedIds.slice(1).map((toNodeId, index) => ({
        id: randomUUID(),
        flowVersionId,
        fromNodeId: orderedIds[index],
        toNodeId,
        sort: index,
      })),
    })
  }

  private approverInputs(flow: FlowDetailRecord): ApprovalFlowNodeInput[] {
    return (flow.currentVersion?.nodes ?? [])
      .filter((node) => node.nodeType === ApprovalNodeType.APPROVER && node.approver)
      .map((node) => ({
        name: node.name,
        approverType: node.approver!.approverType,
        approverIds: node.approver!.approverIds,
        ccUserIds: node.approver!.ccUserIds,
        mode: node.approver!.mode,
      }))
  }

  private async loadUserNames(flows: Array<Pick<ApprovalFlow, 'createdById' | 'updatedById'>>) {
    const ids = [
      ...new Set(
        flows
          .flatMap((flow) => [flow.createdById, flow.updatedById])
          .filter((id): id is string => !!id),
      ),
    ]
    if (ids.length === 0) return new Map<string, string>()
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(users.map((member) => [member.id, member.name]))
  }

  private toListItem(flow: FlowListRecord, userNames: Map<string, string>): ApprovalFlowListItem {
    const formType = fromDbFormType(flow.formType)
    if (!formType) throw new NotFoundException('流程类型不受支持')
    return {
      id: flow.id,
      number: flow.number,
      formType,
      name: flow.name,
      description: flow.description,
      enabled: flow.enabled,
      createExecute: flow.createExecute,
      updateExecute: flow.updateExecute,
      deleteExecute: flow.deleteExecute,
      submitterCanRevoke: flow.submitterCanRevoke,
      allowBatchProcess: flow.allowBatchProcess,
      allowWithdraw: flow.allowWithdraw,
      allowAddSign: flow.allowAddSign,
      duplicateApproverRule: flow.duplicateApproverRule,
      requireComment: flow.requireComment,
      currentVersion: flow.currentVersion?.version ?? 0,
      runtimeReady: formType !== 'invoice',
      createdById: flow.createdById,
      createdByName: flow.createdById ? (userNames.get(flow.createdById) ?? null) : null,
      updatedById: flow.updatedById,
      updatedByName: flow.updatedById ? (userNames.get(flow.updatedById) ?? null) : null,
      createdAt: flow.createdAt.toISOString(),
      updatedAt: flow.updatedAt.toISOString(),
    }
  }

  private toDetail(flow: FlowDetailRecord, userNames: Map<string, string>): ApprovalFlowDetail {
    if (!flow.currentVersion) throw new NotFoundException('流程版本不存在')
    return {
      ...this.toListItem(flow, userNames),
      currentVersionId: flow.currentVersion.id,
      condition: flow.condition as { amountGte?: number } | null,
      createNodes: flow.currentVersion.nodes.map((node) => ({
        id: node.id,
        number: node.number,
        name: node.name,
        nodeType: node.nodeType,
        executeTiming: node.executeTiming,
        sort: node.sort,
        approverType: node.approver?.approverType,
        approverIds: node.approver?.approverIds,
        ccUserIds: node.approver?.ccUserIds,
        mode: node.approver?.mode,
      })),
      createLinks: flow.currentVersion.links.map((link) => ({
        id: link.id,
        fromNodeId: link.fromNodeId,
        toNodeId: link.toNodeId,
        sort: link.sort,
      })),
    }
  }

  private async resetBusinessStatuses(
    tx: Prisma.TransactionClient,
    tenantId: string,
    instances: Array<{ module: string; targetId: string }>,
  ) {
    const quoteIds = instances
      .filter((item) => item.module === 'quote')
      .map((item) => item.targetId)
    const contractIds = instances
      .filter((item) => item.module === 'contract')
      .map((item) => item.targetId)
    const orderIds = instances
      .filter((item) => item.module === 'order')
      .map((item) => item.targetId)
    if (quoteIds.length) {
      await tx.opportunityQuotation.updateMany({
        where: { organizationId: tenantId, id: { in: quoteIds } },
        data: { approvalStatus: 'NONE' },
      })
    }
    if (contractIds.length) {
      await tx.contract.updateMany({
        where: { tenantId, id: { in: contractIds } },
        data: { approvalStatus: 'NONE' },
      })
    }
    if (orderIds.length) {
      await tx.order.updateMany({
        where: { tenantId, id: { in: orderIds } },
        data: { approvalStatus: 'NONE' },
      })
    }
  }

  private isUniqueError(error: unknown): error is Prisma.PrismaClientKnownRequestError {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }
}
