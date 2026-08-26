import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  FieldVO,
  type FilterCondition,
  ImportResultVO,
  LeadVO,
  type MessageTaskEvent,
  PaginatedResult,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { toCsv } from '../../common/csv'
import type {
  BatchAffectResult,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../../common/dto/resource-batch.dto'
import { formatForExport } from '../../common/export-format'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { Clue as Lead, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { CustomersService } from '../../customers/customers.service'
import { MetadataService } from '../metadata/metadata.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import { CluePoolRepository } from '../pool-rules/clue-pool.repository'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import {
  AssignLeadDto,
  CreateLeadDto,
  QueryLeadsDto,
  RetransitionLeadCustomerDto,
  TransformLeadDto,
  TransitionCustomerQueryDto,
  TransitionLeadCustomerDto,
  UpdateLeadDto,
} from './dto/lead.dto'

const MODULE = 'lead'

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly notifications: BusinessNotificationsService,
    private readonly opportunities: OpportunitiesService,
    private readonly pools: ResourcePoolsService,
    private readonly cluePools: CluePoolRepository,
    private readonly changeLog: BusinessChangeLogService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly customers: CustomersService,
  ) {}

  async findAll(user: AuthUser, query: QueryLeadsDto): Promise<PaginatedResult<LeadVO>> {
    const { page = 1, pageSize = 10, keyword, scope = 'mine', status } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const adHocConditions = parseFilters(query.filters)
    const viewResourceType =
      scope === 'pool' ? USER_VIEW_RESOURCE_TYPES.lead_pool : USER_VIEW_RESOURCE_TYPES.lead
    const saved = query.viewId
      ? await this.userViews.resolveFilters(user, query.viewId, viewResourceType)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      adHocConditions.length ? this.filterIds(user.tenantId, adHocConditions, 'AND') : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)

    // 线索池对全员开放；非池数据按数据范围过滤
    let scopeClause: Prisma.ClueWhereInput
    if (scope === 'pool') {
      const options = await this.pools.options(user, 'lead')
      const accessiblePoolIds = options.map((pool) => pool.id)
      if (query.poolId && !accessiblePoolIds.includes(query.poolId)) {
        throw new BadRequestException('你无权访问该线索池')
      }
      scopeClause = query.poolId
        ? { inSharedPool: true, poolId: query.poolId }
        : {
            inSharedPool: true,
            poolId: { in: accessiblePoolIds },
          }
    } else {
      scopeClause = {
        inSharedPool: false,
        ...(await this.dataScope.directOwnerFilter(user, 'menu:lead')),
      }
    }

    const where: Prisma.ClueWhereInput = {
      organizationId: user.tenantId,
      AND: [scopeClause],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(status ? { stage: status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { contact: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.clue.findMany({
        where,
        orderBy: { createTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.clue.count({ where }),
    ])

    const [ownerMap, values] = await Promise.all([
      this.ownerNames(items.map((item) => item.owner)),
      this.fieldValues.load(
        user.tenantId,
        'clue',
        items.map((item) => item.id),
      ),
    ])
    return {
      items: items.map((item) => this.toVO(item, fields, ownerMap, values.get(item.id) ?? {})),
      total,
      page,
      pageSize,
    }
  }

  async findOne(user: AuthUser, id: string): Promise<LeadVO> {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!lead) throw new NotFoundException('线索不存在')
    if (lead.inSharedPool) {
      const options = await this.pools.options(user, 'lead')
      if (lead.poolId && !options.some((pool) => pool.id === lead.poolId)) {
        throw new NotFoundException('线索不存在或无权访问')
      }
    } else if (!(await this.dataScope.matchesDirectOwner(user, lead.owner, 'menu:lead'))) {
      throw new NotFoundException('线索不存在或不在你的数据范围内')
    }
    return this.toSingleVO(user, lead)
  }

  async create(user: AuthUser, dto: CreateLeadDto): Promise<LeadVO> {
    const { customData, ownerId, toPool, poolId } = dto
    await this.fieldValues.validate(user.tenantId, 'clue', customData ?? {}, {
      mode: 'create',
    })
    const owner = toPool ? null : await this.resolveOwner(user, ownerId)
    const targetPool = toPool ? await this.pools.resolveTargetPool(user, 'lead', poolId) : null
    const now = BigInt(Date.now())
    if (owner) await this.pools.assertCapacityForOwner(user.tenantId, 'lead', owner.id)

    const lead = await this.prisma.$transaction(async (tx) => {
      const created = await tx.clue.create({
        data: {
          name: dto.name,
          contact: dto.contactName ?? null,
          phone: dto.phone ?? null,
          stage: 'FOLLOWING',
          organizationId: user.tenantId,
          inSharedPool: Boolean(toPool),
          poolId: targetPool?.id ?? null,
          owner: owner?.id ?? null,
          collectionTime: owner ? now : null,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(user.tenantId, 'clue', created.id, customData ?? {}, 'create', tx)
      return created
    })
    if (owner && owner.id !== user.id) {
      await this.notifyAssign(user, lead.id, lead.name, owner.id, 'CLUE_ADD')
    }
    return this.toSingleVO(user, lead)
  }

  async update(user: AuthUser, id: string, dto: UpdateLeadDto): Promise<LeadVO> {
    const existing = await this.ensureInScope(user, id, 'lead:update')
    return this.updateExisting(user, existing, dto)
  }

  private async updateExisting(
    user: AuthUser,
    existing: Lead,
    dto: UpdateLeadDto,
  ): Promise<LeadVO> {
    const { customData, ownerId } = dto
    await this.fieldValues.validate(user.tenantId, 'clue', customData ?? {}, {
      mode: 'update',
      resourceId: existing.id,
    })
    let transferredOwnerId: string | null = null
    if (ownerId && ownerId !== existing.owner) {
      const owner = await this.resolveOwner(user, ownerId)
      if (existing.inSharedPool) {
        await this.cluePools.assign({
          organizationId: user.tenantId,
          clueId: existing.id,
          ownerId: owner.id,
          operatorId: user.id,
          poolAdmin: await this.pools.isPoolManager(user, 'lead', existing.poolId),
        })
      } else {
        await this.cluePools.transfer({
          organizationId: user.tenantId,
          clueId: existing.id,
          ownerId: owner.id,
          operatorId: user.id,
        })
      }
      transferredOwnerId = owner.id
    }

    const lead = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.clue.update({
        where: { id: existing.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.contactName !== undefined ? { contact: dto.contactName } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData) {
        await this.fieldValues.save(user.tenantId, 'clue', existing.id, customData, 'update', tx)
      }
      return updated
    })
    if (transferredOwnerId) {
      await this.notifyAssign(user, existing.id, lead.name, transferredOwnerId, 'TRANSFER_CLUE')
    }
    await this.changeLog.record(user, {
      module: 'lead',
      action: 'update',
      targetId: lead.id,
      targetName: lead.name,
      before: existing,
      after: lead,
    })
    return this.toSingleVO(user, lead)
  }

  async remove(user: AuthUser, id: string) {
    const lead = await this.ensureInScope(user, id, 'lead:delete')
    await this.deleteLeadResources(user, [lead])
    return { id, name: lead.name }
  }

  /** 退回线索池 */
  async moveToPool(user: AuthUser, id: string, poolId?: string, reasonId?: string) {
    const lead = await this.ensureInScope(user, id, 'lead:assign')
    if (lead.stage !== 'FOLLOWING') throw new BadRequestException('已转化/无效线索不能退回线索池')
    const pool = await this.pools.resolveMoveTargetPool(user.tenantId, 'lead', lead.owner, poolId)
    await this.cluePools.moveToPool({
      organizationId: user.tenantId,
      clueId: id,
      poolId: pool.id,
      operatorId: user.id,
      reasonId,
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CLUE_MOVED_POOL',
      operatorId: user.id,
      recipientIds: [lead.owner],
      excludeSelf: true,
      type: 'pool',
      title: '线索已移入线索池',
      content: `${user.name} 将线索「${lead.name}」移入线索池`,
      link: '/leads',
    })
    return { id, name: lead.name, poolId: pool.id }
  }

  /** 从线索池领取 */
  async claim(user: AuthUser, id: string) {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId, inSharedPool: true },
    })
    if (!lead) throw new BadRequestException('线索不存在或已被他人领取')
    const claimed = await this.cluePools.pick({
      organizationId: user.tenantId,
      clueId: id,
      ownerId: user.id,
      operatorId: user.id,
      poolAdmin: await this.pools.isPoolManager(user, 'lead', lead.poolId),
    })
    return { id, name: claimed.name }
  }

  async batchClaim(user: AuthUser, ids: string[], poolId?: string): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        if (poolId) {
          const lead = await this.prisma.clue.findFirst({
            where: { id, organizationId: user.tenantId, inSharedPool: true },
            select: { poolId: true },
          })
          if (!lead || lead.poolId !== poolId) throw new BadRequestException('线索不属于指定线索池')
        }
        await this.claim(user, id)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** 分配负责人（主管操作） */
  async assign(user: AuthUser, id: string, dto: AssignLeadDto) {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!lead) throw new NotFoundException('线索不存在')
    const owner = await this.resolveOwner(user, dto.ownerId)
    if (lead.inSharedPool) {
      await this.cluePools.assign({
        organizationId: user.tenantId,
        clueId: id,
        ownerId: owner.id,
        operatorId: user.id,
        poolAdmin: await this.pools.isPoolManager(user, 'lead', lead.poolId),
      })
    } else if (lead.owner !== owner.id) {
      await this.cluePools.transfer({
        organizationId: user.tenantId,
        clueId: id,
        ownerId: owner.id,
        operatorId: user.id,
      })
    }
    await this.notifyAssign(
      user,
      lead.id,
      lead.name,
      owner.id,
      lead.inSharedPool ? 'CLUE_DISTRIBUTED' : 'TRANSFER_CLUE',
    )
    return { id, name: lead.name }
  }

  async batchAssign(user: AuthUser, ids: string[], ownerId: string): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.assign(user, id, { ownerId })
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  async batchMoveToPool(
    user: AuthUser,
    ids: string[],
    poolId?: string,
    reasonId?: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.moveToPool(user, id, poolId, reasonId)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** Cordys ResourceBatchEditRequest：所有选中资源先校验权限，再统一修改一个字段。 */
  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)

    // CsBatchPermission 语义：任何一条不在当前数据范围，都在写入前整体失败。
    const leads = await Promise.all(
      dto.ids.map((id) => this.ensureInScope(user, id, 'lead:update')),
    )

    if (field.key === 'owner' || field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      const processCount = leads.filter((lead) => lead.owner !== dto.fieldValue).length
      if (processCount > 0) {
        await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.fieldValue, processCount)
      }
      for (const lead of leads) {
        if (lead.owner !== dto.fieldValue)
          await this.assign(user, lead.id, { ownerId: dto.fieldValue })
      }
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    const updateDto: UpdateLeadDto = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : field.key === 'contact'
        ? ({ contactName: dto.fieldValue } as UpdateLeadDto)
        : ({ [field.key]: dto.fieldValue } as UpdateLeadDto)

    for (const lead of leads) await this.update(user, lead.id, updateDto)
    return { success: dto.ids.length, fail: 0, failedIds: [] }
  }

  async batchDelete(user: AuthUser, ids: string[]): Promise<BatchAffectResult> {
    const leads = await Promise.all(ids.map((id) => this.ensureInScope(user, id, 'lead:delete')))
    await this.deleteLeadResources(user, leads)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async poolBatchUpdate(user: AuthUser, dto: PoolResourceBatchEditDto): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'lead', dto.poolId)
    const leads = await this.prisma.clue.findMany({
      where: {
        organizationId: user.tenantId,
        id: { in: dto.ids },
        inSharedPool: true,
        poolId: dto.poolId,
      },
    })
    if (leads.length !== dto.ids.length) {
      throw new BadRequestException('所选线索必须全部属于同一个指定线索池')
    }

    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    if (field.key === 'owner' || field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.fieldValue, leads.length)
      for (const lead of leads) await this.assign(user, lead.id, { ownerId: dto.fieldValue })
      return { success: leads.length, fail: 0, failedIds: [] }
    }

    const updateDto: UpdateLeadDto = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : field.key === 'contact'
        ? ({ contactName: dto.fieldValue } as UpdateLeadDto)
        : ({ [field.key]: dto.fieldValue } as UpdateLeadDto)
    for (const lead of leads) await this.updateExisting(user, lead, updateDto)
    return { success: leads.length, fail: 0, failedIds: [] }
  }

  async poolBatchDelete(user: AuthUser, poolId: string, ids: string[]): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'lead', poolId)
    const leads = await this.prisma.clue.findMany({
      where: { organizationId: user.tenantId, id: { in: ids }, inSharedPool: true, poolId },
    })
    if (leads.length !== ids.length) {
      throw new BadRequestException('所选线索必须全部属于同一个指定线索池')
    }
    await this.deleteLeadResources(user, leads)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async ownerHistory(user: AuthUser, id: string) {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId },
      select: { id: true, inSharedPool: true, poolId: true },
    })
    if (!lead) throw new NotFoundException('线索不存在')
    if (lead.inSharedPool && lead.poolId) {
      const options = await this.pools.options(user, 'lead')
      if (!options.some((pool) => pool.id === lead.poolId))
        throw new NotFoundException('线索不存在或无权访问')
    } else if (!lead.inSharedPool) {
      await this.ensureInScope(user, id, 'menu:lead')
    }
    return this.pools.ownerHistory(user, 'lead', id)
  }

  async markInvalid(user: AuthUser, id: string) {
    const lead = await this.ensureInScope(user, id, 'lead:update')
    await this.prisma.clue.update({
      where: { id },
      data: { stage: 'INVALID', updateTime: BigInt(Date.now()), updateUser: user.id },
    })
    return { id, name: lead.name }
  }

  /** Cordys /lead/transform：客户+联系人固定创建，商机可选。 */
  async transform(user: AuthUser, dto: TransformLeadDto) {
    this.assertFunctionalPermission(user, 'customer:create', '无新建客户权限')
    if (dto.oppCreated) {
      this.assertFunctionalPermission(user, 'opportunity:create', '无新建商机权限')
      if (!dto.oppName?.trim()) throw new BadRequestException('请输入商机名称')
      await this.opportunities.listStages(user.tenantId)
    }

    const lead = await this.ensureInScope(user, dto.clueId, 'lead:update')
    if (lead.transitionType === 'CUSTOMER' || lead.stage === 'CONVERTED') {
      throw new BadRequestException('线索已转客户')
    }
    if (!lead.owner) throw new BadRequestException('线索暂无负责人，无法转换')

    const matchedCustomer = await this.selectTransformCustomer(user, lead)
    let createdCustomerId: string | null = null
    let customerId = matchedCustomer?.id ?? null
    if (!customerId) {
      const customerCustomData = await this.mapLeadCustomData(user.tenantId, 'customer', lead, true)
      const customer = await this.customers.create(user, {
        name: lead.name,
        phone: lead.phone ?? undefined,
        ownerId: lead.owner,
        customData: customerCustomData,
      })
      customerId = customer.id
      createdCustomerId = customer.id
    }

    try {
      const result = await this.associateLeadsToCustomer(user, [lead], customerId, {
        opportunityName: dto.oppCreated ? dto.oppName?.trim() : undefined,
      })
      return {
        clueId: lead.id,
        customerId,
        contactId: result.contactIds[0] ?? null,
        opportunityId: result.opportunityId,
      }
    } catch (error) {
      // 只有本次专门创建的客户才回收；复用的同名客户必须保留。
      if (createdCustomerId) {
        await this.prisma.customer.deleteMany({
          where: { id: createdCustomerId, organizationId: user.tenantId },
        })
      }
      throw error
    }
  }

  /** Cordys /lead/transition/account：客户新增表单 + clueId。 */
  async transitionCustomer(user: AuthUser, dto: TransitionLeadCustomerDto) {
    this.assertFunctionalPermission(user, 'customer:create', '无新建客户权限')
    const lead = await this.ensureInScope(user, dto.clueId, 'lead:update')
    if (!lead.owner) throw new BadRequestException('线索暂无负责人，无法关联客户')
    const { clueId: _, ...customerPayload } = dto
    const customer = await this.customers.create(user, customerPayload)
    try {
      const result = await this.associateLeadsToCustomer(user, [lead], customer.id)
      return {
        clueId: lead.id,
        customerId: customer.id,
        contactId: result.contactIds[0] ?? null,
      }
    } catch (error) {
      await this.prisma.customer.deleteMany({
        where: { id: customer.id, organizationId: user.tenantId },
      })
      throw error
    }
  }

  /** Cordys /lead/re-transition/account：关联/重新关联已有客户。 */
  async retransitionCustomer(user: AuthUser, dto: RetransitionLeadCustomerDto) {
    const customer = await this.assertTransitionCustomerAccessible(user, dto.customerId, true)
    const leads = await this.prisma.clue.findMany({
      where: { id: { in: [...new Set(dto.clueIds)] }, organizationId: user.tenantId },
    })
    const accessibleIds = new Set<string>()
    for (const lead of leads) {
      if (lead.inSharedPool) continue
      if (await this.dataScope.matchesDirectOwner(user, lead.owner, 'lead:update')) {
        accessibleIds.add(lead.id)
      }
    }
    const denied = dto.clueIds.filter((id) => !accessibleIds.has(id))
    if (denied.length > 0) throw new ForbiddenException('存在不在当前线索数据范围内的数据')

    const validLeads = leads.filter((lead) => !!lead.owner)
    const skippedIds = leads.filter((lead) => !lead.owner).map((lead) => lead.id)
    const result = await this.associateLeadsToCustomer(user, validLeads, customer.id)
    return {
      customerId: customer.id,
      success: validLeads.length,
      skippedIds,
      contactIds: result.contactIds,
    }
  }

  /** Cordys 关联客户抽屉：普通数据范围 + 协作 + 可访问公海。 */
  async transitionCustomerList(user: AuthUser, query: TransitionCustomerQueryDto) {
    const result = await this.customers.findTransitionCandidates(user, {
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      filters: query.filters,
    })
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        selectable: item.collaborationType !== 'READ_ONLY',
      })),
    }
  }

  private async assertTransitionCustomerAccessible(
    user: AuthUser,
    customerId: string,
    claimPoolCustomer: boolean,
  ) {
    let customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.tenantId },
    })
    if (!customer) throw new NotFoundException('客户不存在')

    if (customer.inSharedPool) {
      const options = await this.pools.options(user, 'customer')
      const targetPoolId = customer.poolId
      const accessible = !!targetPoolId && options.some((pool) => pool.id === targetPoolId)
      if (!accessible) throw new ForbiddenException('无权访问该公海客户')
      if (claimPoolCustomer) {
        const targetCustomerId = customer.id
        await this.customers.claimFromSea(user, targetCustomerId)
        customer = await this.prisma.customer.findFirstOrThrow({
          where: { id: targetCustomerId, organizationId: user.tenantId },
        })
      }
      return customer
    }

    if (await this.dataScope.matchesDirectOwner(user, customer.owner, 'menu:customer')) {
      return customer
    }
    const collaboration = await this.prisma.customerCollaboration.findFirst({
      where: { customerId, userId: user.id },
    })
    if (!collaboration) throw new ForbiddenException('客户不在可关联范围内')
    if (collaboration.collaborationType === 'READ_ONLY') {
      throw new ForbiddenException('只读协作客户不可关联线索')
    }
    return customer
  }

  private async associateLeadsToCustomer(
    user: AuthUser,
    leads: Lead[],
    customerId: string,
    options: { opportunityName?: string } = {},
  ) {
    if (leads.length === 0)
      return { contactIds: [] as string[], opportunityId: null as string | null }
    const [contactNameUnique, contactPhoneUnique] = await Promise.all([
      this.metadata.hasUniqueRule(user.tenantId, 'contact', 'name'),
      this.metadata.hasUniqueRule(user.tenantId, 'contact', 'phone'),
    ])
    const contactCustomData = new Map<string, Record<string, unknown>>()
    for (const lead of leads) {
      if (!lead.contact?.trim()) continue
      contactCustomData.set(
        lead.id,
        await this.mapLeadCustomData(user.tenantId, 'contact', lead, true),
      )
    }
    const opportunityCustomData =
      options.opportunityName && leads.length === 1
        ? await this.mapLeadCustomData(user.tenantId, 'opportunity', leads[0], true)
        : {}
    const ownerIds = [
      ...new Set(leads.map((lead) => lead.owner).filter((id): id is string => !!id)),
    ]
    const owners = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, id: { in: ownerIds }, status: 'ACTIVE' },
      select: { id: true, deptId: true },
    })
    const ownerMap = new Map(owners.map((owner) => [owner.id, owner]))
    if (ownerMap.size !== ownerIds.length) throw new BadRequestException('线索负责人不存在或已禁用')

    const firstStage = options.opportunityName
      ? await this.prisma.opportunityStage.findFirst({
          where: { tenantId: user.tenantId, isWon: false, isLost: false },
          orderBy: { sort: 'asc' },
        })
      : null
    if (options.opportunityName && !firstStage) {
      throw new BadRequestException('请先在商机管理中初始化商机阶段')
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, organizationId: user.tenantId },
      })
      if (!customer) throw new NotFoundException('客户不存在')

      const contactIds: string[] = []
      let opportunityId: string | null = null
      let newestFollowedAt = customer.followTime

      for (const lead of leads) {
        if (!lead.owner) continue
        const owner = ownerMap.get(lead.owner)
        if (!owner) continue

        if (customer.owner !== lead.owner) {
          const existingTeam = await tx.customerCollaboration.findFirst({
            where: { customerId, userId: lead.owner },
            select: { id: true },
          })
          if (!existingTeam) {
            await tx.customerCollaboration.create({
              data: {
                customerId,
                userId: lead.owner,
                collaborationType: 'COLLABORATION',
                createTime: BigInt(Date.now()),
                updateTime: BigInt(Date.now()),
                createUser: user.id,
                updateUser: user.id,
              },
            })
          }
        }

        let contactId: string | null = null
        if (lead.contact?.trim()) {
          const normalizedName = lead.contact.trim()
          const uniqueClauses: Prisma.CustomerContactWhereInput[] = []
          if (contactNameUnique && normalizedName) uniqueClauses.push({ name: normalizedName })
          if (contactPhoneUnique && lead.phone?.trim())
            uniqueClauses.push({ phone: lead.phone.trim() })
          const duplicate = uniqueClauses.length
            ? await tx.customerContact.findFirst({
                where: { organizationId: user.tenantId, OR: uniqueClauses },
                select: { id: true },
              })
            : null
          if (!duplicate) {
            const contact = await tx.customerContact.create({
              data: {
                customerId,
                owner: lead.owner,
                name: normalizedName,
                phone: lead.phone,
                enable: true,
                organizationId: user.tenantId,
                createTime: BigInt(Date.now()),
                updateTime: BigInt(Date.now()),
                createUser: user.id,
                updateUser: user.id,
              },
            })
            await this.fieldValues.save(
              user.tenantId,
              'customerContact',
              contact.id,
              contactCustomData.get(lead.id) ?? {},
              'create',
              tx,
            )
            contactId = contact.id
            contactIds.push(contact.id)
          }
        }

        if (options.opportunityName && firstStage && leads.length === 1) {
          const opportunity = await tx.opportunity.create({
            data: {
              tenantId: user.tenantId,
              name: options.opportunityName,
              customerId,
              contactId,
              stageId: firstStage.id,
              ownerId: lead.owner,
              deptId: owner.deptId,
              customData: opportunityCustomData as Prisma.InputJsonValue,
            },
          })
          opportunityId = opportunity.id
        }

        const followUps = await tx.followUpRecord.findMany({
          where: { tenantId: user.tenantId, targetType: 'lead', targetId: lead.id },
          orderBy: { createdAt: 'asc' },
        })
        if (followUps.length > 0) {
          await tx.followUpRecord.createMany({
            data: followUps.map((record) => ({
              tenantId: record.tenantId,
              targetType: 'customer',
              targetId: customerId,
              type: record.type,
              content: record.content,
              nextFollowAt: record.nextFollowAt,
              ownerId: record.ownerId,
              ownerName: record.ownerName,
              createdAt: record.createdAt,
            })),
          })
        }

        if (lead.followTime && (!newestFollowedAt || lead.followTime > newestFollowedAt)) {
          newestFollowedAt = lead.followTime
        }

        await tx.clue.update({
          where: { id: lead.id },
          data: {
            stage: 'CONVERTED',
            transitionType: 'CUSTOMER',
            transitionId: customerId,
            inSharedPool: false,
            poolId: null,
            updateTime: BigInt(Date.now()),
            updateUser: user.id,
          },
        })
      }

      if (newestFollowedAt && newestFollowedAt !== customer.followTime) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            followTime: newestFollowedAt,
            updateTime: BigInt(Date.now()),
            updateUser: user.id,
          },
        })
      }

      return { contactIds, opportunityId }
    })

    for (const lead of leads) {
      if (!lead.owner) continue
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CLUE_CONVERT_CUSTOMER',
        operatorId: user.id,
        recipientIds: [lead.owner],
        excludeSelf: true,
        type: 'system',
        title: '线索已转换为客户',
        content: `线索「${lead.name}」已完成客户关联`,
        link: `/customers/${customerId}`,
      })
      if (options.opportunityName && result.opportunityId) {
        await this.notifications.send({
          tenantId: user.tenantId,
          event: 'CLUE_CONVERT_BUSINESS',
          operatorId: user.id,
          recipientIds: [lead.owner],
          excludeSelf: true,
          type: 'system',
          title: '线索已转换为商机',
          content: `线索「${lead.name}」已创建商机「${options.opportunityName}」`,
          link: `/opportunities/${result.opportunityId}`,
        })
      }
    }

    return result
  }

  private async selectTransformCustomer(user: AuthUser, lead: Lead) {
    const nameUnique = await this.metadata.hasUniqueRule(user.tenantId, 'customer', 'name')
    if (!nameUnique) return null
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: user.tenantId,
        name: { equals: lead.name, mode: 'insensitive' },
      },
      orderBy: { createTime: 'asc' },
    })
    if (customers.length === 0) return null
    if (customers.length === 1) return customers[0]
    return (
      customers.find((customer) => !customer.inSharedPool && customer.owner === lead.owner) ??
      customers[0]
    )
  }

  private async mapLeadCustomData(
    tenantId: string,
    module: 'customer' | 'contact' | 'opportunity',
    lead: Lead,
    _requireAll: boolean,
  ) {
    const values = await this.fieldValues.load(tenantId, 'clue', [lead.id])
    const targetFields = await this.metadata.fieldsMap(tenantId, module)
    return Object.fromEntries(
      Object.entries(values.get(lead.id) ?? {}).filter(([key]) => targetFields.has(key)),
    )
  }

  private assertFunctionalPermission(user: AuthUser, permission: string, message: string) {
    if (!hasPermission(user.permissions, permission)) throw new ForbiddenException(message)
  }

  /** 导出 CSV */
  async exportCsv(
    user: AuthUser,
    query: QueryLeadsDto,
  ): Promise<{ filename: string; csv: string }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const columns = fields.filter((f) => f.showInList && !f.hidden)
    const result = await this.findAll(user, { ...query, page: 1, pageSize: 5000 })

    const headers = [...columns.map((c) => c.label), '状态', '创建时间']
    const statusLabels: Record<string, string> = {
      FOLLOWING: '跟进中',
      CONVERTED: '已转化',
      INVALID: '无效',
    }
    const rows = result.items.map((item) => [
      ...columns.map((c) => formatForExport(c, item as unknown as Record<string, unknown>)),
      statusLabels[item.status] ?? item.status,
      item.createdAt.slice(0, 10),
    ])
    return {
      filename: `线索导出_${new Date().toISOString().slice(0, 10)}.csv`,
      csv: toCsv(headers, rows),
    }
  }

  async importTemplate(
    user: AuthUser,
    importType: ImportType,
    poolId?: string,
  ): Promise<{ filename: string; data: Buffer }> {
    if (poolId) await this.pools.assertPoolMember(user, 'lead', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: poolId ? ['owner', 'ownerId'] : [],
    })
    return {
      filename: `${poolId ? '线索池' : '线索'}${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
    poolId?: string,
  ): Promise<ImportResultVO> {
    if (poolId) await this.pools.assertPoolMember(user, 'lead', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['owner', 'ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (errors.length === 0) {
        try {
          await this.prepareImportRow(user, row.values, fields, importType, row.resourceId, poolId)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '数据校验失败')
        }
      }
      if (errors.length > 0) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
      else successCount++
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async importXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
    poolId?: string,
  ): Promise<ImportResultVO> {
    if (poolId) await this.pools.assertPoolMember(user, 'lead', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['owner', 'ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (errors.length === 0) {
        try {
          const prepared = await this.prepareImportRow(
            user,
            row.values,
            fields,
            importType,
            row.resourceId,
            poolId,
          )
          if (importType === 'ADD') {
            await this.create(user, {
              ...prepared.dto,
              ...(poolId ? { toPool: true, poolId } : {}),
            } as CreateLeadDto)
          } else if (poolId) {
            if (!prepared.existing) throw new BadRequestException('线索不存在或不属于当前线索池')
            await this.updateExisting(user, prepared.existing, prepared.dto)
          } else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, row.resourceId, prepared.dto)
          }
          successCount++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '导入失败')
        }
      }
      if (errors.length > 0) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async exportXlsx(
    user: AuthUser,
    query: QueryLeadsDto,
    input: { fileName: string; headList: string[]; ids?: string[]; poolId?: string },
  ) {
    const poolMode = Boolean(input.poolId)
    if (poolMode) await this.pools.assertPoolMember(user, 'lead', input.poolId as string)
    const effectiveQuery: QueryLeadsDto = {
      ...query,
      scope: poolMode ? 'pool' : 'mine',
      poolId: poolMode ? input.poolId : undefined,
    }
    const items = await this.collectExportItems(user, effectiveQuery, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['status', '状态'],
      ['createdAt', '创建时间'],
      ['updatedAt', '更新时间'],
      ['lastFollowedAt', '最近跟进'],
    ])
    const columns = input.headList.map((key) => {
      const field = fieldMap.get(key)
      const extraLabel = extraColumns.get(key)
      if (!field && !extraLabel) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extraLabel as string) }
    })
    const statusLabels: Record<string, string> = {
      FOLLOWING: '跟进中',
      CONVERTED: '已转化',
      INVALID: '无效',
    }
    const rows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          const field = fieldMap.get(column.key)
          if (field) return [column.key, formatForExport(field, source)]
          if (column.key === 'status') return [column.key, statusLabels[item.status] ?? item.status]
          return [column.key, source[column.key] ?? '']
        }),
      )
    })
    return this.exportTasks.create(user, {
      module: poolMode ? 'lead_pool' : 'lead',
      fileName: input.fileName,
      columns,
      rows,
    })
  }

  /** 批量导入 */
  async bulkImport(user: AuthUser, rows: Record<string, unknown>[]) {
    if (rows.length === 0) throw new BadRequestException('没有可导入的数据')
    if (rows.length > 500) throw new BadRequestException('单次最多导入 500 行')
    let success = 0
    const errors: string[] = []
    for (const [index, row] of rows.entries()) {
      try {
        const { customData, ...rest } = row as { customData?: Record<string, unknown> } & Record<
          string,
          unknown
        >
        await this.create(user, {
          name: String(rest.name ?? ''),
          contactName: rest.contactName ? String(rest.contactName) : undefined,
          phone: rest.phone ? String(rest.phone) : undefined,
          email: rest.email ? String(rest.email) : undefined,
          toPool: rest.toPool === true,
          customData,
        })
        success++
      } catch (e) {
        errors.push(`第 ${index + 2} 行: ${e instanceof Error ? e.message : '导入失败'}`)
      }
    }
    return {
      success,
      failed: errors.length,
      errors: errors.slice(0, 20),
      name: `导入线索 ${success} 条`,
    }
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
    poolId?: string,
  ): Promise<{ dto: UpdateLeadDto; existing?: Lead }> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const dto: UpdateLeadDto = {}
    const customData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap.get(key)
      if (!field || field.hidden || field.type === 'formula') continue
      this.metadata.validateBatchFieldValue(field, value)
      if (poolId && (key === 'owner' || key === 'ownerId'))
        throw new BadRequestException('线索池导入不允许设置负责人')
      if (key === 'owner' || key === 'ownerId') {
        dto.ownerId = await this.resolveImportOwner(user, String(value))
      } else if (key.startsWith('cf_')) {
        customData[key] = value
      } else if (key === 'contact') {
        dto.contactName = value === null || value === undefined ? undefined : String(value)
      } else {
        ;(dto as Record<string, unknown>)[key] = value
      }
    }
    if (Object.keys(customData).length > 0) dto.customData = customData
    await this.fieldValues.validate(user.tenantId, 'clue', customData, {
      mode: importType === 'ADD' ? 'create' : 'update',
      ...(resourceId ? { resourceId } : {}),
    })

    if (importType === 'ADD') {
      const name = typeof dto.name === 'string' ? dto.name.trim() : ''
      if (!name) throw new BadRequestException('线索名称不能为空')
      if (!poolId)
        await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.ownerId ?? user.id)
      else await this.pools.resolveTargetPool(user, 'lead', poolId)
      return { dto }
    }

    if (!resourceId) throw new BadRequestException('唯一ID不能为空')
    const existing = poolId
      ? await this.prisma.clue.findFirst({
          where: {
            id: resourceId,
            organizationId: user.tenantId,
            inSharedPool: true,
            poolId,
          },
        })
      : await this.ensureInScope(user, resourceId, 'lead:import')
    if (!existing) throw new BadRequestException('线索不存在或不属于当前线索池')
    if (dto.ownerId && dto.ownerId !== existing.owner) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.ownerId)
    }
    return { dto, existing }
  }

  private async resolveImportOwner(user: AuthUser, value: string): Promise<string> {
    const input = value.trim()
    if (!input) throw new BadRequestException('负责人不能为空')
    const direct = await this.prisma.user.findFirst({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        OR: [{ id: input }, { email: { equals: input, mode: 'insensitive' } }],
      },
      select: { id: true },
    })
    if (direct) return direct.id
    const byName = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, status: 'ACTIVE', name: input },
      select: { id: true },
      take: 2,
    })
    if (byName.length === 0) throw new BadRequestException(`负责人「${input}」不存在或已禁用`)
    if (byName.length > 1) throw new BadRequestException(`负责人名称「${input}」不唯一，请填写邮箱`)
    return byName[0].id
  }

  private async collectExportItems(user: AuthUser, query: QueryLeadsDto, ids?: string[]) {
    const all: LeadVO[] = []
    const pageSize = 500
    let page = 1
    while (true) {
      const result = await this.findAll(user, { ...query, page, pageSize })
      all.push(...result.items)
      if (all.length >= result.total || result.items.length === 0) break
      page++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size)
      throw new BadRequestException('选中数据包含不存在或无权导出的线索')
    return selected
  }

  private async deleteLeadResources(user: AuthUser, leads: Lead[]) {
    const ids = leads.map((lead) => lead.id)
    await this.prisma.$transaction(async (tx) => {
      await tx.followUpRecord.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'lead', targetId: { in: ids } },
      })
      await tx.clueOwner.deleteMany({
        where: { clueId: { in: ids }, clue: { organizationId: user.tenantId } },
      })
      await tx.attachment.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'lead', targetId: { in: ids } },
      })
      await tx.clue.deleteMany({ where: { organizationId: user.tenantId, id: { in: ids } } })
    })
    for (const lead of leads) {
      await this.changeLog.record(user, {
        module: 'lead',
        action: 'delete',
        targetId: lead.id,
        targetName: lead.name,
        before: lead,
        after: null,
      })
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CLUE_DELETED',
        operatorId: user.id,
        recipientIds: [lead.owner],
        excludeSelf: true,
        type: 'system',
        title: '线索已删除',
        content: `${user.name} 删除了线索「${lead.name}」`,
        link: '/leads',
      })
    }
  }

  private async notifyAssign(
    user: AuthUser,
    leadId: string,
    leadName: string,
    ownerId: string,
    event: MessageTaskEvent,
  ) {
    await this.notifications.send({
      tenantId: user.tenantId,
      event,
      operatorId: user.id,
      recipientIds: [ownerId],
      excludeSelf: true,
      type: 'assign',
      title: event === 'CLUE_ADD' ? '新建线索' : '线索已分配给你',
      content: `${user.name} 将线索「${leadName}」分配给你`,
      link: `/leads?id=${leadId}`,
    })
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

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId, AND: [scope as Prisma.ClueWhereInput] },
    })
    if (!lead) throw new NotFoundException('线索不存在或不在你的数据范围内')
    return lead
  }

  private async filterIds(
    organizationId: string,
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ): Promise<string[]> {
    const fields = await this.metadata.listFields(organizationId, MODULE)
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.key, field],
        ...(field.key === 'owner' ? ([['ownerId', field]] as [string, FieldVO][]) : []),
      ]),
    )
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key.startsWith('cf_')) {
          return new Set(
            await this.fieldValues.filterResourceIds(organizationId, 'clue', [condition]),
          )
        }
        const normalized = condition.key === 'ownerId' ? { ...condition, key: 'owner' } : condition
        const clauses = buildFilterClauses(fieldMap, [normalized])
        const rows = await this.prisma.clue.findMany({
          where: { organizationId, AND: clauses as Prisma.ClueWhereInput[] },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }),
    )
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce(
          (result, set) => new Set([...result].filter((id) => set.has(id))),
          sets[0] ?? new Set<string>(),
        ),
    ]
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
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

  private async toSingleVO(user: AuthUser, lead: Lead): Promise<LeadVO> {
    const [fields, ownerMap, values] = await Promise.all([
      this.metadata.listFields(user.tenantId, MODULE),
      this.ownerNames([lead.owner]),
      this.fieldValues.load(user.tenantId, 'clue', [lead.id]),
    ])
    return this.toVO(lead, fields, ownerMap, values.get(lead.id) ?? {})
  }

  private toVO(
    lead: Lead,
    fields: FieldVO[],
    ownerMap: Map<string, string>,
    customData: Record<string, unknown>,
  ): LeadVO {
    const record: Record<string, unknown> = {
      name: lead.name,
      contactName: lead.contact,
      phone: lead.phone,
      email: null,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: lead.id,
      name: lead.name,
      contactName: lead.contact,
      phone: lead.phone,
      email: null,
      status: lead.stage as LeadVO['status'],
      inPool: lead.inSharedPool,
      poolId: lead.poolId,
      ownerId: lead.owner,
      ownerName: lead.owner ? (ownerMap.get(lead.owner) ?? null) : null,
      deptId: null,
      customData: { ...customData, ...formulas },
      transitionType: lead.transitionType,
      transitionId: lead.transitionId,
      collectedAt: lead.collectionTime ? new Date(Number(lead.collectionTime)).toISOString() : null,
      poolEnteredAt: lead.inSharedPool ? new Date(Number(lead.updateTime)).toISOString() : null,
      lastFollowedAt: lead.followTime ? new Date(Number(lead.followTime)).toISOString() : null,
      createdAt: new Date(Number(lead.createTime)).toISOString(),
      updatedAt: new Date(Number(lead.updateTime)).toISOString(),
    }
  }
}
