import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type {
  ApprovalFieldPermission,
  ApprovalFlowDetail,
  ApprovalFlowListItem,
  ApprovalFlowNodeInput,
  ApprovalFormType as SharedApprovalFormType,
  ApprovalPostConfig,
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
import { ModuleFormsService } from '../metadata/module-forms.service'
import {
  APPROVAL_FORM_METADATA_KEY,
  isApprovalEditableField,
} from './approval-field-permission.utils'
import {
  ApprovalWebhookConfigError,
  normalizeApprovalWebhookConfig,
  validateApprovalWebhookConfig,
} from './approval-webhook.utils'
import {
  ApprovalFlowPageQueryDto,
  CreateApprovalFlowDto,
  FlowLinkDto,
  FlowNodeDto,
  UpdateApprovalFlowDto,
} from './dto/approval.dto'
import {
  FORM_TYPE_PREFIX,
  fromDbFormType,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleForms: ModuleFormsService,
  ) {}

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

    const nodeChanged = this.graphChanged(origin, dto.createNodes, dto.createLinks)

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
    await this.validateFieldPermissions(user.tenantId, formType, nodes)
    this.validateGraph(nodes, dto.createLinks)
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

  private async validateFieldPermissions(
    tenantId: string,
    formType: SharedApprovalFormType,
    nodes: FlowNodeDto[],
  ) {
    const approverNodes = nodes.filter((node) =>
      (node.nodeType ?? 'APPROVER') === 'APPROVER' && (
        (node.fieldPermissions?.length ?? 0) > 0 ||
        (node.passPostConfig?.fieldUpdateConfigs.length ?? 0) > 0 ||
        (node.rejectPostConfig?.fieldUpdateConfigs.length ?? 0) > 0 ||
        Boolean(node.passPostConfig?.webHookConfig) ||
        Boolean(node.rejectPostConfig?.webHookConfig)
      ),
    )
    if (!approverNodes.length) return

    const fields = await this.moduleForms.listFields(tenantId, APPROVAL_FORM_METADATA_KEY[formType])
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    for (const node of approverNodes) {
      const permissions = node.fieldPermissions ?? []
      const fieldIds = permissions.map((permission) => permission.fieldId.trim())
      if (fieldIds.some((fieldId) => !fieldId)) {
        throw new BadRequestException(`节点「${node.name}」存在空字段权限引用`)
      }
      if (new Set(fieldIds).size !== fieldIds.length) {
        throw new BadRequestException(`节点「${node.name}」存在重复字段权限`)
      }
      for (const permission of permissions) {
        const fieldId = permission.fieldId.trim()
        const field = fieldMap.get(fieldId)
        if (!field) {
          throw new BadRequestException(`节点「${node.name}」存在无效字段权限引用`)
        }
        if (field.hidden && permission.permissionType !== 'HIDDEN') {
          throw new BadRequestException(`字段「${field.label}」在当前表单中不可见，只能配置为隐藏`)
        }
        if (permission.permissionType === 'EDIT' && !isApprovalEditableField(formType, field)) {
          throw new BadRequestException(`字段「${field.label}」不支持审批中编辑`)
        }
      }
      for (const [actionName, config] of [
        ['通过后', node.passPostConfig],
        ['驳回后', node.rejectPostConfig],
      ] as const) {
        try {
          validateApprovalWebhookConfig(config?.webHookConfig)
        } catch (error) {
          if (error instanceof ApprovalWebhookConfigError) {
            throw new BadRequestException(`节点「${node.name}」${actionName}${error.message}`)
          }
          throw error
        }
        const updates = config?.fieldUpdateConfigs ?? []
        const updateFieldIds = updates.map((item) => item.fieldId.trim())
        if (updateFieldIds.some((fieldId) => !fieldId)) {
          throw new BadRequestException(`节点「${node.name}」${actionName}存在空字段引用`)
        }
        if (new Set(updateFieldIds).size !== updateFieldIds.length) {
          throw new BadRequestException(`节点「${node.name}」${actionName}存在重复字段更新`)
        }
        for (const update of updates) {
          const field = fieldMap.get(update.fieldId.trim())
          if (!field) {
            throw new BadRequestException(`节点「${node.name}」${actionName}存在无效字段引用`)
          }
          if (!update.enable) continue
          if (update.fieldValue === undefined || update.fieldValue === null) {
            throw new BadRequestException(`字段「${field.label}」${actionName}更新值不能为空`)
          }
          if (!isApprovalEditableField(formType, field)) {
            throw new BadRequestException(`字段「${field.label}」不支持审批后置更新`)
          }
        }
      }
    }
  }

  private postConfigJson(config: FlowNodeDto['passPostConfig']) {
    if (!config) return Prisma.DbNull
    const webHookConfig = normalizeApprovalWebhookConfig(config.webHookConfig)
    if (!config.fieldUpdateConfigs.length && !webHookConfig) return Prisma.DbNull
    return {
      fieldUpdateConfigs: config.fieldUpdateConfigs.map((item) => ({
        fieldId: item.fieldId.trim(),
        fieldValue: item.fieldValue ?? null,
        enable: item.enable,
      })),
      ...(webHookConfig ? { webHookConfig } : {}),
    } as unknown as Prisma.InputJsonValue
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
    inputLinks: FlowLinkDto[],
  ) {
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
            fieldPermissions: node.fieldPermissions?.length
              ? (node.fieldPermissions.map((permission) => ({
                  fieldId: permission.fieldId.trim(),
                  permissionType: permission.permissionType,
                })) as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            passPostConfig: this.postConfigJson(node.passPostConfig),
            rejectPostConfig: this.postConfigJson(node.rejectPostConfig),
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
      data: inputLinks.map((link, index) => ({
        id: randomUUID(),
        flowVersionId,
        fromNodeId: idMap.get(link.fromNodeId)!,
        toNodeId: idMap.get(link.toNodeId)!,
        sort: link.sort ?? index,
      })),
    })
  }

  private graphChanged(
    flow: FlowDetailRecord,
    inputNodes: FlowNodeDto[],
    inputLinks: FlowLinkDto[],
  ) {
    const existingNodes: FlowNodeDto[] = (flow.currentVersion?.nodes ?? []).map((node) => ({
      clientId: node.id,
      nodeType: node.nodeType,
      number: node.number,
      name: node.name,
      approverType: node.approver?.approverType,
      approverIds: node.approver?.approverIds ?? [],
      ccUserIds: node.approver?.ccUserIds ?? [],
      mode: node.approver?.mode,
      emptyApproverAction: node.approver?.emptyApproverAction,
      fallbackApprover: node.approver?.fallbackApprover,
      sameSubmitterAction: node.approver?.sameSubmitterAction,
      approverDirection: node.approver?.approverDirection,
      fieldPermissions:
        (node.approver?.fieldPermissions as unknown as ApprovalFieldPermission[] | null) ?? [],
      passPostConfig:
        (node.approver?.passPostConfig as unknown as ApprovalPostConfig | null) ?? undefined,
      rejectPostConfig:
        (node.approver?.rejectPostConfig as unknown as ApprovalPostConfig | null) ?? undefined,
      conditionConfig:
        (node.condition?.conditionConfig as unknown as FlowNodeDto['conditionConfig']) ?? undefined,
    }))
    const existingLinks: FlowLinkDto[] = (flow.currentVersion?.links ?? []).map((link) => ({
      fromNodeId: link.fromNodeId,
      toNodeId: link.toNodeId,
      sort: link.sort,
    }))
    return (
      JSON.stringify(this.canonicalGraph(existingNodes, existingLinks)) !==
      JSON.stringify(this.canonicalGraph(inputNodes, inputLinks))
    )
  }

  private canonicalGraph(nodes: FlowNodeDto[], links: FlowLinkDto[]) {
    const canonicalNodes = nodes
      .map((node) => {
        const nodeType = node.nodeType ?? 'APPROVER'
        const base: Record<string, unknown> = {
          clientId: node.clientId?.trim() || '',
          nodeType,
          name: node.name.trim(),
        }
        if (nodeType === 'APPROVER') {
          base.approverType = node.approverType
          base.approverIds = [...(node.approverIds ?? [])].sort()
          base.ccUserIds = [...(node.ccUserIds ?? [])].sort()
          base.mode = node.mode
          base.emptyApproverAction = node.emptyApproverAction ?? 'AUTO_PASS'
          base.fallbackApprover = node.fallbackApprover?.trim() || null
          base.sameSubmitterAction = node.sameSubmitterAction ?? 'SKIP'
          base.approverDirection = node.approverDirection ?? 'BOTTOM_UP'
          base.fieldPermissions = [...(node.fieldPermissions ?? [])]
            .map((item) => ({ fieldId: item.fieldId.trim(), permissionType: item.permissionType }))
            .sort((left, right) => left.fieldId.localeCompare(right.fieldId))
          base.passPostConfig = this.canonicalPostConfig(node.passPostConfig)
          base.rejectPostConfig = this.canonicalPostConfig(node.rejectPostConfig)
        } else if (nodeType === 'CONDITION') {
          base.conditionConfig = this.stableJson(node.conditionConfig ?? null)
        }
        return base
      })
      .sort((left, right) => String(left.clientId).localeCompare(String(right.clientId)))
    const canonicalLinks = links
      .map((link, index) => ({
        fromNodeId: link.fromNodeId,
        toNodeId: link.toNodeId,
        sort: link.sort ?? index,
      }))
      .sort((left, right) =>
        left.fromNodeId.localeCompare(right.fromNodeId) ||
        left.sort - right.sort ||
        left.toNodeId.localeCompare(right.toNodeId),
      )
    return { nodes: canonicalNodes, links: canonicalLinks }
  }

  private canonicalPostConfig(config: FlowNodeDto['passPostConfig']) {
    if (!config) return null
    return {
      fieldUpdateConfigs: [...(config.fieldUpdateConfigs ?? [])]
        .map((item) => ({
          fieldId: item.fieldId.trim(),
          fieldValue: this.stableJson(item.fieldValue ?? null),
          enable: item.enable,
        }))
        .sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
      webHookConfig: normalizeApprovalWebhookConfig(config.webHookConfig) ?? null,
    }
  }

  private stableJson(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((item) => this.stableJson(item))
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, this.stableJson(item)]),
    )
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
        fieldPermissions:
          (node.approver!.fieldPermissions as unknown as ApprovalFieldPermission[] | null) ?? [],
        passPostConfig:
          (node.approver!.passPostConfig as unknown as ApprovalPostConfig | null) ?? undefined,
        rejectPostConfig:
          (node.approver!.rejectPostConfig as unknown as ApprovalPostConfig | null) ?? undefined,
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
        fieldPermissions:
          (node.approver?.fieldPermissions as unknown as ApprovalFieldPermission[] | null) ?? [],
        passPostConfig:
          (node.approver?.passPostConfig as unknown as ApprovalPostConfig | null) ?? undefined,
        rejectPostConfig:
          (node.approver?.rejectPostConfig as unknown as ApprovalPostConfig | null) ?? undefined,
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
