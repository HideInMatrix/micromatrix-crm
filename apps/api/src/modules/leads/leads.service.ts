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
import { DictionariesService } from '../dictionaries/dictionaries.service'
import { HomeFilterService } from '../home/home-filter.service'
import { MetadataService } from '../metadata/metadata.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import { CluePoolRepository } from '../pool-rules/clue-pool.repository'
import { CustomerPoolRepository } from '../pool-rules/customer-pool.repository'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import {
  ClueAddDto,
  ClueChartDto,
  CluePageDto,
  ClueRetransitionCustomerDto,
  ClueTransitionCustomerDto,
  ClueTransitionCustomerPageDto,
  ClueUpdateDto,
  TransformClueDto,
  type ModuleFieldValueDto,
} from './dto/clue.dto'

const MODULE = 'lead'

interface LeadCreateInput {
  name: string
  contactName?: string
  phone?: string
  products?: string[]
  ownerId?: string
  customData?: Record<string, unknown>
  toPool?: boolean
  poolId?: string
}

type LeadUpdateInput = Partial<LeadCreateInput>

interface LeadQueryInput {
  page?: number
  pageSize?: number
  keyword?: string
  scope?: 'mine' | 'pool'
  poolId?: string
  status?: 'NEW' | 'FOLLOWING' | 'INTERESTED' | 'SUCCESS' | 'FAIL'
  filters?: string | FilterCondition[]
  viewId?: string
  homeFilter?: string
  sort?: { fieldId: string; direction: 'asc' | 'desc' | 'ASC' | 'DESC' }
}

interface AssignLeadInput {
  ownerId: string
}

