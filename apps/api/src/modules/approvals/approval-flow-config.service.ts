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
  FlowLinkDto,
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
        nodes: { include: { approver: true; condition: true } }
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
        await this.createGraph(tx, version.id, dto.createNodes, dto.createLinks)
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

    const originAdvanced = this.hasAdvancedGraph(origin)
    const explicitGraph = this.isExplicitGraph(dto.createNodes, dto.createLinks)
    if (originAdvanced && !explicitGraph) {
      throw new UnprocessableEntityException('当前流程包含条件分支，请使用高级流程设计器保存')
    }
    const existingNodes = this.approverInputs(origin)
    const nodeChanged = explicitGraph || !flowNodesEqual(existingNodes, dto.createNodes)

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
        await this.createGraph(tx, version.id, dto.createNodes, dto.createLinks)
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
            nodes: { include: { approver: true, condition: true }, orderBy: { sort: 'asc' } },
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
    if (
      formType === 'quotation' ||
      formType === 'contract' ||
      formType === 'invoice' ||
      formType === 'order'
    ) {
      if (!dto.createExecute && !dto.updateExecute && !dto.deleteExecute) {
        throw new UnprocessableEntityException('当前业务对象审批至少需要开启一种执行时机')
      }
    } else {
      if (!dto.createExecute) {
        throw new UnprocessableEntityException('当前业务对象至少需要开启新建时审批')
      }
      if (dto.updateExecute || dto.deleteExecute) {
        throw new UnprocessableEntityException('当前业务对象的编辑和删除审批尚未接入')
      }
    }
    if (dto.allowBatchProcess) {
      throw new UnprocessableEntityException('所选高级审批设置尚未接入运行时')
    }
    if (nodes.length > 100) throw new BadRequestException('审批节点不能超过 100 个')
    const explicitGraph = this.isExplicitGraph(nodes, dto.createLinks)
    for (const node of nodes) {
      if (!node.name.trim()) throw new BadRequestException('节点名称不能为空')
      const nodeType = node.nodeType ?? 'APPROVER'
      if (nodeType === 'CONDITION') this.validateConditionConfig(node)
      if (nodeType !== 'APPROVER') continue
      if (!node.approverType || !node.mode) {
        throw new BadRequestException(`节点「${node.name}」缺少审批人类型或多人审批方式`)
      }
      if (
        (node.approverType === 'USER' || node.approverType === 'ROLE') &&
        (node.approverIds?.length ?? 0) === 0
      ) {
        throw new BadRequestException(`节点「${node.name}」必须选择审批对象`)
      }
      const hierarchyType = [
        'DIRECT_LEADER',
        'DEPT_LEADER',
        'MULTIPLE_DIRECT_LEADER',
        'MULTIPLE_DEPT_LEADER',
      ].includes(node.approverType)
      if (hierarchyType && node.approverIds?.length) {
        const level = Number(node.approverIds[0])
        if (!Number.isInteger(level) || level < 1 || level > 10) {
          throw new BadRequestException(`节点「${node.name}」的审批层级必须为 1~10`)
        }
      }
      const emptyAction = node.emptyApproverAction ?? 'AUTO_PASS'
      if (emptyAction !== 'AUTO_PASS' && !node.fallbackApprover?.trim()) {
        throw new BadRequestException(`节点「${node.name}」必须配置空审批人兜底人员`)
      }
    }
    if (explicitGraph) this.validateGraph(nodes, dto.createLinks ?? [])
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
    const hasExecuteTiming = createExecute || updateExecute || deleteExecute
    const hasApprover = nodes.some((node) => (node.nodeType ?? 'APPROVER') === 'APPROVER')
    if (!hasExecuteTiming || !hasApprover) {
      throw new ConflictException('启用的流程至少需要一个审批执行时机和有效审批节点')
    }
  }

  private async validateReferences(tenantId: string, nodes: FlowNodeDto[]) {
    const userIds = [
      ...new Set(
        nodes
          .filter((node) => (node.nodeType ?? 'APPROVER') === 'APPROVER')
          .flatMap((node) => [
            ...(node.approverType === 'USER' ? (node.approverIds ?? []) : []),
            ...(node.ccUserIds ?? []),
            ...(node.fallbackApprover?.trim() ? [node.fallbackApprover.trim()] : []),
          ]),
      ),
    ]
    const roleIds = [
      ...new Set(
        nodes
          .filter(
            (node) =>
              (node.nodeType ?? 'APPROVER') === 'APPROVER' && node.approverType === 'ROLE',
          )
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

  private validateConditionConfig(node: FlowNodeDto) {
    const config = node.conditionConfig
    if (!config || !['AND', 'OR'].includes(config.searchMode) || config.conditions.length === 0) {
      throw new BadRequestException(`条件节点「${node.name}」至少需要一个有效条件`)
    }
    for (const condition of config.conditions) {
      if (!condition.name?.trim() || !condition.operator) {
        throw new BadRequestException(`条件节点「${node.name}」存在无效条件`)
      }
      if (['EMPTY', 'NOT_EMPTY', 'NOT_EQUAL_ORIGINAL'].includes(condition.operator)) continue
      const value = condition.value
      if (
        value === undefined ||
        value === null ||
        (typeof value === 'string' && !value.trim()) ||
        (Array.isArray(value) && value.length === 0)
      ) {
        throw new BadRequestException(`条件节点「${node.name}」存在缺少比较值的条件`)
      }
    }
  }

  private isExplicitGraph(nodes: FlowNodeDto[], links?: FlowLinkDto[]) {
    return (
      links !== undefined ||
      nodes.some((node) => node.nodeType !== undefined && node.nodeType !== 'APPROVER')
    )
  }

  private hasAdvancedGraph(flow: FlowDetailRecord) {
    return Boolean(flow.currentVersion?.nodes.some(
      (node) => node.nodeType === ApprovalNodeType.CONDITION || node.nodeType === ApprovalNodeType.DEFAULT,
    ))
  }

  private validateGraph(nodes: FlowNodeDto[], links: FlowLinkDto[]) {
    const nodeIds = nodes.map((node) => node.clientId?.trim() || '')
    if (nodeIds.some((id) => !id)) {
      throw new BadRequestException('高级流程图的每个节点都必须提供稳定 clientId')
    }
    if (new Set(nodeIds).size !== nodeIds.length) {
      throw new BadRequestException('高级流程图存在重复节点 clientId')
    }
    const nodeMap = new Map(nodes.map((node) => [node.clientId!, node]))
    const starts = nodes.filter((node) => node.nodeType === 'START')
    const ends = nodes.filter((node) => node.nodeType === 'END')
    if (starts.length !== 1 || ends.length !== 1) {
      throw new BadRequestException('高级流程图必须且只能包含一个 START 和一个 END')
    }
    if (!nodes.some((node) => node.nodeType === 'APPROVER')) {
      throw new BadRequestException('高级流程图至少需要一个 APPROVER 节点')
    }
    if (!links.length) throw new BadRequestException('高级流程图必须包含节点连接')

    const pairKeys = new Set<string>()
    const outgoing = new Map<string, FlowLinkDto[]>()
    const incoming = new Map<string, FlowLinkDto[]>()
    for (const [index, link] of links.entries()) {
      if (!nodeMap.has(link.fromNodeId) || !nodeMap.has(link.toNodeId)) {
        throw new BadRequestException('高级流程图存在指向未知节点的连接')
      }
      if (link.fromNodeId === link.toNodeId) throw new BadRequestException('高级流程图不允许节点自环')
      const pairKey = `${link.fromNodeId}\u0000${link.toNodeId}`
      if (pairKeys.has(pairKey)) throw new BadRequestException('高级流程图存在重复连接')
      pairKeys.add(pairKey)
      const normalized = { ...link, sort: link.sort ?? index }
      outgoing.set(link.fromNodeId, [...(outgoing.get(link.fromNodeId) ?? []), normalized])
      incoming.set(link.toNodeId, [...(incoming.get(link.toNodeId) ?? []), normalized])
    }

    const startId = starts[0].clientId!
    const endId = ends[0].clientId!
    for (const node of nodes) {
      const id = node.clientId!
      const next = [...(outgoing.get(id) ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
      const prev = incoming.get(id) ?? []
      if (id === startId && prev.length) throw new BadRequestException('START 节点不能存在入边')
      if (id !== startId && prev.length === 0) throw new BadRequestException(`节点「${node.name}」缺少入边`)
      if (id === endId && next.length) throw new BadRequestException('END 节点不能存在出边')
      if (id !== endId && next.length === 0) throw new BadRequestException(`节点「${node.name}」缺少出边`)
      if (id === endId) continue

      const targetTypes = next.map((link) => nodeMap.get(link.toNodeId)!.nodeType ?? 'APPROVER')
      const hasConditionBranch = targetTypes.some((type) => type === 'CONDITION')
      if (hasConditionBranch) {
        if (targetTypes.some((type) => type !== 'CONDITION' && type !== 'DEFAULT')) {
          throw new BadRequestException('条件分支的同层后继只能是 CONDITION / DEFAULT')
        }
        if (targetTypes.filter((type) => type === 'DEFAULT').length !== 1) {
          throw new BadRequestException('条件分支必须且只能包含一个 DEFAULT')
        }
        const sorts = next.map((link) => link.sort ?? 0)
        if (new Set(sorts).size !== sorts.length) {
          throw new BadRequestException('同一条件分支下的 link.sort 必须唯一')
        }
      } else if (targetTypes.some((type) => type === 'DEFAULT')) {
        throw new BadRequestException('DEFAULT 必须与至少一个 CONDITION 同层出现')
      } else if (next.length !== 1) {
        throw new BadRequestException(`节点「${node.name}」存在不受支持的并行后继`)
      }
    }

    const visited = new Set<string>()
    const active = new Set<string>()
    const walk = (id: string) => {
      if (active.has(id)) throw new BadRequestException('高级流程图不允许循环连接')
      if (visited.has(id)) return
      active.add(id)
      for (const link of outgoing.get(id) ?? []) walk(link.toNodeId)
      active.delete(id)
      visited.add(id)
    }
    walk(startId)
    if (visited.size !== nodes.length) throw new BadRequestException('高级流程图存在 START 不可达节点')

    const reachesEnd = new Set<string>()
    const reverseWalk = (id: string) => {
      if (reachesEnd.has(id)) return
      reachesEnd.add(id)
      for (const link of incoming.get(id) ?? []) reverseWalk(link.fromNodeId)
    }
    reverseWalk(endId)
    if (reachesEnd.size !== nodes.length) throw new BadRequestException('高级流程图存在无法到达 END 的节点')
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

  private async createGraph(
    tx: Prisma.TransactionClient,
    flowVersionId: string,
    inputNodes: FlowNodeDto[],
    inputLinks?: FlowLinkDto[],
  ) {
    if (!this.isExplicitGraph(inputNodes, inputLinks)) {
      await this.createLinearGraph(tx, flowVersionId, inputNodes)
      return
    }

    const idMap = new Map<string, string>()
    for (const [index, node] of inputNodes.entries()) {
      idMap.set(node.clientId!, randomUUID())
      const nodeType = node.nodeType ?? 'APPROVER'
      const id = idMap.get(node.clientId!)!
      await tx.approvalNode.create({
        data: {
          id,
          flowVersionId,
          number: node.number?.trim() || `PN${String(index + 1).padStart(3, '0')}`,
          name: node.name.trim(),
          nodeType: nodeType as ApprovalNodeType,
          executeTiming: ApprovalExecuteTiming.CREATE,
          sort: index,
        },
      })
      if (nodeType === 'APPROVER') {
        await tx.approvalNodeApprover.create({
          data: {
            nodeId: id,
            approverType: node.approverType!,
            approverIds: node.approverIds ?? [],
            ccUserIds: node.ccUserIds ?? [],
            mode: node.mode!,
            emptyApproverAction: node.emptyApproverAction ?? 'AUTO_PASS',
            fallbackApprover: node.fallbackApprover?.trim() || null,
            sameSubmitterAction: node.sameSubmitterAction ?? 'SKIP',
            approverDirection: node.approverDirection ?? 'BOTTOM_UP',
          },
        })
      } else if (nodeType === 'CONDITION') {
        await tx.approvalNodeCondition.create({
          data: {
            id,
            flowVersionId,
            conditionConfig: node.conditionConfig as unknown as Prisma.InputJsonValue,
          },
        })
      }
    }

    await tx.approvalNodeLink.createMany({
      data: (inputLinks ?? []).map((link, index) => ({
        id: randomUUID(),
        flowVersionId,
        fromNodeId: idMap.get(link.fromNodeId)!,
        toNodeId: idMap.get(link.toNodeId)!,
        sort: link.sort ?? index,
      })),
    })
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
              emptyApproverAction: node.emptyApproverAction ?? 'AUTO_PASS',
              fallbackApprover: node.fallbackApprover ?? null,
              sameSubmitterAction: node.sameSubmitterAction ?? 'SKIP',
              approverDirection: node.approverDirection ?? 'BOTTOM_UP',
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
        emptyApproverAction: node.approver!.emptyApproverAction,
        fallbackApprover: node.approver!.fallbackApprover,
        sameSubmitterAction: node.approver!.sameSubmitterAction,
        approverDirection: node.approver!.approverDirection,
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
      runtimeReady: true,
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
        emptyApproverAction: node.approver?.emptyApproverAction,
        fallbackApprover: node.approver?.fallbackApprover,
        sameSubmitterAction: node.approver?.sameSubmitterAction,
        approverDirection: node.approver?.approverDirection,
        conditionConfig: node.condition?.conditionConfig as ApprovalFlowDetail['createNodes'][number]['conditionConfig'],
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
        where: { organizationId: tenantId, id: { in: contractIds } },
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
