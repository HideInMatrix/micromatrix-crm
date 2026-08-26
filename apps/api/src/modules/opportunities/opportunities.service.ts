import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  FieldVO,
  LineItemVO,
  OpportunityStageVO,
  OpportunityVO,
  PaginatedResult,
  StageLogVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { normalizeLineItems } from '../../common/line-items'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Opportunity, OpportunityStage, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import {
  ChangeStageDto,
  CreateOpportunityDto,
  QueryOpportunitiesDto,
  ReorderStagesDto,
  StageDto,
  UpdateOpportunityDto,
  UpdateStageDto,
} from './dto/opportunity.dto'

const MODULE = 'opportunity'

type OpportunityWithRefs = Opportunity & {
  customer: { name: string }
  contact: { name: string } | null
  stage: OpportunityStage
  items?: {
    id: string
    productId: string | null
    productName: string
    unit: string | null
    quantity: unknown
    unitPrice: unknown
    discount: unknown
    amount: unknown
  }[]
}

const refInclude = {
  customer: { select: { name: true } },
  contact: { select: { name: true } },
  stage: true,
} as const
const detailInclude = { ...refInclude, items: { orderBy: { sort: 'asc' as const } } }

const DEFAULT_STAGES = [
  { name: '初步接触', probability: 10, sort: 0 },
  { name: '需求确认', probability: 30, sort: 1 },
  { name: '方案报价', probability: 60, sort: 2 },
  { name: '商务谈判', probability: 80, sort: 3 },
]

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly notifications: BusinessNotificationsService,
  ) {}

  // ===== 阶段配置 =====

  async listStages(tenantId: string): Promise<OpportunityStageVO[]> {
    await this.ensureDefaultStages(tenantId)
    const stages = await this.prisma.opportunityStage.findMany({
      where: { tenantId },
      orderBy: [{ isWon: 'asc' }, { isLost: 'asc' }, { sort: 'asc' }],
    })
    // 赢单/输单固定排最后
    const normal = stages.filter((s) => !s.isWon && !s.isLost)
    const results = stages.filter((s) => s.isWon || s.isLost)
    return [...normal, ...results].map((s) => this.stageToVO(s))
  }

  async createStage(user: AuthUser, dto: StageDto): Promise<OpportunityStageVO> {
    await this.ensureDefaultStages(user.tenantId)
    const maxSort = await this.prisma.opportunityStage.aggregate({
      where: { tenantId: user.tenantId, isWon: false, isLost: false },
      _max: { sort: true },
    })
    const stage = await this.prisma.opportunityStage.create({
      data: {
        tenantId: user.tenantId,
        name: dto.name,
        probability: dto.probability,
        sort: (maxSort._max.sort ?? 0) + 1,
      },
    })
    return this.stageToVO(stage)
  }

  async updateStage(user: AuthUser, id: string, dto: UpdateStageDto): Promise<OpportunityStageVO> {
    const stage = await this.ensureStage(user.tenantId, id)
    if (stage.system && dto.name && dto.name !== stage.name) {
      throw new BadRequestException('赢单/输单阶段不可重命名')
    }
    const updated = await this.prisma.opportunityStage.update({
      where: { id },
      data: { name: dto.name, probability: dto.probability },
    })
    return this.stageToVO(updated)
  }

  async removeStage(user: AuthUser, id: string) {
    const stage = await this.ensureStage(user.tenantId, id)
    if (stage.system) throw new BadRequestException('赢单/输单阶段不可删除')
    const count = await this.prisma.opportunity.count({
      where: { tenantId: user.tenantId, stageId: id },
    })
    if (count > 0) throw new BadRequestException('该阶段下存在商机，无法删除')
    await this.prisma.opportunityStage.delete({ where: { id } })
    return { id, name: stage.name }
  }

  async reorderStages(user: AuthUser, dto: ReorderStagesDto) {
    const stages = await this.prisma.opportunityStage.findMany({
      where: { tenantId: user.tenantId, isWon: false, isLost: false },
    })
    const idSet = new Set(stages.map((s) => s.id))
    const updates = dto.orderedIds
      .filter((id) => idSet.has(id))
      .map((id, index) =>
        this.prisma.opportunityStage.update({ where: { id }, data: { sort: index } }),
      )
    await this.prisma.$transaction(updates)
    return { count: updates.length }
  }

  // ===== 商机 =====

  async findAll(
    user: AuthUser,
    query: QueryOpportunitiesDto,
  ): Promise<PaginatedResult<OpportunityVO>> {
    const { page = 1, pageSize = 10, keyword, stageId, customerId } = query
    const [scope, fields] = await Promise.all([
      this.dataScope.scopeFilter(user, 'menu:opportunity'),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    const where: Prisma.OpportunityWhereInput = {
      tenantId: user.tenantId,
      AND: [
        scope as Prisma.OpportunityWhereInput,
        ...(filterClauses as Prisma.OpportunityWhereInput[]),
      ],
      ...(stageId ? { stageId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(keyword ? { name: { contains: keyword, mode: 'insensitive' } } : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: refInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ])

    const ownerMap = await this.ownerNames(items.map((o) => o.ownerId))
    return { items: items.map((o) => this.toVO(o, fields, ownerMap)), total, page, pageSize }
  }

  async findOne(user: AuthUser, id: string): Promise<OpportunityVO> {
    const scope = await this.dataScope.scopeFilter(user, 'menu:opportunity')
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope as Prisma.OpportunityWhereInput] },
      include: detailInclude,
    })
    if (!opportunity) throw new NotFoundException('商机不存在或不在你的数据范围内')
    return this.toSingleVO(user, opportunity)
  }

  /** 看板：按阶段分组（含各阶段数量与金额合计） */
  async kanban(user: AuthUser): Promise<{
    stages: OpportunityStageVO[]
    items: Record<string, OpportunityVO[]>
  }> {
    const stages = await this.listStages(user.tenantId)
    const [scope, fields] = await Promise.all([
      this.dataScope.scopeFilter(user, 'menu:opportunity'),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    const opportunities = await this.prisma.opportunity.findMany({
      where: { tenantId: user.tenantId, AND: [scope as Prisma.OpportunityWhereInput] },
      include: refInclude,
      orderBy: { updatedAt: 'desc' },
      take: 500,
    })
    const ownerMap = await this.ownerNames(opportunities.map((o) => o.ownerId))

    const items: Record<string, OpportunityVO[]> = {}
    for (const stage of stages) items[stage.id] = []
    for (const opportunity of opportunities) {
      items[opportunity.stageId]?.push(this.toVO(opportunity, fields, ownerMap))
    }
    const stagesWithSummary = stages.map((s) => ({
      ...s,
      count: items[s.id]?.length ?? 0,
      amountSum: (items[s.id] ?? []).reduce((sum, o) => sum + (o.amount ?? 0), 0),
    }))
    return { stages: stagesWithSummary, items }
  }

  async create(user: AuthUser, dto: CreateOpportunityDto): Promise<OpportunityVO> {
    const {
      customData,
      ownerId,
      stageId,
      customerId,
      contactId,
      expectedCloseAt,
      items,
      amount,
      ...rest
    } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.tenantId },
    })
    if (!customer) throw new BadRequestException('客户不存在')
    if (contactId) await this.assertContactBelongsToCustomer(user.tenantId, contactId, customerId)

    const stages = await this.listStages(user.tenantId)
    const targetStage = stageId
      ? stages.find((s) => s.id === stageId)
      : stages.find((s) => !s.isWon && !s.isLost)
    if (!targetStage) throw new BadRequestException('商机阶段无效')

    const owner = await this.resolveOwner(user, ownerId)
    const normalized = items?.length ? normalizeLineItems(items) : null
    const opportunity = await this.prisma.opportunity.create({
      data: {
        ...rest,
        amount: amount ?? normalized?.total ?? null,
        tenantId: user.tenantId,
        customerId,
        contactId: contactId ?? null,
        stageId: targetStage.id,
        expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null,
        ownerId: owner.id,
        deptId: owner.deptId,
        customData: validated as Prisma.InputJsonValue,
        wonAt: targetStage.isWon ? new Date() : null,
        lostAt: targetStage.isLost ? new Date() : null,
        items: normalized ? { create: normalized.rows } : undefined,
      },
      include: detailInclude,
    })
    await this.prisma.opportunityStageLog.create({
      data: {
        tenantId: user.tenantId,
        opportunityId: opportunity.id,
        toStageName: targetStage.name,
        userName: user.name,
      },
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'BUSINESS_ADD',
      operatorId: user.id,
      recipientIds: [owner.id],
      excludeSelf: true,
      type: 'system',
      title: '新建商机',
      content: `${user.name} 新建了商机「${opportunity.name}」并将你设为负责人`,
      link: `/opportunities/${opportunity.id}`,
    })
    return this.toSingleVO(user, opportunity)
  }

  async update(user: AuthUser, id: string, dto: UpdateOpportunityDto): Promise<OpportunityVO> {
    const existing = await this.ensureInScope(user, id, 'opportunity:update')
    const {
      customData,
      ownerId,
      stageId: _ignored,
      customerId,
      contactId,
      expectedCloseAt,
      items,
      amount,
      ...rest
    } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })

    const data: Prisma.OpportunityUpdateInput = {
      ...rest,
      ...(expectedCloseAt !== undefined
        ? { expectedCloseAt: expectedCloseAt ? new Date(expectedCloseAt) : null }
        : {}),
      customData: {
        ...((existing.customData as Record<string, unknown> | null) ?? {}),
        ...validated,
      } as Prisma.InputJsonValue,
    }
    if (customerId && customerId !== existing.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, organizationId: user.tenantId },
      })
      if (!customer) throw new BadRequestException('客户不存在')
      data.customer = { connect: { id: customerId } }
    }
    const targetCustomerId = customerId ?? existing.customerId
    if (contactId !== undefined) {
      if (contactId) {
        await this.assertContactBelongsToCustomer(user.tenantId, contactId, targetCustomerId)
        data.contact = { connect: { id: contactId } }
      } else {
        data.contact = { disconnect: true }
      }
    } else if (customerId && customerId !== existing.customerId && existing.contactId) {
      await this.assertContactBelongsToCustomer(user.tenantId, existing.contactId, targetCustomerId)
    }
    if (ownerId && ownerId !== existing.ownerId) {
      const owner = await this.resolveOwner(user, ownerId)
      data.ownerId = owner.id
      data.deptId = owner.deptId
    }
    if (items !== undefined) {
      const normalized = normalizeLineItems(items)
      data.items = { deleteMany: {}, create: normalized.rows }
      if (amount === undefined) data.amount = normalized.total
    }
    if (amount !== undefined) data.amount = amount

    const opportunity = await this.prisma.opportunity.update({
      where: { id },
      data,
      include: detailInclude,
    })
    if (ownerId && ownerId !== existing.ownerId) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'BUSINESS_TRANSFER',
        operatorId: user.id,
        recipientIds: [ownerId],
        excludeSelf: true,
        type: 'assign',
        title: '商机已转移给你',
        content: `${user.name} 将商机「${opportunity.name}」转移给你`,
        link: `/opportunities/${opportunity.id}`,
      })
    }
    return this.toSingleVO(user, opportunity)
  }

  /** 推进/变更阶段（赢单/输单在此发生） */
  async changeStage(user: AuthUser, id: string, dto: ChangeStageDto) {
    const existing = await this.ensureInScope(user, id, 'opportunity:stage')
    const stage = await this.ensureStage(user.tenantId, dto.stageId)
    if (stage.isLost && !dto.lostReason?.trim()) {
      throw new BadRequestException('请填写输单原因')
    }
    const fromStage = await this.prisma.opportunityStage.findUnique({
      where: { id: existing.stageId },
    })

    await this.prisma.$transaction([
      this.prisma.opportunity.update({
        where: { id },
        data: {
          stageId: stage.id,
          wonAt: stage.isWon ? new Date() : null,
          lostAt: stage.isLost ? new Date() : null,
          lostReason: stage.isLost ? dto.lostReason : null,
        },
      }),
      this.prisma.opportunityStageLog.create({
        data: {
          tenantId: user.tenantId,
          opportunityId: id,
          fromStageName: fromStage?.name ?? null,
          toStageName: stage.name,
          userName: user.name,
        },
      }),
    ])
    return { id, name: existing.name, stage: stage.name }
  }

  async stageLogs(user: AuthUser, id: string): Promise<StageLogVO[]> {
    await this.ensureInScope(user, id, 'menu:opportunity')
    const logs = await this.prisma.opportunityStageLog.findMany({
      where: { opportunityId: id },
      orderBy: { createdAt: 'desc' },
    })
    return logs.map((log) => ({
      id: log.id,
      fromStageName: log.fromStageName,
      toStageName: log.toStageName,
      userName: log.userName,
      createdAt: log.createdAt.toISOString(),
    }))
  }

  async remove(user: AuthUser, id: string) {
    const opportunity = await this.ensureInScope(user, id, 'opportunity:delete')
    await this.prisma.opportunity.delete({ where: { id } })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'BUSINESS_DELETED',
      operatorId: user.id,
      recipientIds: [opportunity.ownerId],
      excludeSelf: true,
      type: 'system',
      title: '商机已删除',
      content: `${user.name} 删除了商机「${opportunity.name}」`,
      link: '/opportunities',
    })
    return { id, name: opportunity.name }
  }

  // ===== 私有 =====

  /** 初始化默认阶段（供线索转化等跨模块流程复用） */
  async ensureDefaultStages(tenantId: string) {
    const count = await this.prisma.opportunityStage.count({ where: { tenantId } })
    if (count > 0) return
    await this.prisma.opportunityStage.createMany({
      data: [
        ...DEFAULT_STAGES.map((s) => ({ tenantId, ...s })),
        { tenantId, name: '赢单', probability: 100, sort: 98, isWon: true, system: true },
        { tenantId, name: '输单', probability: 0, sort: 99, isLost: true, system: true },
      ],
      skipDuplicates: true,
    })
  }

  private async ensureStage(tenantId: string, id: string) {
    const stage = await this.prisma.opportunityStage.findFirst({ where: { id, tenantId } })
    if (!stage) throw new NotFoundException('阶段不存在')
    return stage
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const scope = await this.dataScope.scopeFilter(user, permission)
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope as Prisma.OpportunityWhereInput] },
    })
    if (!opportunity) throw new NotFoundException('商机不存在或不在你的数据范围内')
    return opportunity
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, deptId: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async ownerNames(ownerIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds.filter((v): v is string => !!v))]
    if (ids.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  private async toSingleVO(
    user: AuthUser,
    opportunity: OpportunityWithRefs,
  ): Promise<OpportunityVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const ownerMap = await this.ownerNames([opportunity.ownerId])
    return this.toVO(opportunity, fields, ownerMap)
  }

  private toVO(
    opportunity: OpportunityWithRefs,
    fields: FieldVO[],
    ownerMap: Map<string, string>,
  ): OpportunityVO {
    const customData = (opportunity.customData as Record<string, unknown> | null) ?? {}
    const amount = opportunity.amount ? Number(opportunity.amount) : null
    const record: Record<string, unknown> = { name: opportunity.name, amount }
    const formulas = this.metadata.computeFormulas(fields, record, customData)

    return {
      id: opportunity.id,
      name: opportunity.name,
      customerId: opportunity.customerId,
      customerName: opportunity.customer.name,
      contactId: opportunity.contactId,
      contactName: opportunity.contact?.name ?? null,
      stageId: opportunity.stageId,
      stageName: opportunity.stage.name,
      stageProbability: opportunity.stage.probability,
      isWon: opportunity.stage.isWon,
      isLost: opportunity.stage.isLost,
      amount,
      expectedCloseAt: opportunity.expectedCloseAt?.toISOString().slice(0, 10) ?? null,
      lostReason: opportunity.lostReason,
      remark: opportunity.remark,
      ownerId: opportunity.ownerId,
      ownerName: opportunity.ownerId ? (ownerMap.get(opportunity.ownerId) ?? null) : null,
      deptId: opportunity.deptId,
      customData: { ...customData, ...formulas },
      items: opportunity.items?.map((item) => this.itemToVO(item)),
      wonAt: opportunity.wonAt?.toISOString() ?? null,
      lostAt: opportunity.lostAt?.toISOString() ?? null,
      createdAt: opportunity.createdAt.toISOString(),
      updatedAt: opportunity.updatedAt.toISOString(),
    }
  }

  private itemToVO(item: NonNullable<OpportunityWithRefs['items']>[number]): LineItemVO {
    return {
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      discount: Number(item.discount),
      amount: Number(item.amount),
    }
  }

  private async assertContactBelongsToCustomer(
    tenantId: string,
    contactId: string,
    customerId: string,
  ) {
    const contact = await this.prisma.customerContact.findFirst({
      where: { id: contactId, organizationId: tenantId, customerId },
      select: { id: true },
    })
    if (!contact) throw new BadRequestException('联系人不存在或不属于当前客户')
  }

  private stageToVO(stage: OpportunityStage): OpportunityStageVO {
    return {
      id: stage.id,
      name: stage.name,
      probability: stage.probability,
      sort: stage.sort,
      isWon: stage.isWon,
      isLost: stage.isLost,
      system: stage.system,
    }
  }
}