interface LeadAssociationPrepared {
  contactNameUnique: boolean
  contactPhoneUnique: boolean
  contactCustomData: Map<string, Record<string, unknown>>
  opportunityCustomData: Record<string, unknown>
  ownerMap: Map<string, { id: string; deptId: string | null }>
  firstStage: { id: string } | null
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly notifications: BusinessNotificationsService,
    private readonly opportunities: OpportunitiesService,
    private readonly pools: ResourcePoolsService,
    private readonly cluePools: CluePoolRepository,
    private readonly customerPools: CustomerPoolRepository,
    private readonly changeLog: BusinessChangeLogService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly customers: CustomersService,
    private readonly homeFilters: HomeFilterService,
    private readonly dictionaries: DictionariesService,
  ) {}

  getModuleForm(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, MODULE)
  }

  async page(user: AuthUser, dto: CluePageDto) {
    const result = await this.findAll(user, {
      page: dto.current,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      filters: dto.filters,
      viewId: dto.viewId,
      homeFilter: dto.homeFilter,
      sort: dto.sort,
      scope: 'mine',
    })
    return {
      list: result.items,
      total: result.total,
      pageSize: result.pageSize,
      current: result.page,
      optionMap: {},
    }
  }

  async poolPage(user: AuthUser, poolId: string, dto: CluePageDto) {
    await this.pools.assertPoolMember(user, 'lead', poolId)
    const result = await this.findAll(user, {
      page: dto.current,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      filters: dto.filters,
      viewId: dto.viewId,
      sort: dto.sort,
      scope: 'pool',
      poolId,
    })
    return {
      list: result.items,
      total: result.total,
      pageSize: result.pageSize,
      current: result.page,
      optionMap: {},
    }
  }

  async addClue(user: AuthUser, dto: ClueAddDto) {
    return this.create(user, {
      name: dto.name,
      ownerId: dto.owner,
      contactName: dto.contact,
      phone: dto.phone,
      products: dto.products,
      customData: await this.moduleFieldsToCustomData(user, dto.moduleFields),
    })
  }

  async updateClue(user: AuthUser, dto: ClueUpdateDto) {
    return this.update(user, dto.id, {
      name: dto.name,
      ownerId: dto.owner,
      contactName: dto.contact,
      phone: dto.phone,
      products: dto.products,
      customData:
        dto.moduleFields === undefined
          ? undefined
          : await this.moduleFieldsToCustomData(user, dto.moduleFields),
    })
  }

  async updateStatus(
    user: AuthUser,
    dto: { id: string; stage: 'NEW' | 'FOLLOWING' | 'INTERESTED' | 'SUCCESS' | 'FAIL' },
  ) {
    const lead = await this.ensureInScope(user, dto.id, 'lead:update')
    if (lead.transitionId) throw new BadRequestException('已转换线索不能继续修改状态')
    const updated = await this.prisma.clue.update({
      where: { id: lead.id },
      data: {
        lastStage: lead.stage,
        stage: dto.stage,
        updateUser: user.id,
        updateTime: BigInt(Date.now()),
      },
    })
    await this.changeLog.record(user, {
      module: 'lead',
      action: 'updateStatus',
      targetId: lead.id,
      targetName: lead.name,
      before: { stage: lead.stage },
      after: { stage: updated.stage },
    })
    return { id: updated.id, stage: updated.stage, lastStage: updated.lastStage }
  }

  async getTabEnable(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, 'menu:lead')
    return {
      all: scope.all,
      dept: !scope.all && scope.deptIds.length > 0,
    }
  }

  async chart(user: AuthUser, dto: ClueChartDto, poolId?: string) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const resolveField = (fieldId?: string) =>
      fieldId ? fields.find((field) => field.id === fieldId || field.key === fieldId) : undefined
    const categoryField = resolveField(dto.chartConfig.categoryAxis.fieldId)
    if (!categoryField) throw new BadRequestException('图表类别字段不存在')
    const subCategoryField = resolveField(dto.chartConfig.subCategoryAxis?.fieldId)
    if (dto.chartConfig.subCategoryAxis && !subCategoryField) {
      throw new BadRequestException('图表子类别字段不存在')
    }
    const aggregateMethod = dto.chartConfig.valueAxis.aggregateMethod ?? 'COUNT'
    const valueField = resolveField(dto.chartConfig.valueAxis.fieldId)
    if (aggregateMethod !== 'COUNT' && !valueField) {
      throw new BadRequestException('图表值字段不存在')
    }

    const items: LeadVO[] = []
    let page = 1
    const pageSize = 500
    while (true) {
      const result = await this.findAll(user, {
        page,
        pageSize,
        scope: poolId ? 'pool' : 'mine',
        poolId,
        viewId: dto.viewId,
        filters: dto.filters,
      })
      items.push(...result.items)
      if (items.length >= result.total || result.items.length === 0) break
      page++
    }

    type AggregateBucket = {
      category: unknown
      categoryName: string
      subCategory: unknown
      subCategoryName: string
      values: number[]
      count: number
    }
    const buckets = new Map<string, AggregateBucket>()
    for (const item of items) {
      const category = this.chartFieldValue(item, categoryField.key)
      const subCategory = subCategoryField
        ? this.chartFieldValue(item, subCategoryField.key)
        : null
      const key = JSON.stringify([category, subCategory])
      const bucket = buckets.get(key) ?? {
        category,
        categoryName: this.chartFieldLabel(categoryField, category),
        subCategory,
        subCategoryName: subCategoryField
          ? this.chartFieldLabel(subCategoryField, subCategory)
          : '',
        values: [],
        count: 0,
      }
      bucket.count++
      if (valueField) {
        const raw = this.chartFieldValue(item, valueField.key)
        const numeric = typeof raw === 'number' ? raw : Number(raw)
        if (Number.isFinite(numeric)) bucket.values.push(numeric)
      }
      buckets.set(key, bucket)
    }

    return [...buckets.values()].map((bucket) => ({
      categoryAxis: bucket.category == null ? '' : String(bucket.category),
      categoryAxisName: bucket.categoryName,
      subCategoryAxis: bucket.subCategory == null ? '' : String(bucket.subCategory),
      subCategoryAxisName: bucket.subCategoryName,
      valueAxis: this.aggregateChartValues(aggregateMethod, bucket.count, bucket.values),
    }))
  }

  private async moduleFieldsToCustomData(
    user: AuthUser,
    moduleFields?: ModuleFieldValueDto[],
  ): Promise<Record<string, unknown>> {
    if (!moduleFields?.length) return {}
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const byId = new Map(fields.map((field) => [field.id, field]))
    const customData: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = byId.get(item.fieldId)
      if (!field) throw new BadRequestException(`动态字段「${item.fieldId}」不存在`)
      if (field.system || !field.key.startsWith('cf_')) {
        throw new BadRequestException(`字段「${field.label}」不是可写动态字段`)
      }
      customData[field.key] = item.fieldValue
    }
    return customData
  }

  private chartFieldValue(item: LeadVO, key: string): unknown {
    const systemValues: Record<string, unknown> = {
      name: item.name,
      contact: item.contactName,
      phone: item.phone,
      owner: item.ownerId,
      stage: item.status,
      collectionTime: item.collectedAt,
      followTime: item.lastFollowedAt,
      createTime: item.createdAt,
      updateTime: item.updatedAt,
      poolId: item.poolId,
      transitionType: item.transitionType,
      transitionId: item.transitionId,
    }
    return key.startsWith('cf_') ? item.customData[key] : systemValues[key]
  }

  private chartFieldLabel(field: FieldVO, value: unknown) {
    if (value == null || value === '') return '空'
    const option = field.options?.find((item) => item.value === value)
    return option?.label ?? String(value)
  }

  private aggregateChartValues(
    method: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN',
    count: number,
    values: number[],
  ) {
    if (method === 'COUNT') return count
    if (values.length === 0) return 0
    if (method === 'SUM') return values.reduce((sum, value) => sum + value, 0)
    if (method === 'AVG') return values.reduce((sum, value) => sum + value, 0) / values.length
    if (method === 'MAX') return Math.max(...values)
    return Math.min(...values)
  }

  async findAll(user: AuthUser, query: LeadQueryInput): Promise<PaginatedResult<LeadVO>> {
    const { page = 1, pageSize = 10, keyword, scope = 'mine', status } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const adHocConditions = Array.isArray(query.filters) ? query.filters : parseFilters(query.filters)
    const homeFilter = this.homeFilters.parse(query.homeFilter, 'lead')
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

    // 线索池按 Pool Scope/管理员范围开放；非池数据按普通线索 DataScope 过滤。
    let scopeClause: Prisma.ClueWhereInput
    if (scope === 'pool') {
      if (homeFilter) throw new BadRequestException('首页统计筛选不能用于线索池')
      if (query.poolId) {
        await this.pools.assertPoolMember(user, 'lead', query.poolId)
        scopeClause = { inSharedPool: true, poolId: query.poolId }
      } else {
        const options = await this.pools.options(user, 'lead')
        scopeClause = {
          inSharedPool: true,
          poolId: { in: options.map((pool) => pool.id) },
        }
      }
    } else {
      scopeClause = homeFilter
        ? await this.homeFilters.clueWhere(user, homeFilter)
        : {
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

    const sort = this.resolveClueSort(fields, query.sort)
    if (sort.valueKey) {
      // Cordys 允许按动态字段排序。动态字段存放在 clue_field/blob，先在当前权限/筛选
      // 结果集内完成 VO 映射后排序，再分页，避免退回旧 customData JSON 或伪造数据库列。
      const allRows = await this.prisma.clue.findMany({ where, orderBy: { createTime: 'desc' } })
      const [ownerMap, values] = await Promise.all([
        this.ownerNames(allRows.map((item) => item.owner)),
        this.fieldValues.load(
          user.tenantId,
          'clue',
          allRows.map((item) => item.id),
        ),
      ])
      const allItems = allRows.map((item) =>
        this.toVO(item, fields, ownerMap, values.get(item.id) ?? {}),
      )
      allItems.sort((left, right) =>
        this.compareClueSortValues(
          this.chartFieldValue(left, sort.valueKey as string),
          this.chartFieldValue(right, sort.valueKey as string),
          sort.direction,
        ),
      )
      return {
        items: allItems.slice((page - 1) * pageSize, page * pageSize),
        total: allItems.length,
        page,
        pageSize,
      }
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.clue.findMany({
        where,
        orderBy: sort.orderBy,
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

  private resolveClueSort(
    fields: FieldVO[],
    sort?: { fieldId: string; direction: 'asc' | 'desc' | 'ASC' | 'DESC' },
  ): {
    orderBy: Prisma.ClueOrderByWithRelationInput
    valueKey?: string
    direction: 'asc' | 'desc'
  } {
    if (!sort) return { orderBy: { createTime: 'desc' }, direction: 'desc' }
    const direction = sort.direction.toLowerCase() as 'asc' | 'desc'
    const field = fields.find((item) => item.id === sort.fieldId || item.key === sort.fieldId)
    const key = field?.key ?? sort.fieldId
    if (field && (field.key.startsWith('cf_') || field.type === 'formula')) {
      return { orderBy: { createTime: 'desc' }, valueKey: field.key, direction }
    }
    const columns: Record<string, keyof Prisma.ClueOrderByWithRelationInput> = {
      name: 'name',
      contact: 'contact',
      contactName: 'contact',
      phone: 'phone',
      owner: 'owner',
      ownerId: 'owner',
      stage: 'stage',
      status: 'stage',
      collectionTime: 'collectionTime',
      collectedAt: 'collectionTime',
      followTime: 'followTime',
      lastFollowedAt: 'followTime',
      createTime: 'createTime',
      createdAt: 'createTime',
      updateTime: 'updateTime',
      updatedAt: 'updateTime',
      poolId: 'poolId',
      transitionType: 'transitionType',
    }
    const column = columns[key]
    if (!column) throw new BadRequestException('排序字段不存在或不可排序')
    return {
      orderBy: { [column]: direction } as Prisma.ClueOrderByWithRelationInput,
      direction,
    }
  }

  private compareClueSortValues(
    left: unknown,
    right: unknown,
    direction: 'asc' | 'desc',
  ): number {
    const multiplier = direction === 'asc' ? 1 : -1
    const leftEmpty = left === null || left === undefined || left === ''
    const rightEmpty = right === null || right === undefined || right === ''
    if (leftEmpty && rightEmpty) return 0
    if (leftEmpty) return 1
    if (rightEmpty) return -1
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * multiplier
    if (typeof left === 'boolean' && typeof right === 'boolean') {
      return (Number(left) - Number(right)) * multiplier
    }
    return String(left).localeCompare(String(right), 'zh-CN', { numeric: true }) * multiplier
  }

  async findOne(user: AuthUser, id: string): Promise<LeadVO> {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId, inSharedPool: false },
    })
    if (!lead) throw new NotFoundException('线索不存在')
    if (!(await this.dataScope.matchesDirectOwner(user, lead.owner, 'menu:lead'))) {
      throw new NotFoundException('线索不存在或不在你的数据范围内')
    }
    return this.toSingleVO(user, lead)
  }

  async findPoolOne(user: AuthUser, id: string): Promise<LeadVO> {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId, inSharedPool: true },
    })
    if (!lead?.poolId) throw new NotFoundException('线索池线索不存在')
    await this.pools.assertPoolMember(user, 'lead', lead.poolId)
    return this.toSingleVO(user, lead)
  }

  async create(user: AuthUser, dto: LeadCreateInput): Promise<LeadVO> {
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
          products: dto.products?.length ? JSON.stringify(dto.products) : null,
          stage: 'NEW',
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

  async update(user: AuthUser, id: string, dto: LeadUpdateInput): Promise<LeadVO> {
    const existing = await this.ensureInScope(user, id, 'lead:update')
    return this.updateExisting(user, existing, dto)
  }

  private async updateExisting(
    user: AuthUser,
    existing: Lead,
    dto: LeadUpdateInput,
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
          ...(dto.products !== undefined
            ? { products: dto.products.length ? JSON.stringify(dto.products) : null }
            : {}),
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
    const lead = await this.ensureInScope(user, id, 'lead:recycle')
    if (lead.transitionId) throw new BadRequestException('已转换线索不能移入线索池')
    await this.dictionaries.validateReason(user.tenantId, 'CLUE_POOL_RS', reasonId)
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
    if (!lead.poolId) throw new BadRequestException('线索不属于有效线索池')
    await this.pools.assertPoolMember(user, 'lead', lead.poolId)
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

  /** Cordys /pool/lead/pick：资源必须仍属于请求中的同一个池。 */
  async poolClaim(user: AuthUser, clueId: string, poolId: string) {
    await this.pools.assertPoolMember(user, 'lead', poolId)
    const lead = await this.prisma.clue.findFirst({
      where: {
        id: clueId,
        organizationId: user.tenantId,
        inSharedPool: true,
        poolId,
      },
    })
    if (!lead) throw new BadRequestException('线索不存在、已被领取或不属于指定线索池')
    const claimed = await this.cluePools.pick({
      organizationId: user.tenantId,
      clueId,
      ownerId: user.id,
      operatorId: user.id,
      poolAdmin: await this.pools.isPoolManager(user, 'lead', poolId),
    })
    return { id: claimed.id, name: claimed.name }
  }

  async poolBatchClaim(
    user: AuthUser,
    ids: string[],
    poolId: string,
  ): Promise<BatchAffectResult> {
    const leads = await this.assertPoolBatchResources(user, ids, poolId)
    for (const lead of leads) await this.poolClaim(user, lead.id, poolId)
    return { success: leads.length, fail: 0, failedIds: [] }
  }

  /** 分配负责人（主管操作） */
  async assign(user: AuthUser, id: string, dto: AssignLeadInput) {
    const lead = await this.prisma.clue.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!lead) throw new NotFoundException('线索不存在')
    const owner = await this.resolveOwner(user, dto.ownerId)
    if (lead.inSharedPool) {
      if (!lead.poolId) throw new BadRequestException('线索不属于有效线索池')
      await this.pools.assertPoolMember(user, 'lead', lead.poolId)
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

  /** Cordys /pool/lead/assign：只允许分配池内线索，不得退化成普通线索转移。 */
  async poolAssign(user: AuthUser, clueId: string, ownerId: string, expectedPoolId?: string) {
    const lead = await this.prisma.clue.findFirst({
      where: { id: clueId, organizationId: user.tenantId, inSharedPool: true },
    })
    if (!lead?.poolId) throw new NotFoundException('线索池线索不存在')
    if (expectedPoolId && lead.poolId !== expectedPoolId) {
      throw new BadRequestException('线索不属于指定线索池')
    }
    await this.pools.assertPoolMember(user, 'lead', lead.poolId)
    const owner = await this.resolveOwner(user, ownerId)
    await this.cluePools.assign({
      organizationId: user.tenantId,
      clueId: lead.id,
      ownerId: owner.id,
      operatorId: user.id,
      poolAdmin: await this.pools.isPoolManager(user, 'lead', lead.poolId),
    })
    await this.notifyAssign(user, lead.id, lead.name, owner.id, 'CLUE_DISTRIBUTED')
    return { id: lead.id, name: lead.name }
  }

  async poolBatchAssign(
    user: AuthUser,
    ids: string[],
    ownerId: string,
    expectedPoolId?: string,
  ): Promise<BatchAffectResult> {
    const leads = await this.assertPoolBatchResources(user, ids, expectedPoolId)
    const poolId = leads[0]?.poolId
    if (!poolId) throw new BadRequestException('请选择线索池线索')
    for (const lead of leads) await this.poolAssign(user, lead.id, ownerId, poolId)
    return { success: leads.length, fail: 0, failedIds: [] }
  }

  /** Cordys /lead/batch/transfer：普通线索批量转移，全部资源先鉴权后单事务写入。 */
  async batchTransfer(user: AuthUser, ids: string[], ownerId: string) {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) throw new BadRequestException('请选择线索')
    const [owner, leads] = await Promise.all([
      this.resolveOwner(user, ownerId),
      Promise.all(uniqueIds.map((id) => this.ensureInScope(user, id, 'lead:transfer'))),
    ])
    await this.cluePools.batchTransfer({
      organizationId: user.tenantId,
      clueIds: uniqueIds,
      ownerId: owner.id,
      operatorId: user.id,
    })
    for (const lead of leads) {
      if (lead.owner === owner.id) continue
      await this.notifyAssign(user, lead.id, lead.name, owner.id, 'TRANSFER_CLUE')
      await this.changeLog.record(user, {
        module: 'lead',
        action: 'transfer',
        targetId: lead.id,
        targetName: lead.name,
        before: { owner: lead.owner },
        after: { owner: owner.id },
      })
    }
    return { count: leads.filter((lead) => lead.owner !== owner.id).length }
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

    const updateDto: LeadUpdateInput = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : field.key === 'contact'
        ? ({ contactName: dto.fieldValue } as LeadUpdateInput)
        : ({ [field.key]: dto.fieldValue } as LeadUpdateInput)

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
      return this.poolBatchAssign(user, dto.ids, dto.fieldValue, dto.poolId)
    }

    const updateDto: LeadUpdateInput = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : field.key === 'contact'
        ? ({ contactName: dto.fieldValue } as LeadUpdateInput)
        : ({ [field.key]: dto.fieldValue } as LeadUpdateInput)
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

  private async assertPoolBatchResources(user: AuthUser, ids: string[], expectedPoolId?: string) {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new BadRequestException('请选择线索')
    const leads = await this.prisma.clue.findMany({
      where: {
        organizationId: user.tenantId,
        id: { in: uniqueIds },
        inSharedPool: true,
      },
    })
    if (leads.length !== uniqueIds.length) {
      throw new BadRequestException('存在不存在或已被领取的线索')
    }
    const poolIds = [
      ...new Set(leads.map((lead) => lead.poolId).filter((id): id is string => Boolean(id))),
    ]
    if (poolIds.length !== 1) throw new BadRequestException('所选线索必须全部属于同一个线索池')
    const poolId = poolIds[0]
    if (expectedPoolId && poolId !== expectedPoolId) {
      throw new BadRequestException('所选线索不属于指定线索池')
    }
    await this.pools.assertPoolMember(user, 'lead', poolId)
    const byId = new Map(leads.map((lead) => [lead.id, lead]))
    return uniqueIds.map((id) => byId.get(id) as Lead)
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
      data: {
        lastStage: lead.stage,
        stage: 'FAIL',
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
    })
    return { id, name: lead.name }
  }

  /** Cordys /lead/transform：客户+联系人固定创建，商机可选。 */
  async transform(user: AuthUser, dto: TransformClueDto) {
    this.assertFunctionalPermission(user, 'customer:create', '无新建客户权限')
    if (dto.oppCreated) {
      this.assertFunctionalPermission(user, 'opportunity:create', '无新建商机权限')
      if (!dto.oppName?.trim()) throw new BadRequestException('请输入商机名称')
      await this.opportunities.listStages(user.tenantId)
    }

    const lead = await this.ensureInScope(user, dto.clueId, 'lead:update')
    if (lead.transitionId || lead.transitionType === 'CUSTOMER') {
      throw new BadRequestException('线索已转客户')
    }
    if (!lead.owner) throw new BadRequestException('线索暂无负责人，无法转换')

    const matchedCustomer = await this.selectTransformCustomer(user, lead)
    const customerCreateDto = !matchedCustomer
      ? {
          name: lead.name,
          phone: lead.phone ?? undefined,
          ownerId: lead.owner,
          customData: await this.mapLeadCustomData(user.tenantId, 'customer', lead, true),
        }
      : null
    const customerPrepared = customerCreateDto
      ? await this.customers.prepareCreateForTransaction(user, customerCreateDto)
      : null
    const associationPrepared = await this.prepareLeadAssociation(user, [lead], {
      opportunityName: dto.oppCreated ? dto.oppName?.trim() : undefined,
    })

    const transactionResult = await this.prisma.$transaction(async (tx) => {
      const createdCustomer =
        customerCreateDto && customerPrepared
          ? await this.customers.createPreparedInTransaction(
              user,
              customerCreateDto,
              customerPrepared,
              tx,
            )
          : null
      const customerId = createdCustomer?.id ?? matchedCustomer?.id
      if (!customerId) throw new BadRequestException('客户创建失败')
      const associated = await this.associateLeadsToCustomerInTransaction(
        tx,
        user,
        [lead],
        customerId,
        {
          opportunityName: dto.oppCreated ? dto.oppName?.trim() : undefined,
          copyFollowArtifacts: true,
        },
        associationPrepared,
      )
      return { customerId, createdCustomer, associated }
    })

    if (transactionResult.createdCustomer && customerPrepared) {
      await this.customers.notifyCreatedCustomer(
        user,
        transactionResult.createdCustomer,
        customerPrepared.owner.id,
      )
    }
    await this.notifyLeadAssociation(
      user,
      [lead],
      transactionResult.customerId,
      transactionResult.associated.opportunityId,
      dto.oppCreated ? dto.oppName?.trim() : undefined,
    )
    return {
      clueId: lead.id,
      customerId: transactionResult.customerId,
      contactId: transactionResult.associated.contactIds[0] ?? null,
      opportunityId: transactionResult.associated.opportunityId,
    }
  }

  /** Cordys /lead/transition/account：独立路径，不复制 Follow，也不创建协作关系。 */
  async transitionCustomer(user: AuthUser, dto: ClueTransitionCustomerDto) {
    this.assertFunctionalPermission(user, 'customer:create', '无新建客户权限')
    const lead = await this.ensureInScope(user, dto.clueId, 'lead:update')
    if (!lead.owner) throw new BadRequestException('线索暂无负责人，无法关联客户')
    const leadOwner = lead.owner
    const { clueId: _, ...customerPayload } = dto
    const prepared = await this.customers.prepareCreateForTransaction(user, customerPayload)
    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await this.customers.createPreparedInTransaction(
        user,
        customerPayload,
        prepared,
        tx,
      )
      let contactId: string | null = null
      if (lead.contact?.trim()) {
        const duplicate = lead.phone?.trim()
          ? await tx.customerContact.findFirst({
              where: { organizationId: user.tenantId, phone: lead.phone.trim() },
              select: { id: true },
            })
          : null
        if (!duplicate) {
          const contact = await tx.customerContact.create({
            data: {
              customerId: customer.id,
              owner: customer.owner ?? leadOwner,
              name: lead.contact.trim(),
              phone: lead.phone,
              enable: true,
              organizationId: user.tenantId,
              createTime: BigInt(Date.now()),
              updateTime: BigInt(Date.now()),
              createUser: user.id,
              updateUser: user.id,
            },
          })
          contactId = contact.id
        }
      }
      await tx.clue.update({
        where: { id: lead.id },
        data: {
          transitionType: 'CUSTOMER',
          transitionId: customer.id,
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      return { customer, contactId }
    })
    await this.customers.notifyCreatedCustomer(user, result.customer, prepared.owner.id)
    await this.notifyLeadAssociation(user, [lead], result.customer.id, null)
    return {
      clueId: lead.id,
      customerId: result.customer.id,
      contactId: result.contactId,
    }
  }

  /** Cordys /lead/re-transition/account：关联/重新关联已有客户。 */
  async retransitionCustomer(user: AuthUser, dto: ClueRetransitionCustomerDto) {
    const customer = await this.assertTransitionCustomerAccessible(user, dto.customerId)
    const poolAdmin = customer.inSharedPool
      ? await this.pools.isPoolManager(user, 'customer', customer.poolId)
      : false
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

    const ownerIds = [
      ...new Set(leads.map((lead) => lead.owner).filter((id): id is string => !!id)),
    ]
    const activeOwners = new Set(
      (
        await this.prisma.user.findMany({
          where: { tenantId: user.tenantId, id: { in: ownerIds }, status: 'ACTIVE' },
          select: { id: true },
        })
      ).map((owner) => owner.id),
    )
    const validLeads = leads.filter(
      (lead): lead is Lead & { owner: string } => !!lead.owner && activeOwners.has(lead.owner),
    )
    const skippedIds = leads
      .filter((lead) => !lead.owner || !activeOwners.has(lead.owner))
      .map((lead) => lead.id)
    const associationPrepared = await this.prepareLeadAssociation(user, validLeads)
    const result = await this.prisma.$transaction(async (tx) => {
      if (customer.inSharedPool) {
        if (!customer.poolId) throw new BadRequestException('客户不属于有效公海')
        await this.customerPools.pickInTransaction(tx, {
          organizationId: user.tenantId,
          customerId: customer.id,
          ownerId: user.id,
          operatorId: user.id,
          poolAdmin,
        })
      }
      return this.associateLeadsToCustomerInTransaction(
        tx,
        user,
        validLeads,
        customer.id,
        { copyFollowArtifacts: true },
        associationPrepared,
      )
    })
    await this.notifyLeadAssociation(user, validLeads, customer.id, null)
    return {
      customerId: customer.id,
      success: validLeads.length,
      skippedIds,
      contactIds: result.contactIds,
    }
  }

  /** Cordys 关联客户抽屉：普通数据范围 + 协作 + 可访问公海。 */
  async transitionCustomerList(user: AuthUser, query: ClueTransitionCustomerPageDto) {
    const result = await this.customers.findTransitionCandidates(user, {
      page: query.current,
      pageSize: query.pageSize,
      keyword: query.keyword,
      filters: query.filters?.length ? JSON.stringify(query.filters) : undefined,
    })
    return {
      ...result,
      items: result.items.map((item) => ({
        ...item,
        selectable: item.collaborationType !== 'READ_ONLY',
      })),
    }
  }

  private async assertTransitionCustomerAccessible(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId: user.tenantId },
    })
    if (!customer) throw new NotFoundException('客户不存在')

    if (customer.inSharedPool) {
      const options = await this.pools.options(user, 'customer')
      const targetPoolId = customer.poolId
      const accessible = !!targetPoolId && options.some((pool) => pool.id === targetPoolId)
      if (!accessible) throw new ForbiddenException('无权访问该公海客户')
      return customer
    }

    if (await this.dataScope.matchesDirectOwner(user, customer.owner, 'customer:read')) {
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

  private async prepareLeadAssociation(
    user: AuthUser,
    leads: Lead[],
    options: { opportunityName?: string } = {},
  ): Promise<LeadAssociationPrepared> {
    // 新租户首次访问 contact 表单时 listFields 会惰性 ensureForm；这里必须串行，
    // 否则两个并发 ensureForm 可能同时 upsert 同一 (organizationId, formKey) 触发 P2002。
    const contactNameUnique = await this.metadata.hasUniqueRule(user.tenantId, 'contact', 'name')
    const contactPhoneUnique = await this.metadata.hasUniqueRule(user.tenantId, 'contact', 'phone')
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
    if (ownerMap.size !== ownerIds.length) {
      throw new BadRequestException('线索负责人不存在或已禁用')
    }
    const firstStage = options.opportunityName
      ? await this.prisma.opportunityStage.findFirst({
          where: { tenantId: user.tenantId, isWon: false, isLost: false },
          orderBy: { sort: 'asc' },
          select: { id: true },
        })
      : null
    if (options.opportunityName && !firstStage) {
      throw new BadRequestException('请先在商机管理中初始化商机阶段')
    }
    return {
      contactNameUnique,
      contactPhoneUnique,
      contactCustomData,
      opportunityCustomData,
      ownerMap,
      firstStage,
    }
  }

  private async associateLeadsToCustomerInTransaction(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    leads: Lead[],
    customerId: string,
    options: { opportunityName?: string; copyFollowArtifacts?: boolean } = {},
    prepared: LeadAssociationPrepared,
  ) {
    if (leads.length === 0) {
      return { contactIds: [] as string[], opportunityId: null as string | null }
    }
    const customer = await tx.customer.findFirst({
      where: { id: customerId, organizationId: user.tenantId },
    })
    if (!customer) throw new NotFoundException('客户不存在')

    const contactIds: string[] = []
    let opportunityId: string | null = null
    let newestFollowedAt = customer.followTime
    let newestFollower = customer.follower

    for (const lead of leads) {
      if (!lead.owner) continue
      const owner = prepared.ownerMap.get(lead.owner)
      if (!owner) throw new BadRequestException('线索负责人不存在或已禁用')

      if (customer.owner !== lead.owner) {
        const existingTeam = await tx.customerCollaboration.findFirst({
          where: { customerId, userId: lead.owner },
          select: { id: true },
        })
        if (!existingTeam) {
          const now = BigInt(Date.now())
          await tx.customerCollaboration.create({
            data: {
              customerId,
              userId: lead.owner,
              collaborationType: 'COLLABORATION',
              createTime: now,
              updateTime: now,
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
        if (prepared.contactNameUnique) uniqueClauses.push({ name: normalizedName })
        if (prepared.contactPhoneUnique && lead.phone?.trim()) {
          uniqueClauses.push({ phone: lead.phone.trim() })
        }
        const duplicate = uniqueClauses.length
          ? await tx.customerContact.findFirst({
              where: { organizationId: user.tenantId, OR: uniqueClauses },
              select: { id: true },
            })
          : null
        if (!duplicate) {
          const now = BigInt(Date.now())
          const contact = await tx.customerContact.create({
            data: {
              customerId,
              owner: lead.owner,
              name: normalizedName,
              phone: lead.phone,
              enable: true,
              organizationId: user.tenantId,
              createTime: now,
              updateTime: now,
              createUser: user.id,
              updateUser: user.id,
            },
          })
          await this.fieldValues.save(
            user.tenantId,
            'customerContact',
            contact.id,
            prepared.contactCustomData.get(lead.id) ?? {},
            'create',
            tx,
          )
          contactId = contact.id
          contactIds.push(contact.id)
        }
      }

      if (options.opportunityName && prepared.firstStage && leads.length === 1) {
        const opportunity = await tx.opportunity.create({
          data: {
            tenantId: user.tenantId,
            name: options.opportunityName,
            customerId,
            contactId,
            stageId: prepared.firstStage.id,
            ownerId: lead.owner,
            deptId: owner.deptId,
            customData: prepared.opportunityCustomData as Prisma.InputJsonValue,
            lastFollowedAt: lead.followTime ? new Date(Number(lead.followTime)) : null,
          },
        })
        opportunityId = opportunity.id
      }

      if (options.copyFollowArtifacts) {
        await this.copyLeadFollowArtifactsInTransaction(
          tx,
          user,
          lead.id,
          customerId,
          contactId,
        )
      }

      if (lead.followTime && (!newestFollowedAt || lead.followTime > newestFollowedAt)) {
        newestFollowedAt = lead.followTime
        newestFollower = lead.follower
      }

      const now = BigInt(Date.now())
      await tx.clue.update({
        where: { id: lead.id },
        data: {
          transitionType: 'CUSTOMER',
          transitionId: customerId,
          inSharedPool: false,
          poolId: null,
          updateTime: now,
          updateUser: user.id,
        },
      })
    }

    if (newestFollowedAt && newestFollowedAt !== customer.followTime) {
      await tx.customer.update({
        where: { id: customerId },
        data: {
          followTime: newestFollowedAt,
          follower: newestFollower,
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
    }

    return { contactIds, opportunityId }
  }

  private async copyLeadFollowArtifactsInTransaction(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    leadId: string,
    customerId: string,
    contactId: string | null,
  ) {
    const sourceRecords = await tx.followUpRecord.findMany({
      where: { tenantId: user.tenantId, targetType: 'lead', targetId: leadId },
      orderBy: { createdAt: 'asc' },
    })
    const recordIdMap = new Map<string, string>()
    for (const record of sourceRecords) {
      const copied = await tx.followUpRecord.create({
        data: {
          tenantId: record.tenantId,
          targetType: 'customer',
          targetId: customerId,
          type: record.type,
          content: record.content,
          nextFollowAt: record.nextFollowAt,
          ownerId: record.ownerId,
          ownerName: record.ownerName,
          createdAt: record.createdAt,
        },
      })
      recordIdMap.set(record.id, copied.id)
    }

    const sourcePlans = await tx.followUpPlan.findMany({
      where: { tenantId: user.tenantId, targetType: 'lead', targetId: leadId },
      orderBy: { createdAt: 'asc' },
    })
    for (const plan of sourcePlans) {
      const convertedRecordId = plan.convertedRecordId
        ? (recordIdMap.get(plan.convertedRecordId) ?? null)
        : null
      await tx.followUpPlan.create({
        data: {
          tenantId: plan.tenantId,
          targetType: 'customer',
          targetId: customerId,
          contactId,
          content: plan.content,
          method: plan.method,
          estimatedAt: plan.estimatedAt,
          status: plan.status,
          converted: plan.converted && !!convertedRecordId,
          convertedRecordId,
          ownerId: plan.ownerId,
          deptId: plan.deptId,
          createdById: plan.createdById,
          dueNotifiedAt: plan.dueNotifiedAt,
          customData: ((plan.customData as Record<string, unknown> | null) ?? {}) as Prisma.InputJsonValue,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
        },
      })
    }
  }

  private async notifyLeadAssociation(
    user: AuthUser,
    leads: Lead[],
    customerId: string,
    opportunityId: string | null,
    opportunityName?: string,
  ) {
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
      if (opportunityId && opportunityName) {
        await this.notifications.send({
          tenantId: user.tenantId,
          event: 'CLUE_CONVERT_BUSINESS',
          operatorId: user.id,
          recipientIds: [lead.owner],
          excludeSelf: true,
          type: 'system',
          title: '线索已转换为商机',
          content: `线索「${lead.name}」已创建商机「${opportunityName}」`,
          link: `/opportunities/${opportunityId}`,
        })
      }
    }
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
    query: LeadQueryInput,
  ): Promise<{ filename: string; csv: string }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const columns = fields.filter((f) => f.showInList && !f.hidden)
    const result = await this.findAll(user, { ...query, page: 1, pageSize: 5000 })

    const headers = [...columns.map((c) => c.label), '状态', '创建时间']
    const statusLabels: Record<string, string> = {
      NEW: '新建',
      FOLLOWING: '跟进中',
      INTERESTED: '感兴趣',
      SUCCESS: '成功',
      FAIL: '失败',
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

  /** Cordys /pool/lead/template/download：池模板固定排除负责人，不依赖具体 poolId。 */
  async poolImportTemplate(
    user: AuthUser,
    importType: ImportType,
  ): Promise<{ filename: string; data: Buffer }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: ['owner', 'ownerId'],
    })
    return {
      filename: `线索池${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
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
            } as LeadCreateInput)
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
    query: LeadQueryInput,
    input: { fileName: string; headList: string[]; ids?: string[]; poolId?: string },
  ) {
    const poolMode = Boolean(input.poolId)
    if (poolMode) {
      const poolId = input.poolId as string
      await this.pools.assertPoolMember(user, 'lead', poolId)
      if (input.ids?.length) await this.assertPoolBatchResources(user, input.ids, poolId)
    }
    const effectiveQuery: LeadQueryInput = {
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
      NEW: '新建',
      FOLLOWING: '跟进中',
      INTERESTED: '感兴趣',
      SUCCESS: '成功',
      FAIL: '失败',
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
  ): Promise<{ dto: LeadUpdateInput; existing?: Lead }> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const dto: LeadUpdateInput = {}
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

  private async collectExportItems(user: AuthUser, query: LeadQueryInput, ids?: string[]) {
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
      await tx.followUpPlan.deleteMany({
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
        if (condition.key === 'stage') {
          const rows = await this.prisma.clue.findMany({
            where: {
              organizationId,
              ...(condition.op === 'ne'
                ? { NOT: { stage: String(condition.value) } }
                : { stage: String(condition.value) }),
            },
            select: { id: true },
          })
          return new Set(rows.map((row) => row.id))
        }
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
