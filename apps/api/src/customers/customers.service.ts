import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Customer360Resource,
  CustomerRelatedVO,
  CustomerVO,
  DuplicateHitVO,
  FieldVO,
  type FilterCondition,
  ImportResultVO,
  PaginatedResult,
  ReceivablePlanStatus,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../common/auth-user'
import { toCsv } from '../common/csv'
import type {
  BatchAffectResult,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../common/dto/resource-batch.dto'
import { formatForExport } from '../common/export-format'
import { buildFilterClauses, parseFilters } from '../common/filter-builder'
import { DataScopeService } from '../common/services/data-scope.service'
import { BusinessChangeLogService } from '../common/services/business-change-log.service'
import { Customer, Prisma } from '../generated/prisma/client'
import { MetadataService } from '../modules/metadata/metadata.service'
import { ModuleFormsService } from '../modules/metadata/module-forms.service'
import { ResourceFieldValueService } from '../modules/metadata/resource-field-value.service'
import { DictionariesService } from '../modules/dictionaries/dictionaries.service'
import { ExportTasksService } from '../modules/import-export/export-tasks.service'
import type { ImportType } from '../modules/import-export/dto/import-export.dto'
import { SpreadsheetService } from '../modules/import-export/spreadsheet.service'
import { BusinessNotificationsService } from '../modules/notifications/business-notifications.service'
import { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import { CustomerPoolRepository } from '../modules/pool-rules/customer-pool.repository'
import { parseStringArray } from '../modules/pool-rules/pool-repository.helpers'
import { USER_VIEW_RESOURCE_TYPES } from '../modules/user-views/user-views.constants'
import { UserViewsService } from '../modules/user-views/user-views.service'
import { PrismaService } from '../prisma/prisma.service'
import { CustomerAccessService } from './customer-access.service'
import type {
  AccountAddDto,
  AccountChartDto,
  AccountModuleFieldValueDto,
  AccountPageDto,
  AccountUpdateDto,
} from './dto/account.dto'
import { CreateCustomerDto } from './dto/create-customer.dto'
import type { SaveCustomerRelationDto } from './dto/customer-relation.dto'
import { CustomerMergeDto } from './dto/customer-merge.dto'
import { CheckDuplicateQueryDto, QueryCustomersDto } from './dto/query-customers.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'

const MODULE = 'customer'

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly notifications: BusinessNotificationsService,
    private readonly pools: ResourcePoolsService,
    private readonly customerPools: CustomerPoolRepository,
    private readonly changeLog: BusinessChangeLogService,
    private readonly userViews: UserViewsService,
    private readonly customerAccess: CustomerAccessService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly dictionaries: DictionariesService,
  ) {}

  getModuleForm(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, MODULE)
  }

  async page(user: AuthUser, dto: AccountPageDto) {
    const result = await this.findAll(user, {
      page: dto.current,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      viewId: dto.viewId,
      view: dto.view,
      filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
    })
    return {
      list: result.items,
      total: result.total,
      pageSize: result.pageSize,
      current: result.page,
      optionMap: {},
    }
  }

  async poolPage(user: AuthUser, poolId: string | undefined, dto: AccountPageDto) {
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const result = await this.findAll(user, {
      page: dto.current,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      viewId: dto.viewId,
      filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      scope: 'sea',
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

  async addAccount(user: AuthUser, dto: AccountAddDto) {
    const result = await this.create(user, {
      name: dto.name,
      ownerId: dto.owner,
      customData: await this.moduleFieldsToCustomData(user, dto.moduleFields),
    })
    if (dto.follower !== undefined || dto.followTime !== undefined) {
      await this.prisma.customer.update({
        where: { id: result.id },
        data: {
          follower: dto.follower,
          followTime: dto.followTime === undefined ? undefined : BigInt(dto.followTime),
        },
      })
    }
    return this.findOne(user, result.id)
  }

  async updateAccount(user: AuthUser, dto: AccountUpdateDto) {
    return this.update(user, dto.id, {
      name: dto.name,
      ownerId: dto.owner,
      customData:
        dto.moduleFields === undefined
          ? undefined
          : await this.moduleFieldsToCustomData(user, dto.moduleFields),
    })
  }

  async optionPage(user: AuthUser, current = 1, pageSize = 20, keyword?: string) {
    const value = keyword?.trim()
    const where: Prisma.CustomerWhereInput = {
      organizationId: user.tenantId,
      ...(value ? { name: { contains: value, mode: 'insensitive' } } : {}),
    }
    const [list, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
        skip: (current - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ])
    return { list, total, current, pageSize }
  }

  async chart(user: AuthUser, dto: AccountChartDto, poolId?: string) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const resolveField = (fieldId?: string) =>
      fieldId ? fields.find((field) => field.id === fieldId || field.key === fieldId) : undefined
    const categoryField = resolveField(dto.chartConfig.categoryAxis.fieldId)
    if (!categoryField) throw new BadRequestException('图表类别字段不存在')
    const subCategoryField = resolveField(dto.chartConfig.subCategoryAxis?.fieldId)
    if (dto.chartConfig.subCategoryAxis && !subCategoryField) {
      throw new BadRequestException('图表子类别字段不存在')
    }
    const method = dto.chartConfig.valueAxis.aggregateMethod ?? 'COUNT'
    const valueField = resolveField(dto.chartConfig.valueAxis.fieldId)
    if (method !== 'COUNT' && !valueField) throw new BadRequestException('图表值字段不存在')

    const items: CustomerVO[] = []
    let page = 1
    while (true) {
      const result = await this.findAll(user, {
        page,
        pageSize: 100,
        viewId: dto.viewId,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
        scope: poolId ? 'sea' : undefined,
        poolId,
      })
      items.push(...result.items)
      if (items.length >= result.total || result.items.length === 0) break
      page++
    }

    type Bucket = {
      category: unknown
      categoryName: string
      subCategory: unknown
      subCategoryName: string
      values: number[]
      count: number
    }
    const buckets = new Map<string, Bucket>()
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
      valueAxis: this.aggregateChartValues(method, bucket.count, bucket.values),
    }))
  }

  private async moduleFieldsToCustomData(
    user: AuthUser,
    moduleFields?: AccountModuleFieldValueDto[],
  ): Promise<Record<string, unknown>> {
    if (!moduleFields?.length) return {}
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const byIdentity = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
    const result: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = byIdentity.get(item.fieldId)
      if (!field) throw new BadRequestException(`动态字段「${item.fieldId}」不存在`)
      if (field.system || !field.key.startsWith('cf_')) {
        throw new BadRequestException(`字段「${field.label}」不是可写动态字段`)
      }
      result[field.key] = item.fieldValue
    }
    return result
  }

  private chartFieldValue(item: CustomerVO, key: string): unknown {
    const systemValues: Record<string, unknown> = {
      name: item.name,
      owner: item.ownerId,
      collectionTime: item.collectedAt,
      followTime: item.lastFollowedAt,
      createTime: item.createdAt,
      updateTime: item.updatedAt,
      poolId: item.poolId,
    }
    return key.startsWith('cf_') ? item.customData[key] : systemValues[key]
  }

  private chartFieldLabel(field: FieldVO, value: unknown) {
    if (value == null || value === '') return '空'
    return field.options?.find((item) => item.value === value)?.label ?? String(value)
  }

  private aggregateChartValues(
    method: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN',
    count: number,
    values: number[],
  ) {
    if (method === 'COUNT') return count
    if (!values.length) return 0
    if (method === 'SUM') return values.reduce((sum, value) => sum + value, 0)
    if (method === 'AVG') return values.reduce((sum, value) => sum + value, 0) / values.length
    if (method === 'MAX') return Math.max(...values)
    return Math.min(...values)
  }

  async findAll(user: AuthUser, query: QueryCustomersDto): Promise<PaginatedResult<CustomerVO>> {
    const { page = 1, pageSize = 10, keyword } = query
    const poolMode = query.scope === 'sea'
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const adHocConditions = parseFilters(query.filters)
    const viewResourceType = poolMode
      ? USER_VIEW_RESOURCE_TYPES.customer_pool
      : USER_VIEW_RESOURCE_TYPES.customer
    const saved = query.viewId
      ? await this.userViews.resolveFilters(user, query.viewId, viewResourceType)
      : null
    const [savedIds, adHocIds, keywordIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterCustomerIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      adHocConditions.length ? this.filterCustomerIds(user.tenantId, adHocConditions, 'AND') : null,
      keyword ? this.keywordCustomerIds(user.tenantId, keyword) : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)

    // 公海按 Pool scope；普通客户页使用 Cordys 系统视图，并始终受当前角色数据权限约束。
    let scopeClause: Prisma.CustomerWhereInput
    if (poolMode) {
      const options = await this.pools.options(user, 'customer')
      const accessiblePoolIds = options.map((pool) => pool.id)
      if (query.poolId && !accessiblePoolIds.includes(query.poolId)) {
        throw new BadRequestException('你无权访问该公海')
      }
      scopeClause = query.poolId
        ? { inSharedPool: true, poolId: query.poolId }
        : { inSharedPool: true, poolId: { in: accessiblePoolIds } }
    } else {
      scopeClause = { inSharedPool: false, ...(await this.resolveListScope(user, query.view)) }
    }

    const where: Prisma.CustomerWhereInput = {
      organizationId: user.tenantId,
      AND: [scopeClause],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(keywordIds
        ? { OR: [{ name: { contains: keyword, mode: 'insensitive' } }, { id: { in: keywordIds } }] }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ])

    const [values, ownerMap] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customer',
        items.map((item) => item.id),
      ),
      this.userNames(items.map((item) => item.owner)),
    ])
    return {
      items: items.map((customer) =>
        this.toVO(
          customer,
          fields,
          values.get(customer.id) ?? {},
          ownerMap.get(customer.owner ?? '') ?? null,
        ),
      ),
      total,
      page,
      pageSize,
    }
  }

  /** Cordys 线索关联客户抽屉：普通数据范围、协作客户与当前用户可访问公海取并集。 */
  async findTransitionCandidates(
    user: AuthUser,
    query: Pick<QueryCustomersDto, 'page' | 'pageSize' | 'keyword' | 'filters'>,
  ) {
    const { page = 1, pageSize = 10, keyword } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const adHocConditions = parseFilters(query.filters)
    const [adHocIds, keywordIds, collaborations, poolOptions, directScope] = await Promise.all([
      adHocConditions.length ? this.filterCustomerIds(user.tenantId, adHocConditions, 'AND') : null,
      keyword ? this.keywordCustomerIds(user.tenantId, keyword) : null,
      this.prisma.customerCollaboration.findMany({
        where: { userId: user.id, customer: { organizationId: user.tenantId } },
        select: { customerId: true, collaborationType: true },
      }),
      this.pools.options(user, 'customer'),
      this.dataScope.directOwnerFilter(user, 'customer:read'),
    ])
    const accessiblePoolIds = poolOptions.map((pool) => pool.id)
    const collaborationIds = collaborations.map((item) => item.customerId)
    const where: Prisma.CustomerWhereInput = {
      organizationId: user.tenantId,
      AND: [
        {
          OR: [
            { inSharedPool: false, ...directScope },
            { inSharedPool: false, id: { in: collaborationIds } },
            { inSharedPool: true, poolId: { in: accessiblePoolIds } },
          ],
        },
      ],
      ...(adHocIds ? { id: { in: adHocIds } } : {}),
      ...(keywordIds || keyword
        ? {
            OR: [
              ...(keyword ? [{ name: { contains: keyword, mode: 'insensitive' as const } }] : []),
              ...(keywordIds ? [{ id: { in: keywordIds } }] : []),
            ],
          }
        : {}),
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        orderBy: { createTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ])
    const [values, ownerMap, directlyAccessible] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customer',
        items.map((item) => item.id),
      ),
      this.userNames(items.map((item) => item.owner)),
      items.length
        ? this.prisma.customer.findMany({
            where: {
              id: { in: items.map((item) => item.id) },
              organizationId: user.tenantId,
              OR: [
                { inSharedPool: false, ...directScope },
                { inSharedPool: true, poolId: { in: accessiblePoolIds } },
              ],
            },
            select: { id: true },
          })
        : [],
    ])
    const directlyAccessibleIds = new Set(directlyAccessible.map((item) => item.id))
    const collaborationMap = new Map(
      collaborations.map((item) => [item.customerId, item.collaborationType]),
    )
    return {
      items: items.map((customer) => ({
        ...this.toVO(
          customer,
          fields,
          values.get(customer.id) ?? {},
          ownerMap.get(customer.owner ?? '') ?? null,
        ),
        collaborationType: directlyAccessibleIds.has(customer.id)
          ? null
          : (collaborationMap.get(customer.id) ?? null),
      })),
      total,
      page,
      pageSize,
    }
  }

  /** Cordys /account/tab：决定“全部客户 / 部门客户”系统视图是否显示。 */
  tab(user: AuthUser) {
    const roles = user.roles.filter((role) => hasPermission(role.permissions, 'customer:read'))
    return {
      all: roles.some((role) => role.dataScope === 'ALL' || role.dataScope === 'CUSTOM'),
      dept: roles.some((role) => ['ALL', 'DEPT_AND_CHILD', 'CUSTOM'].includes(role.dataScope)),
    }
  }

  async findOne(user: AuthUser, id: string): Promise<CustomerVO> {
    const access = await this.customerAccess.assertRead(user, id)
    const [customer, fields, values] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id, organizationId: user.tenantId },
      }),
      this.metadata.listFields(user.tenantId, MODULE),
      this.fieldValues.load(user.tenantId, 'customer', [id]),
    ])
    if (!customer) throw new NotFoundException('客户不存在或不在你的数据范围内')
    const ownerMap = await this.userNames([customer.owner])
    return {
      ...this.toVO(
        customer,
        fields,
        values.get(id) ?? {},
        ownerMap.get(customer.owner ?? '') ?? null,
      ),
      collaborationType: !access.dataScope && !access.pool ? access.collaborationType : null,
      canManageCustomer: access.canManageCustomer,
      canCollaborateWrite: access.canCollaborateWrite,
    }
  }

  async findPoolOne(user: AuthUser, id: string): Promise<CustomerVO> {
    const access = await this.customerAccess.assertPoolRead(user, id)
    const result = await this.toSingleVO(user, access.customer)
    return {
      ...result,
      collaborationType: null,
      canManageCustomer: false,
      canCollaborateWrite: false,
    }
  }

  /** Cordys /customer/option 语义：仅返回租户内客户 id/name，不下推 owner 数据范围。 */
  async customerOptions(user: AuthUser, keyword?: string) {
    const value = keyword?.trim()
    return this.prisma.customer.findMany({
      where: {
        organizationId: user.tenantId,
        ...(value ? { name: { contains: value, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 50,
    })
  }

  /** 名称模糊 + 电话精确，命中客户/联系人/线索/商机；非数据范围仅露负责人 */
  async checkDuplicate(user: AuthUser, query: CheckDuplicateQueryDto): Promise<DuplicateHitVO[]> {
    const name = query.name?.trim()
    const phone = query.phone?.trim()
    if (!name && !phone) throw new BadRequestException('请输入客户名称或电话')

    const customerPhoneIds = phone
      ? await this.fieldValues.filterResourceIds(user.tenantId, 'customer', [
          { key: 'cf_phone', op: 'eq', value: phone },
        ])
      : []
    const [customers, contacts, leads, opportunities] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          organizationId: user.tenantId,
          OR: [
            ...(name ? [{ name: { contains: name, mode: 'insensitive' as const } }] : []),
            ...(customerPhoneIds.length ? [{ id: { in: customerPhoneIds } }] : []),
          ],
        },
        take: 10,
      }),
      this.prisma.customerContact.findMany({
        where: {
          organizationId: user.tenantId,
          OR: [
            ...(name ? [{ name: { contains: name, mode: 'insensitive' as const } }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
        include: {
          customer: { select: { id: true, name: true, owner: true, inSharedPool: true } },
        },
        take: 10,
      }),
      this.prisma.clue.findMany({
        where: {
          organizationId: user.tenantId,
          stage: { not: 'FAIL' },
          OR: [
            ...(name ? [{ name: { contains: name, mode: 'insensitive' as const } }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
        take: 10,
      }),
      name
        ? this.prisma.opportunity.findMany({
            where: {
              organizationId: user.tenantId,
              name: { contains: name, mode: 'insensitive' },
            },
            include: { customer: { select: { name: true } } },
            take: 10,
          })
        : Promise.resolve([]),
    ])

    const customerIds = [
      ...customers.map((customer) => customer.id),
      ...contacts.flatMap((contact) => (contact.customerId ? [contact.customerId] : [])),
    ]
    const [inScopeCustomers, inScopeLeads, inScopeOpps, ownerMap, customerValues] =
      await Promise.all([
        this.inScopeCustomerIds(user, customerIds),
        this.inScopeLeadIds(
          user,
          leads.map((l) => l.id),
        ),
        this.inScopeOpportunityIds(
          user,
          opportunities.map((o) => o.id),
        ),
        this.userNames([
          ...customers.map((customer) => customer.owner),
          ...contacts.map((contact) => contact.customer?.owner),
          ...leads.map((lead) => lead.owner),
          ...opportunities.map((o) => o.owner),
        ]),
        this.fieldValues.load(
          user.tenantId,
          'customer',
          customers.map((customer) => customer.id),
        ),
      ])

    const hits: DuplicateHitVO[] = []
    for (const row of customers) {
      const inScope = inScopeCustomers.has(row.id)
      hits.push({
        id: row.id,
        source: 'customer',
        name: inScope ? row.name : null,
        phone: inScope ? String(customerValues.get(row.id)?.cf_phone ?? '') || null : null,
        ownerName: row.owner ? (ownerMap.get(row.owner) ?? null) : null,
        inSea: row.inSharedPool,
        inScope,
      })
    }
    for (const row of contacts) {
      if (!row.customerId || !row.customer) continue
      const inScope = inScopeCustomers.has(row.customerId)
      hits.push({
        id: row.id,
        source: 'contact',
        name: inScope ? `${row.name}（${row.customer.name}）` : null,
        phone: inScope ? row.phone : null,
        ownerName: ownerMap.get(row.customer.owner ?? '') ?? null,
        inSea: row.customer.inSharedPool,
        inScope,
      })
    }
    for (const row of leads) {
      const inScope = inScopeLeads.has(row.id)
      hits.push({
        id: row.id,
        source: 'lead',
        name: inScope ? row.name : null,
        phone: inScope ? row.phone : null,
        ownerName: row.owner ? (ownerMap.get(row.owner) ?? null) : null,
        inSea: row.inSharedPool,
        inScope,
      })
    }
    for (const row of opportunities) {
      const inScope = inScopeOpps.has(row.id)
      hits.push({
        id: row.id,
        source: 'opportunity',
        name: inScope ? `${row.name}${row.customer ? `（${row.customer.name}）` : ''}` : null,
        phone: null,
        ownerName: ownerMap.get(row.owner) ?? null,
        inSea: false,
        inScope,
      })
    }
    return hits.slice(0, 20)
  }

  async related(user: AuthUser, id: string): Promise<CustomerRelatedVO> {
    const access = await this.customerAccess.assertRead(user, id)
    const contactWhere: Prisma.CustomerContactWhereInput = {
      organizationId: user.tenantId,
      customerId: id,
      ...(!access.dataScope && !access.pool && access.collaborationType === 'COLLABORATION'
        ? { owner: user.id }
        : {}),
    }
    const isOpenSea = access.customer.inSharedPool
    const canReadContacts =
      !isOpenSea &&
      hasPermission(user.permissions, 'contact:read') &&
      (access.dataScope || access.pool || access.collaborationType === 'COLLABORATION')
    const canReadOpportunities = !isOpenSea && hasPermission(user.permissions, 'menu:opportunity')
    const canReadContracts = !isOpenSea && hasPermission(user.permissions, 'menu:contract')
    const canReadTeam = !isOpenSea && access.collaborationType === null
    const [opportunityScope, contractScope] = await Promise.all([
      canReadOpportunities
        ? this.dataScope.directOwnerFilter(user, 'menu:opportunity')
        : Promise.resolve(null),
      canReadContracts ? this.dataScope.scopeFilter(user, 'menu:contract') : Promise.resolve(null),
    ])
    const [contacts, opportunities, contracts, followUps, team] = await Promise.all([
      canReadContacts
        ? this.prisma.customerContact.findMany({
            where: contactWhere,
            orderBy: { createTime: 'asc' },
          })
        : Promise.resolve([]),
      canReadOpportunities
        ? this.prisma.opportunity.findMany({
            where: {
              organizationId: user.tenantId,
              customerId: id,
              AND: [opportunityScope as Prisma.OpportunityWhereInput],
            },
            include: { stageConfig: true },
            orderBy: { createTime: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
      canReadContracts
        ? this.prisma.contract.findMany({
            where: {
              tenantId: user.tenantId,
              customerId: id,
              AND: [contractScope as Prisma.ContractWhereInput],
            },
            include: {
              receivableRecords: { select: { amount: true, approvalStatus: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
      this.prisma.followUpRecord.findMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      canReadTeam
        ? this.prisma.customerCollaboration.findMany({
            where: { customerId: id },
            orderBy: { createTime: 'asc' },
          })
        : Promise.resolve([]),
    ])

    const [ownerMap, attachMap] = await Promise.all([
      this.userNames([...opportunities.map((o) => o.owner), ...team.map((m) => m.userId)]),
      this.attachmentMap(
        user.tenantId,
        'follow-up',
        followUps.map((f) => f.id),
      ),
    ])

    const contractRows = contracts.map((c) => {
      const paidAmount =
        Math.round(
          c.receivableRecords
            .filter((r) => r.approvalStatus === 'NONE' || r.approvalStatus === 'APPROVED')
            .reduce((sum, r) => sum + Number(r.amount), 0) * 100,
        ) / 100
      return {
        id: c.id,
        name: c.name,
        amount: Number(c.amount),
        paidAmount,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      }
    })

    return {
      stats: {
        opportunityCount: opportunities.length,
        opportunityAmount:
          Math.round(opportunities.reduce((sum, o) => sum + Number(o.amount ?? 0), 0) * 100) / 100,
        contractCount: contracts.length,
        contractAmount: Math.round(contractRows.reduce((sum, c) => sum + c.amount, 0) * 100) / 100,
        paidAmount: Math.round(contractRows.reduce((sum, c) => sum + c.paidAmount, 0) * 100) / 100,
      },
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
      })),
      opportunities: opportunities.map((o) => ({
        id: o.id,
        name: o.name,
        amount: o.amount ? Number(o.amount) : null,
        stageName: o.stageConfig.name,
        ownerName: ownerMap.get(o.owner) ?? null,
        createdAt: new Date(Number(o.createTime)).toISOString(),
      })),
      contracts: contractRows,
      followUps: followUps.map((r) => ({
        id: r.id,
        targetType: r.targetType as 'customer',
        targetId: r.targetId,
        type: r.type,
        content: r.content,
        nextFollowAt: r.nextFollowAt?.toISOString() ?? null,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        createdAt: r.createdAt.toISOString(),
        attachments: attachMap.get(r.id) ?? [],
      })),
      team: team.map((m) => ({
        id: m.id,
        userId: m.userId,
        userName: ownerMap.get(m.userId) ?? '未知',
        role: null,
        collaborationType: m.collaborationType as 'READ_ONLY' | 'COLLABORATION',
        createdAt: new Date(Number(m.createTime)).toISOString(),
      })),
    }
  }

  async relatedResource(
    user: AuthUser,
    id: string,
    resource: Customer360Resource,
    page = 1,
    pageSize = 10,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const access = await this.customerAccess.assertRead(user, id)
    if (access.customer.inSharedPool) {
      throw new ForbiddenException('客户公海详情不提供该 360 业务资源')
    }
    this.assert360ResourcePermission(user, resource)
    const resourceScope = await this.customer360ResourceScope(user, resource)

    const take = Math.min(Math.max(pageSize, 1), 100)
    const currentPage = Math.max(page, 1)
    const skip = (currentPage - 1) * take

    if (resource === 'opportunities') {
      const where: Prisma.OpportunityWhereInput = {
        organizationId: user.tenantId,
        customerId: id,
        AND: [resourceScope as Prisma.OpportunityWhereInput],
      }
      const [rows, total] = await Promise.all([
        this.prisma.opportunity.findMany({
          where,
          include: { stageConfig: true },
          orderBy: { createTime: 'desc' },
          skip,
          take,
        }),
        this.prisma.opportunity.count({ where }),
      ])
      const ownerMap = await this.userNames(rows.map((row) => row.owner))
      return {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          amount: row.amount === null ? null : Number(row.amount),
          stageName: row.stageConfig.name,
          ownerName: ownerMap.get(row.owner) ?? null,
          createdAt: new Date(Number(row.createTime)).toISOString(),
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'contracts') {
      const where: Prisma.ContractWhereInput = {
        tenantId: user.tenantId,
        customerId: id,
        AND: [resourceScope as Prisma.ContractWhereInput],
      }
      const [rows, total] = await Promise.all([
        this.prisma.contract.findMany({
          where,
          include: {
            receivableRecords: { select: { amount: true, approvalStatus: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.contract.count({ where }),
      ])
      const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
      return {
        items: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          amount: Number(row.amount),
          paidAmount:
            Math.round(
              row.receivableRecords
                .filter(
                  (record) =>
                    record.approvalStatus === 'NONE' || record.approvalStatus === 'APPROVED',
                )
                .reduce((sum, record) => sum + Number(record.amount), 0) * 100,
            ) / 100,
          status: row.status,
          approvalStatus: row.approvalStatus,
          ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'receivablePlans') {
      const where: Prisma.ReceivablePlanWhereInput = {
        tenantId: user.tenantId,
        contract: {
          customerId: id,
          AND: [resourceScope as Prisma.ContractWhereInput],
        },
      }
      const [rows, total] = await Promise.all([
        this.prisma.receivablePlan.findMany({
          where,
          include: {
            contract: { select: { name: true } },
            records: { select: { amount: true, approvalStatus: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { period: 'asc' }],
          skip,
          take,
        }),
        this.prisma.receivablePlan.count({ where }),
      ])
      return {
        items: rows.map((row) => {
          const paidAmount =
            Math.round(
              row.records
                .filter(
                  (record) =>
                    record.approvalStatus === 'NONE' || record.approvalStatus === 'APPROVED',
                )
                .reduce((sum, record) => sum + Number(record.amount), 0) * 100,
            ) / 100
          const amount = Number(row.amount)
          return {
            id: row.id,
            contractId: row.contractId,
            contractName: row.contract.name,
            period: row.period,
            amount,
            paidAmount,
            status: this.receivablePlanStatus(amount, paidAmount, row.dueDate),
            dueDate: row.dueDate.toISOString().slice(0, 10),
            remark: row.remark,
          }
        }),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'receivableRecords') {
      const where: Prisma.ReceivableRecordWhereInput = {
        tenantId: user.tenantId,
        contract: {
          customerId: id,
          AND: [resourceScope as Prisma.ContractWhereInput],
        },
      }
      const [rows, total] = await Promise.all([
        this.prisma.receivableRecord.findMany({
          where,
          include: {
            contract: { select: { name: true } },
            plan: { select: { period: true } },
          },
          orderBy: { receivedAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.receivableRecord.count({ where }),
      ])
      const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
      return {
        items: rows.map((row) => ({
          id: row.id,
          contractId: row.contractId,
          contractName: row.contract.name,
          planId: row.planId,
          planPeriod: row.plan?.period ?? null,
          amount: Number(row.amount),
          receivedAt: row.receivedAt.toISOString().slice(0, 10),
          method: row.method,
          remark: row.remark,
          approvalStatus: row.approvalStatus,
          ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'invoices') {
      const where: Prisma.InvoiceRecordWhereInput = {
        tenantId: user.tenantId,
        contract: {
          customerId: id,
          AND: [resourceScope as Prisma.ContractWhereInput],
        },
      }
      const [rows, total] = await Promise.all([
        this.prisma.invoiceRecord.findMany({
          where,
          include: {
            contract: { select: { name: true } },
            title: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.invoiceRecord.count({ where }),
      ])
      return {
        items: rows.map((row) => ({
          id: row.id,
          contractId: row.contractId,
          contractName: row.contract.name,
          titleName: row.title?.name ?? null,
          amount: Number(row.amount),
          type: row.type,
          status: row.status,
          invoiceNo: row.invoiceNo,
          issuedAt: row.issuedAt?.toISOString().slice(0, 10) ?? null,
          remark: row.remark,
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    const where: Prisma.OrderWhereInput = {
      tenantId: user.tenantId,
      contract: { customerId: id },
      AND: [resourceScope as Prisma.OrderWhereInput],
    }
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { contract: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
    ])
    const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        contractId: row.contractId,
        contractName: row.contract.name,
        amount: Number(row.amount),
        status: row.status,
        approvalStatus: row.approvalStatus,
        ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: currentPage,
      pageSize: take,
    }
  }

  async resourceStatistic(
    user: AuthUser,
    customerId: string,
    resource: 'contracts' | 'receivablePlans' | 'receivableRecords' | 'invoices',
  ) {
    await this.customerAccess.assertRead(user, customerId)
    this.assert360ResourcePermission(user, resource)
    const contractScope = await this.customer360ResourceScope(user, resource)
    const contractWhere: Prisma.ContractWhereInput = {
      tenantId: user.tenantId,
      customerId,
      AND: [contractScope as Prisma.ContractWhereInput],
    }
    const contractAggregate = await this.prisma.contract.aggregate({
      where: contractWhere,
      _sum: { amount: true },
    })
    const contractAmount = Number(contractAggregate._sum.amount ?? 0)
    if (resource === 'contracts') return { totalAmount: contractAmount }

    if (resource === 'receivablePlans') {
      const result = await this.prisma.receivablePlan.aggregate({
        where: {
          tenantId: user.tenantId,
          contract: {
            customerId,
            AND: [contractScope as Prisma.ContractWhereInput],
          },
        },
        _sum: { amount: true },
      })
      return { totalPlanAmount: Number(result._sum.amount ?? 0) }
    }

    if (resource === 'receivableRecords') {
      const result = await this.prisma.receivableRecord.aggregate({
        where: {
          tenantId: user.tenantId,
          contract: {
            customerId,
            AND: [contractScope as Prisma.ContractWhereInput],
          },
          approvalStatus: { in: ['NONE', 'APPROVED'] },
        },
        _sum: { amount: true },
      })
      const receivedAmount = Number(result._sum.amount ?? 0)
      return {
        totalAmount: contractAmount,
        receivedAmount,
        pendingAmount: Math.max(0, contractAmount - receivedAmount),
      }
    }

    const result = await this.prisma.invoiceRecord.aggregate({
      where: {
        tenantId: user.tenantId,
        contract: {
          customerId,
          AND: [contractScope as Prisma.ContractWhereInput],
        },
        status: { not: 'VOID' },
      },
      _sum: { amount: true },
    })
    const invoicedAmount = Number(result._sum.amount ?? 0)
    return {
      contractAmount,
      invoicedAmount,
      uninvoicedAmount: Math.max(0, contractAmount - invoicedAmount),
    }
  }

  async create(user: AuthUser, dto: CreateCustomerDto): Promise<CustomerVO> {
    const prepared = await this.prepareCreateForTransaction(user, dto)
    const customer = await this.prisma.$transaction((tx) =>
      this.createPreparedInTransaction(user, dto, prepared, tx),
    )
    await this.notifyCreatedCustomer(user, customer, prepared.owner.id)
    return this.toSingleVO(user, customer)
  }

  async prepareCreateForTransaction(user: AuthUser, dto: CreateCustomerDto) {
    const values = this.customerFieldInput(dto)
    await this.fieldValues.validate(user.tenantId, 'customer', values, { mode: 'create' })
    await this.assertCustomerUniqueRules(user.tenantId, dto)
    const owner = await this.resolveOwner(user, dto.ownerId)
    await this.pools.assertCapacityForOwner(user.tenantId, 'customer', owner.id)
    return { values, owner }
  }

  async createPreparedInTransaction(
    user: AuthUser,
    dto: CreateCustomerDto,
    prepared: Awaited<ReturnType<CustomersService['prepareCreateForTransaction']>>,
    tx: Prisma.TransactionClient,
  ) {
    const now = BigInt(Date.now())
    const created = await tx.customer.create({
      data: {
        name: dto.name.trim(),
        owner: prepared.owner.id,
        collectionTime: now,
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      },
    })
    await this.fieldValues.save(
      user.tenantId,
      'customer',
      created.id,
      prepared.values,
      'create',
      tx,
    )
    return created
  }

  async notifyCreatedCustomer(user: AuthUser, customer: Customer, ownerId: string) {
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_ADD',
      operatorId: user.id,
      recipientIds: [ownerId],
      excludeSelf: true,
      type: 'system',
      title: '新建客户',
      content: `${user.name} 新建了客户「${customer.name}」并将你设为负责人`,
      link: `/customers/${customer.id}`,
    })
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerDto): Promise<CustomerVO> {
    const existing = await this.ensureInScope(user, id, 'customer:update')
    return this.updateExisting(user, existing, dto)
  }

  private async updateExisting(
    user: AuthUser,
    existing: Customer,
    dto: UpdateCustomerDto,
  ): Promise<CustomerVO> {
    const values = this.customerFieldInput(dto)
    await this.fieldValues.validate(user.tenantId, 'customer', values, {
      mode: 'update',
      resourceId: existing.id,
    })
    await this.assertCustomerUniqueRules(user.tenantId, dto, existing.id)

    const owner =
      dto.ownerId && dto.ownerId !== existing.owner
        ? await this.resolveOwner(user, dto.ownerId)
        : null

    const now = BigInt(Date.now())
    const customer = await this.prisma.$transaction(async (tx) => {
      if (owner) {
        await this.customerPools.transferInTransaction(tx, {
          organizationId: user.tenantId,
          customerId: existing.id,
          ownerId: owner.id,
          operatorId: user.id,
          now,
        })
      }
      const updated = await tx.customer.update({
        where: { id: existing.id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          updateTime: now,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(user.tenantId, 'customer', existing.id, values, 'update', tx)
      return updated
    })
    if (owner) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CUSTOMER_TRANSFERRED_CUSTOMER',
        operatorId: user.id,
        recipientIds: [owner.id],
        excludeSelf: true,
        type: 'assign',
        title: '客户已转移给你',
        content: `${user.name} 将客户「${customer.name}」转移给你`,
        link: `/customers/${customer.id}`,
      })
    }
    await this.changeLog.record(user, {
      module: 'customer',
      action: 'update',
      targetId: customer.id,
      targetName: customer.name,
      before: existing,
      after: customer,
    })
    return this.toSingleVO(user, customer)
  }

  async remove(user: AuthUser, id: string): Promise<{ id: string; name: string }> {
    const customer = await this.ensureInScope(user, id, 'customer:delete')
    await this.assertCustomersDeletable(user.tenantId, [id])
    await this.deleteCustomerResources(user, [customer])
    return { id, name: customer.name }
  }

  /** 退回公海 */
  async moveToSea(user: AuthUser, id: string, poolId?: string, reasonId?: string) {
    const customer = await this.ensureInScope(user, id, 'customer:recycle')
    await this.dictionaries.validateReason(user.tenantId, 'CUSTOMER_POOL_RS', reasonId)
    const pool = await this.pools.resolveMoveTargetPool(
      user.tenantId,
      'customer',
      customer.owner,
      poolId,
    )
    await this.customerPools.moveToPool({
      organizationId: user.tenantId,
      customerId: id,
      poolId: pool.id,
      operatorId: user.id,
      reasonId,
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_MOVED_HIGH_SEAS',
      operatorId: user.id,
      recipientIds: [customer.owner],
      excludeSelf: true,
      type: 'pool',
      title: '客户已移入公海',
      content: `${user.name} 将客户「${customer.name}」移入公海`,
      link: '/customers',
    })
    return { id, name: customer.name, poolId: pool.id }
  }

  /** 从公海领取 */
  async claimFromSea(user: AuthUser, id: string, poolId?: string) {
    const current = (await this.customerAccess.assertPoolRead(user, id)).customer
    if (poolId && current.poolId !== poolId) {
      throw new BadRequestException('客户不属于指定公海')
    }
    await this.customerPools.pick({
      organizationId: user.tenantId,
      customerId: id,
      ownerId: user.id,
      operatorId: user.id,
      poolAdmin: await this.pools.isPoolManager(user, 'customer', current.poolId),
    })
    const customer = await this.prisma.customer.findUnique({ where: { id } })
    return { id, name: customer?.name ?? '' }
  }

  async batchClaimFromSea(
    user: AuthUser,
    ids: string[],
    poolId?: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        if (poolId) {
          const customer = await this.prisma.customer.findFirst({
            where: { id, organizationId: user.tenantId, inSharedPool: true },
            select: { poolId: true },
          })
          if (!customer || customer.poolId !== poolId)
            throw new BadRequestException('客户不属于指定公海')
        }
        await this.claimFromSea(user, id)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** 分配负责人 */
  async assignOwner(user: AuthUser, id: string, ownerId: string) {
    const customer = await this.ensureInScope(user, id, 'customer:transfer')
    return this.assignOwnerExisting(user, customer, ownerId)
  }

  async poolAssignOwner(user: AuthUser, id: string, ownerId: string, poolId?: string) {
    const access = await this.customerAccess.assertPoolRead(user, id)
    if (poolId && access.customer.poolId !== poolId) {
      throw new BadRequestException('客户不属于指定公海')
    }
    return this.assignOwnerExisting(user, access.customer, ownerId)
  }

  async batchTransfer(user: AuthUser, ids: string[], ownerId: string) {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new BadRequestException('请选择客户')
    const [owner, customers] = await Promise.all([
      this.resolveOwner(user, ownerId),
      Promise.all(uniqueIds.map((id) => this.ensureInScope(user, id, 'customer:transfer'))),
    ])
    const changed = customers.filter((customer) => customer.owner !== owner.id)
    if (changed.length) {
      await this.pools.assertCapacityForOwner(
        user.tenantId,
        'customer',
        owner.id,
        changed.length,
      )
    }
    for (const customer of changed) {
      await this.assignOwnerExisting(user, customer, owner.id, true)
    }
    return { count: changed.length }
  }

  /** 已由调用方完成资源访问校验后的统一负责人变更。 */
  private async assignOwnerExisting(
    user: AuthUser,
    customer: Customer,
    ownerId: string,
    _capacityChecked = false,
  ) {
    const owner = await this.resolveOwner(user, ownerId)
    if (customer.inSharedPool) {
      await this.customerPools.assign({
        organizationId: user.tenantId,
        customerId: customer.id,
        ownerId: owner.id,
        operatorId: user.id,
        poolAdmin: await this.pools.isPoolManager(user, 'customer', customer.poolId),
      })
    } else if (customer.owner !== owner.id) {
      await this.customerPools.transfer({
        organizationId: user.tenantId,
        customerId: customer.id,
        ownerId: owner.id,
        operatorId: user.id,
      })
    }
    await this.notifications.send({
      tenantId: user.tenantId,
      event: customer.inSharedPool
        ? 'HIGH_SEAS_CUSTOMER_DISTRIBUTED'
        : 'CUSTOMER_TRANSFERRED_CUSTOMER',
      operatorId: user.id,
      recipientIds: [owner.id],
      excludeSelf: true,
      type: 'assign',
      title: customer.inSharedPool ? '公海客户已分配给你' : '客户已转移给你',
      content: `${user.name} 将客户「${customer.name}」分配给你`,
      link: `/customers/${customer.id}`,
    })
    return { id: customer.id, name: customer.name }
  }

  async batchAssignOwner(
    user: AuthUser,
    ids: string[],
    ownerId: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.assignOwner(user, id, ownerId)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  async poolBatchAssignOwner(user: AuthUser, ids: string[], ownerId: string) {
    const poolId = await this.resolvePoolSelection(user, ids)
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: user.tenantId,
        id: { in: [...new Set(ids)] },
        inSharedPool: true,
        poolId,
      },
    })
    for (const customer of customers) {
      await this.assignOwnerExisting(user, customer, ownerId)
    }
    return { success: customers.length, fail: 0, failedIds: [] }
  }

  async poolOptions(user: AuthUser) {
    const pools = await this.pools.options(user, 'customer')
    return pools.map((pool) => ({
      id: pool.id,
      name: pool.name,
      scopeIds: parseStringArray(pool.scopeId),
      ownerIds: parseStringArray(pool.ownerId),
      enable: pool.enable,
      auto: pool.auto,
      hiddenFieldIds: pool.hiddenFields.map((field) => field.fieldId),
    }))
  }

  async batchMoveToSea(
    user: AuthUser,
    ids: string[],
    poolId?: string,
    reasonId?: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.moveToSea(user, id, poolId, reasonId)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** Cordys ResourceBatchEditRequest：先完成整批资源权限校验，再修改一个字段。 */
  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    const customers = await Promise.all(
      dto.ids.map((id) => this.ensureInScope(user, id, 'customer:update')),
    )

    if (field.key === 'owner' || field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      const processCount = customers.filter((customer) => customer.owner !== dto.fieldValue).length
      if (processCount > 0) {
        await this.pools.assertCapacityForOwner(
          user.tenantId,
          'customer',
          dto.fieldValue,
          processCount,
        )
      }
      for (const customer of customers) {
        if (customer.owner !== dto.fieldValue) {
          await this.assignOwnerExisting(user, customer, dto.fieldValue, true)
        }
      }
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    if (field.key.startsWith('cf_')) {
      await this.prisma.$transaction((tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'customer',
          customers.map((customer) => customer.id),
          field.key,
          dto.fieldValue,
          tx,
        ),
      )
    } else {
      const updateDto = { [field.key]: dto.fieldValue } as UpdateCustomerDto
      for (const customer of customers) await this.update(user, customer.id, updateDto)
    }
    return { success: dto.ids.length, fail: 0, failedIds: [] }
  }

  async batchDelete(user: AuthUser, ids: string[]): Promise<BatchAffectResult> {
    const customers = await Promise.all(
      ids.map((id) => this.ensureInScope(user, id, 'customer:delete')),
    )
    await this.assertCustomersDeletable(user.tenantId, ids)
    await this.deleteCustomerResources(user, customers)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async poolBatchUpdate(user: AuthUser, dto: PoolResourceBatchEditDto): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'customer', dto.poolId)
    const customers = await this.prisma.customer.findMany({
      where: {
        organizationId: user.tenantId,
        id: { in: dto.ids },
        inSharedPool: true,
        poolId: dto.poolId,
      },
    })
    if (customers.length !== dto.ids.length) {
      throw new BadRequestException('所选客户必须全部属于同一个指定公海')
    }

    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    if (field.key === 'owner' || field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      await this.pools.assertCapacityForOwner(
        user.tenantId,
        'customer',
        dto.fieldValue,
        customers.length,
      )
      for (const customer of customers) {
        await this.assignOwnerExisting(user, customer, dto.fieldValue, true)
      }
      return { success: customers.length, fail: 0, failedIds: [] }
    }

    if (field.key.startsWith('cf_')) {
      await this.prisma.$transaction((tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'customer',
          customers.map((customer) => customer.id),
          field.key,
          dto.fieldValue,
          tx,
        ),
      )
    } else {
      const updateDto = { [field.key]: dto.fieldValue } as UpdateCustomerDto
      for (const customer of customers) await this.updateExisting(user, customer, updateDto)
    }
    return { success: customers.length, fail: 0, failedIds: [] }
  }

  async poolBatchUpdateExact(user: AuthUser, dto: ResourceBatchEditDto) {
    const firstId = dto.ids[0]
    if (!firstId) throw new BadRequestException('请选择客户')
    const customer = (await this.customerAccess.assertPoolRead(user, firstId)).customer
    if (!customer.poolId) throw new BadRequestException('客户不属于公海')
    return this.poolBatchUpdate(user, { ...dto, poolId: customer.poolId })
  }

  async poolBatchDelete(user: AuthUser, poolId: string, ids: string[]): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'customer', poolId)
    const customers = await this.prisma.customer.findMany({
      where: { organizationId: user.tenantId, id: { in: ids }, inSharedPool: true, poolId },
    })
    if (customers.length !== ids.length) {
      throw new BadRequestException('所选客户必须全部属于同一个指定公海')
    }
    await this.assertCustomersDeletable(user.tenantId, ids)
    await this.deleteCustomerResources(user, customers)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async resolvePoolSelection(user: AuthUser, ids: string[]): Promise<string> {
    const uniqueIds = [...new Set(ids)]
    const firstId = uniqueIds[0]
    if (!firstId) throw new BadRequestException('请选择客户')
    const first = (await this.customerAccess.assertPoolRead(user, firstId)).customer
    if (!first.poolId) throw new BadRequestException('客户不属于公海')
    const count = await this.prisma.customer.count({
      where: {
        organizationId: user.tenantId,
        id: { in: uniqueIds },
        inSharedPool: true,
        poolId: first.poolId,
      },
    })
    if (count !== uniqueIds.length) {
      throw new BadRequestException('所选客户必须全部属于同一个公海')
    }
    return first.poolId
  }

  async poolBatchDeleteExact(user: AuthUser, ids: string[]): Promise<BatchAffectResult> {
    const uniqueIds = [...new Set(ids)]
    const poolId = await this.resolvePoolSelection(user, uniqueIds)
    return this.poolBatchDelete(user, poolId, uniqueIds)
  }

  // ===== 团队成员 =====

  async teamList(user: AuthUser, customerId: string) {
    // Cordys 协作人页签不会暴露给协作访问；这里要求普通 Customer READ 数据范围，
    // 不把 COLLABORATION/READ_ONLY 当成“可管理协作关系”的替代权限。
    await this.ensureInScope(user, customerId, 'customer:read')
    const members = await this.prisma.customerCollaboration.findMany({
      where: { customerId },
      orderBy: { createTime: 'asc' },
    })
    const userMap = await this.userNames(members.map((m) => m.userId))
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: userMap.get(m.userId) ?? '未知',
      role: null,
      collaborationType: m.collaborationType as 'READ_ONLY' | 'COLLABORATION',
      createdAt: new Date(Number(m.createTime)).toISOString(),
    }))
  }

  async teamAdd(
    user: AuthUser,
    customerId: string,
    userId: string,
    role?: string,
    collaborationType: 'READ_ONLY' | 'COLLABORATION' = 'COLLABORATION',
  ) {
    const customer = (await this.customerAccess.assertManageCustomer(user, customerId)).customer
    const member = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true },
    })
    if (!member) throw new BadRequestException('协作成员不存在或已禁用')
    const exists = await this.prisma.customerCollaboration.findFirst({
      where: { customerId, userId },
    })
    if (exists) throw new BadRequestException('该成员已在团队中')
    const now = BigInt(Date.now())
    await this.prisma.customerCollaboration.create({
      data: {
        customerId,
        userId,
        collaborationType,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      },
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_COLLABORATION_ADD',
      operatorId: user.id,
      recipientIds: [customer.owner],
      excludeSelf: true,
      type: 'system',
      title: '客户新增协作人',
      content: `${user.name} 为客户「${customer.name}」添加协作成员「${member.name}」`,
      link: `/customers/${customerId}`,
    })
    return { id: customerId, name: customer.name }
  }

  async teamUpdate(
    user: AuthUser,
    customerId: string,
    memberId: string,
    collaborationType: 'READ_ONLY' | 'COLLABORATION',
  ) {
    await this.customerAccess.assertManageCustomer(user, customerId)
    const result = await this.prisma.customerCollaboration.updateMany({
      where: { id: memberId, customerId },
      data: { collaborationType, updateUser: user.id, updateTime: BigInt(Date.now()) },
    })
    if (result.count === 0) throw new NotFoundException('协作成员不存在')
    return { id: memberId, collaborationType }
  }

  async teamRemove(user: AuthUser, customerId: string, memberId: string) {
    await this.customerAccess.assertManageCustomer(user, customerId)
    await this.prisma.customerCollaboration.deleteMany({
      where: { id: memberId, customerId },
    })
    return { id: memberId }
  }

  async collaborationUpdate(
    user: AuthUser,
    memberId: string,
    collaborationType: 'READ_ONLY' | 'COLLABORATION',
  ) {
    const member = await this.prisma.customerCollaboration.findFirst({
      where: { id: memberId, customer: { organizationId: user.tenantId } },
      select: { customerId: true },
    })
    if (!member) throw new NotFoundException('协作成员不存在')
    return this.teamUpdate(user, member.customerId, memberId, collaborationType)
  }

  async collaborationRemove(user: AuthUser, memberId: string) {
    const member = await this.prisma.customerCollaboration.findFirst({
      where: { id: memberId, customer: { organizationId: user.tenantId } },
      select: { customerId: true },
    })
    if (!member) throw new NotFoundException('协作成员不存在')
    return this.teamRemove(user, member.customerId, memberId)
  }

  async collaborationBatchRemove(user: AuthUser, ids: string[]) {
    const members = await this.prisma.customerCollaboration.findMany({
      where: { id: { in: ids }, customer: { organizationId: user.tenantId } },
      select: { id: true, customerId: true },
    })
    if (members.length !== new Set(ids).size) throw new NotFoundException('协作成员不存在')
    const customerIds = [...new Set(members.map((member) => member.customerId))]
    await Promise.all(customerIds.map((id) => this.customerAccess.assertManageCustomer(user, id)))
    await this.prisma.customerCollaboration.deleteMany({ where: { id: { in: ids } } })
    return { count: members.length }
  }

  // ===== 客户集团 / 子公司关系 =====

  async relationList(user: AuthUser, customerId: string) {
    await this.customerAccess.assertRead(user, customerId)
    const rows = await this.prisma.customerRelation.findMany({
      where: {
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
      orderBy: { createTime: 'asc' },
    })
    const relatedIds = rows.map((row) =>
      row.sourceCustomerId === customerId ? row.targetCustomerId : row.sourceCustomerId,
    )
    const customers = await this.prisma.customer.findMany({
      where: { organizationId: user.tenantId, id: { in: relatedIds } },
      select: { id: true, name: true },
    })
    const names = new Map(customers.map((item) => [item.id, item.name]))
    return rows.map((row) => {
      const isGroup = row.targetCustomerId === customerId
      const relatedId = isGroup ? row.sourceCustomerId : row.targetCustomerId
      return {
        id: row.id,
        relationType: isGroup ? ('GROUP' as const) : ('SUBSIDIARY' as const),
        customerId: relatedId,
        customerName: names.get(relatedId) ?? null,
        createdAt: new Date(Number(row.createTime)).toISOString(),
      }
    })
  }

  /**
   * Cordys 客户关系编辑器采用“整组替换保存”。
   * 现有单条 CRUD 保留兼容；新前端优先使用此接口，避免客户端计算增删改差异。
   */
  async relationReplace(user: AuthUser, customerId: string, requests: SaveCustomerRelationDto[]) {
    await this.ensureInScope(user, customerId, 'customer:update')
    if (requests.length > 11) throw new BadRequestException('客户关系最多 11 条')

    const customerIds = requests.map((item) => item.customerId)
    if (new Set(customerIds).size !== customerIds.length) {
      throw new BadRequestException('同一个客户不能重复建立关系')
    }
    if (requests.filter((item) => item.relationType === 'GROUP').length > 1) {
      throw new BadRequestException('一个客户只能设置一个上级集团')
    }
    if (requests.filter((item) => item.relationType === 'SUBSIDIARY').length > 10) {
      throw new BadRequestException('一个客户最多设置 10 个子公司')
    }

    const currentRows = await this.prisma.customerRelation.findMany({
      where: {
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
      select: { id: true },
    })
    const excludeIds = currentRows.map((row) => row.id)
    const relations: {
      sourceCustomerId: string
      targetCustomerId: string
      createTime: bigint
    }[] = []
    for (const request of requests) {
      const relation = await this.buildCustomerRelation(
        user,
        customerId,
        request.customerId,
        request.relationType,
      )
      await this.assertCustomerRelationValid(
        user.tenantId,
        relation.sourceCustomerId,
        relation.targetCustomerId,
        excludeIds,
      )
      relations.push(relation)
    }
    await this.assertCustomerRelationGraphValid(user.tenantId, relations, excludeIds)

    await this.prisma.$transaction(async (tx) => {
      await tx.customerRelation.deleteMany({
        where: {
          OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
        },
      })
      if (relations.length > 0) await tx.customerRelation.createMany({ data: relations })
    })
    return this.relationList(user, customerId)
  }

  async relationAdd(
    user: AuthUser,
    customerId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const relation = await this.buildCustomerRelation(
      user,
      customerId,
      relatedCustomerId,
      relationType,
    )
    await this.assertCustomerRelationValid(
      user.tenantId,
      relation.sourceCustomerId,
      relation.targetCustomerId,
    )
    return this.prisma.customerRelation.create({ data: relation })
  }

  async relationUpdate(
    user: AuthUser,
    customerId: string,
    relationId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const existing = await this.prisma.customerRelation.findFirst({
      where: {
        id: relationId,
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
    })
    if (!existing) throw new NotFoundException('客户关系不存在')
    const relation = await this.buildCustomerRelation(
      user,
      customerId,
      relatedCustomerId,
      relationType,
    )
    await this.assertCustomerRelationValid(
      user.tenantId,
      relation.sourceCustomerId,
      relation.targetCustomerId,
      [relationId],
    )
    return this.prisma.customerRelation.update({
      where: { id: relationId },
      data: {
        sourceCustomerId: relation.sourceCustomerId,
        targetCustomerId: relation.targetCustomerId,
      },
    })
  }

  async relationRemove(user: AuthUser, customerId: string, relationId: string) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const result = await this.prisma.customerRelation.deleteMany({
      where: {
        id: relationId,
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
    })
    if (result.count === 0) throw new NotFoundException('客户关系不存在')
    return { id: relationId }
  }

  async relationRemoveById(user: AuthUser, relationId: string) {
    const relation = await this.prisma.customerRelation.findFirst({
      where: {
        id: relationId,
        sourceCustomer: { organizationId: user.tenantId },
      },
      select: { sourceCustomerId: true, targetCustomerId: true },
    })
    if (!relation) throw new NotFoundException('客户关系不存在')
    const sourceAccess = await this.customerAccess
      .assertRead(user, relation.sourceCustomerId)
      .catch(() => null)
    const customerId = sourceAccess ? relation.sourceCustomerId : relation.targetCustomerId
    return this.relationRemove(user, customerId, relationId)
  }

  async mergePreview(user: AuthUser, dto: CustomerMergeDto) {
    const context = await this.prepareMergeContext(user, dto)
    const [
      ownerMap,
      opportunityCount,
      quoteCount,
      contractCount,
      followUpCount,
      followUpPlanCount,
      attachmentCount,
      collaborationCount,
      relationCount,
    ] = await Promise.all([
      this.userNames([
        context.target.owner,
        ...context.sources.map((item) => item.owner),
        context.newOwner.id,
      ]),
      this.prisma.opportunity.count({
        where: { organizationId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.quote.count({
        where: { tenantId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.contract.count({
        where: { tenantId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.followUpRecord.count({
        where: {
          tenantId: user.tenantId,
          targetType: 'customer',
          targetId: { in: context.sourceIds },
        },
      }),
      this.prisma.followUpPlan.count({
        where: {
          tenantId: user.tenantId,
          targetType: 'customer',
          targetId: { in: context.sourceIds },
        },
      }),
      this.prisma.attachment.count({
        where: {
          tenantId: user.tenantId,
          targetType: 'customer',
          targetId: { in: context.sourceIds },
        },
      }),
      this.prisma.customerCollaboration.count({
        where: { customerId: { in: context.sourceIds } },
      }),
      this.prisma.customerRelation.count({
        where: {
          OR: [
            { sourceCustomerId: { in: context.sourceIds } },
            { targetCustomerId: { in: context.sourceIds } },
          ],
        },
      }),
    ])

    return {
      targetWasSelected: context.targetWasSelected,
      target: {
        id: context.target.id,
        name: context.target.name,
        ownerId: context.target.owner,
        ownerName: context.target.owner ? (ownerMap.get(context.target.owner) ?? null) : null,
      },
      sources: context.sources.map((source) => ({
        id: source.id,
        name: source.name,
        ownerId: source.owner,
        ownerName: source.owner ? (ownerMap.get(source.owner) ?? null) : null,
      })),
      finalOwner: {
        id: context.newOwner.id,
        name: ownerMap.get(context.newOwner.id) ?? null,
      },
      counts: {
        customersToDelete: context.sourceIds.length,
        contacts: context.sourceContacts.length,
        contactsWillMove: context.sourceContacts.length - context.skipContactIds.length,
        contactsWillSkip: context.skipContactIds.length,
        opportunities: opportunityCount,
        quotes: quoteCount,
        contracts: contractCount,
        followUps: followUpCount,
        followUpPlans: followUpPlanCount,
        attachments: attachmentCount,
        collaborations: collaborationCount,
        relationsToRemove: relationCount,
      },
      contactConflicts: context.contactConflicts,
    }
  }

  async merge(user: AuthUser, dto: CustomerMergeDto) {
    const context = await this.prepareMergeContext(user, dto)
    const { sourceIds, target, sources, newOwner, skipContactIds, contactConflicts } = context

    const sourceNames = sources.map((source) => source.name)
    const sourceTeams = await this.prisma.customerCollaboration.findMany({
      where: { customerId: { in: sourceIds } },
    })
    const targetTeams = await this.prisma.customerCollaboration.findMany({
      where: { customerId: dto.toMergeId },
      select: { userId: true },
    })
    const existingTeamUsers = new Set(targetTeams.map((item) => item.userId))
    const collaboration = new Map<string, 'READ_ONLY' | 'COLLABORATION'>()
    for (const item of sourceTeams) {
      const type = item.collaborationType === 'READ_ONLY' ? 'READ_ONLY' : 'COLLABORATION'
      const previous = collaboration.get(item.userId)
      if (!previous || type === 'COLLABORATION') collaboration.set(item.userId, type)
    }
    for (const source of sources) {
      if (source.owner && !collaboration.has(source.owner)) {
        collaboration.set(source.owner, 'COLLABORATION')
      }
    }

    const now = BigInt(Date.now())
    const result = await this.prisma.$transaction(async (tx) => {
      // Cordys 核心合并对象：联系人、商机、跟进；MicroMatrix 额外同步直接 Customer FK。
      if (skipContactIds.length > 0) {
        for (const conflict of contactConflicts) {
          if (!skipContactIds.includes(conflict.sourceContactId)) continue
          const targetContactId = conflict.targetContactIds[0]
          if (targetContactId) {
            await tx.opportunity.updateMany({
              where: { organizationId: user.tenantId, contactId: conflict.sourceContactId },
              data: { contactId: targetContactId },
            })
            await tx.followUpPlan.updateMany({
              where: { tenantId: user.tenantId, contactId: conflict.sourceContactId },
              data: { contactId: targetContactId },
            })
            await tx.attachment.updateMany({
              where: {
                tenantId: user.tenantId,
                targetType: 'contact',
                targetId: conflict.sourceContactId,
              },
              data: { targetId: targetContactId },
            })
          }
        }
        await tx.customerContact.deleteMany({
          where: { organizationId: user.tenantId, id: { in: skipContactIds } },
        })
      }
      await tx.customerContact.updateMany({
        where: { organizationId: user.tenantId, customerId: { in: sourceIds } },
        data: {
          customerId: dto.toMergeId,
          updateTime: now,
          updateUser: user.id,
        },
      })
      await tx.opportunity.updateMany({
        where: { organizationId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.quote.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.contract.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.followUpRecord.updateMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: sourceIds } },
        data: { targetId: dto.toMergeId },
      })
      await tx.followUpPlan.updateMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: sourceIds } },
        data: { targetId: dto.toMergeId },
      })
      await tx.invoiceTitle.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.attachment.updateMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: sourceIds } },
        data: { targetId: dto.toMergeId },
      })

      // Cordys 删除被合并客户的集团关系；目标客户已有关系保持不动。
      await tx.customerRelation.deleteMany({
        where: {
          OR: [{ sourceCustomerId: { in: sourceIds } }, { targetCustomerId: { in: sourceIds } }],
        },
      })

      for (const [userId, collaborationType] of collaboration) {
        if (userId === newOwner.id || existingTeamUsers.has(userId)) continue
        await tx.customerCollaboration.create({
          data: {
            customerId: dto.toMergeId,
            userId,
            collaborationType,
            createTime: now,
            updateTime: now,
            createUser: user.id,
            updateUser: user.id,
          },
        })
      }
      await tx.customerCollaboration.deleteMany({
        where: { customerId: { in: sourceIds } },
      })

      if (target.owner && target.owner !== newOwner.id && target.collectionTime !== null) {
        await tx.customerOwner.create({
          data: {
            customerId: target.id,
            owner: target.owner,
            operator: user.id,
            collectionTime: target.collectionTime,
            endTime: now,
          },
        })
      }
      if (target.owner && target.owner !== newOwner.id) {
        await tx.customerContact.updateMany({
          where: {
            organizationId: user.tenantId,
            customerId: target.id,
            owner: target.owner,
          },
          data: {
            owner: newOwner.id,
            updateTime: now,
            updateUser: user.id,
          },
        })
      }
      const mergedTarget = await tx.customer.update({
        where: { id: target.id },
        data: {
          owner: newOwner.id,
          inSharedPool: false,
          poolId: null,
          collectionTime:
            target.owner === newOwner.id && !target.inSharedPool ? target.collectionTime : now,
          updateTime: now,
          updateUser: user.id,
        },
      })
      await tx.customer.deleteMany({
        where: { organizationId: user.tenantId, id: { in: sourceIds } },
      })
      return mergedTarget
    })

    if (target.owner !== newOwner.id) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CUSTOMER_TRANSFERRED_CUSTOMER',
        operatorId: user.id,
        recipientIds: [newOwner.id],
        excludeSelf: true,
        type: 'assign',
        title: '客户已转移给你',
        content: `${user.name} 将合并后的客户「${target.name}」分配给你`,
        link: `/customers/${target.id}`,
      })
    }
    await this.changeLog.record(user, {
      module: 'customer',
      action: 'merge',
      targetId: target.id,
      targetName: target.name,
      before: { ownerId: target.owner, merge: sourceNames },
      after: { ownerId: result.owner, merge: [target.name] },
    })
    return { id: target.id, name: target.name, merged: sourceIds.length }
  }

  async ownerHistory(user: AuthUser, customerId: string) {
    await this.customerAccess.assertOwnerHistoryRead(user, customerId)
    return this.pools.ownerHistory(user, 'customer', customerId)
  }

  private async prepareMergeContext(user: AuthUser, dto: CustomerMergeDto) {
    const requestedIds = [...new Set(dto.mergeIds)]
    const targetWasSelected = requestedIds.includes(dto.toMergeId)
    const sourceIds = requestedIds.filter((id) => id !== dto.toMergeId)
    if (sourceIds.length === 0) throw new BadRequestException('没有可合并的客户')

    const target = await this.ensureInScope(user, dto.toMergeId, 'customer:merge')
    const sources: (typeof target)[] = []
    for (const sourceId of sourceIds) {
      sources.push(await this.ensureInScope(user, sourceId, 'customer:merge'))
    }
    const newOwner = await this.resolveOwner(user, dto.ownerId)

    if (targetWasSelected) {
      const selectedOwnerIds = new Set(
        [target, ...sources].map((item) => item.owner).filter((id): id is string => !!id),
      )
      if (!selectedOwnerIds.has(newOwner.id)) {
        throw new BadRequestException('主客户来自已选客户时，最终负责人必须来自已选客户负责人')
      }
    } else {
      if (!target.owner) {
        throw new BadRequestException('其它主客户当前没有负责人，请改用已选客户作为主客户')
      }
      if (newOwner.id !== target.owner) {
        throw new BadRequestException('主客户来自其它客户时，最终负责人必须保持主客户原负责人')
      }
    }

    const sourceOwnedByNewOwner = sources.filter(
      (source) => source.owner === newOwner.id && !source.inSharedPool,
    ).length
    const targetAddsCapacity = target.owner !== newOwner.id || target.inSharedPool
    if (targetAddsCapacity && sourceOwnedByNewOwner === 0) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', newOwner.id)
    }

    const [targetContacts, sourceContacts] = await Promise.all([
      this.prisma.customerContact.findMany({
        where: { organizationId: user.tenantId, customerId: target.id },
        select: { id: true, customerId: true, name: true, phone: true },
      }),
      this.prisma.customerContact.findMany({
        where: { organizationId: user.tenantId, customerId: { in: sourceIds } },
        select: { id: true, customerId: true, name: true, phone: true },
      }),
    ])
    const contactFields = await this.metadata.fieldsMap(user.tenantId, 'contact')
    const uniqueRules = {
      name: contactFields.get('name')?.config?.unique === true,
      phone: contactFields.get('phone')?.config?.unique === true,
    }
    const contactConflicts = this.findMergeContactConflicts(
      targetContacts.filter(
        (contact): contact is typeof contact & { customerId: string } =>
          contact.customerId !== null,
      ),
      sourceContacts.filter(
        (contact): contact is typeof contact & { customerId: string } =>
          contact.customerId !== null,
      ),
      uniqueRules,
    )
    const skipContactIds = contactConflicts.map((item) => item.sourceContactId)

    return {
      requestedIds,
      targetWasSelected,
      sourceIds,
      target,
      sources,
      newOwner,
      sourceContacts,
      contactConflicts,
      skipContactIds,
    }
  }

  private findMergeContactConflicts(
    targetContacts: { id: string; customerId: string; name: string; phone: string | null }[],
    sourceContacts: { id: string; customerId: string; name: string; phone: string | null }[],
    uniqueRules: { name: boolean; phone: boolean },
  ) {
    const normalizeName = (value: string) => value.trim().toLocaleLowerCase()
    const normalizePhone = (value: string | null) => value?.trim() ?? ''
    const targetNames = new Map<string, string[]>()
    const targetPhones = new Map<string, string[]>()
    for (const contact of targetContacts) {
      const name = normalizeName(contact.name)
      if (uniqueRules.name && name) {
        targetNames.set(name, [...(targetNames.get(name) ?? []), contact.id])
      }
      const phone = normalizePhone(contact.phone)
      if (uniqueRules.phone && phone) {
        targetPhones.set(phone, [...(targetPhones.get(phone) ?? []), contact.id])
      }
    }

    return sourceContacts.flatMap((contact) => {
      const matchedBy: ('name' | 'phone')[] = []
      const targetContactIds = new Set<string>()
      const nameMatches = uniqueRules.name
        ? (targetNames.get(normalizeName(contact.name)) ?? [])
        : []
      if (nameMatches.length > 0) {
        matchedBy.push('name')
        nameMatches.forEach((id) => targetContactIds.add(id))
      }
      const phone = normalizePhone(contact.phone)
      const phoneMatches = uniqueRules.phone && phone ? (targetPhones.get(phone) ?? []) : []
      if (phoneMatches.length > 0) {
        matchedBy.push('phone')
        phoneMatches.forEach((id) => targetContactIds.add(id))
      }
      if (matchedBy.length === 0) return []
      return [
        {
          sourceContactId: contact.id,
          sourceCustomerId: contact.customerId,
          name: contact.name,
          phone: contact.phone,
          matchedBy,
          targetContactIds: [...targetContactIds],
        },
      ]
    })
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))]
    if (unique.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  private assert360ResourcePermission(user: AuthUser, resource: Customer360Resource) {
    const permission = this.customer360ResourcePermission(resource)
    if (!hasPermission(user.permissions, permission)) {
      throw new ForbiddenException('没有查看该客户关联数据的权限')
    }
  }

  private customer360ResourceScope(user: AuthUser, resource: Customer360Resource) {
    const permission = this.customer360ResourcePermission(resource)
    return resource === 'opportunities'
      ? this.dataScope.directOwnerFilter(user, permission)
      : this.dataScope.scopeFilter(user, permission)
  }

  private customer360ResourcePermission(resource: Customer360Resource) {
    return resource === 'opportunities'
      ? 'menu:opportunity'
      : resource === 'orders'
        ? 'menu:order'
        : 'menu:contract'
  }

  private receivablePlanStatus(
    amount: number,
    paidAmount: number,
    dueDate: Date,
  ): ReceivablePlanStatus {
    if (paidAmount >= amount && amount > 0) return 'PAID'
    if (paidAmount > 0) return 'PARTIAL'
    if (dueDate < new Date()) return 'OVERDUE'
    return 'PENDING'
  }

  private async buildCustomerRelation(
    user: AuthUser,
    customerId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    if (customerId === relatedCustomerId)
      throw new BadRequestException('客户不能与自己建立集团关系')
    const related = await this.prisma.customer.findFirst({
      where: { id: relatedCustomerId, organizationId: user.tenantId },
      select: { id: true },
    })
    if (!related) throw new NotFoundException('关联客户不存在')
    return relationType === 'GROUP'
      ? {
          sourceCustomerId: relatedCustomerId,
          targetCustomerId: customerId,
          createTime: BigInt(Date.now()),
        }
      : {
          sourceCustomerId: customerId,
          targetCustomerId: relatedCustomerId,
          createTime: BigInt(Date.now()),
        }
  }

  private async assertCustomerRelationValid(
    tenantId: string,
    sourceCustomerId: string,
    targetCustomerId: string,
    excludeIds: string[] = [],
  ) {
    const existingEdge = await this.prisma.customerRelation.findFirst({
      where: {
        sourceCustomerId,
        targetCustomerId,
        sourceCustomer: { organizationId: tenantId },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      select: { id: true },
    })
    if (existingEdge) throw new BadRequestException('同一个客户不能重复建立关系')

    const existingParent = await this.prisma.customerRelation.findFirst({
      where: {
        targetCustomerId,
        sourceCustomer: { organizationId: tenantId },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      select: { sourceCustomerId: true },
    })
    if (existingParent && existingParent.sourceCustomerId !== sourceCustomerId) {
      const group = await this.prisma.customer.findFirst({
        where: { id: existingParent.sourceCustomerId, organizationId: tenantId },
        select: { name: true },
      })
      throw new BadRequestException(`该子公司已属于集团「${group?.name ?? '未知客户'}」`)
    }

    const subsidiaryCount = await this.prisma.customerRelation.count({
      where: {
        sourceCustomerId,
        sourceCustomer: { organizationId: tenantId },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
    })
    if (subsidiaryCount >= 10) throw new BadRequestException('一个客户最多设置 10 个子公司')

    // 防止直接或间接形成集团关系环。
    let current: string | null = sourceCustomerId
    const visited = new Set<string>()
    while (current) {
      if (current === targetCustomerId) throw new BadRequestException('客户集团关系不能形成循环')
      if (visited.has(current)) break
      visited.add(current)
      const parent: { sourceCustomerId: string } | null =
        await this.prisma.customerRelation.findFirst({
          where: {
            targetCustomerId: current,
            sourceCustomer: { organizationId: tenantId },
            ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
          },
          select: { sourceCustomerId: true },
        })
      current = parent?.sourceCustomerId ?? null
    }
  }

  private async assertCustomerRelationGraphValid(
    tenantId: string,
    pending: { sourceCustomerId: string; targetCustomerId: string }[],
    excludeIds: string[],
  ) {
    const existing = await this.prisma.customerRelation.findMany({
      where: {
        sourceCustomer: { organizationId: tenantId },
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      select: { sourceCustomerId: true, targetCustomerId: true },
    })
    const edges = [...existing, ...pending]

    const parentCount = new Map<string, number>()
    const childCount = new Map<string, number>()
    const adjacency = new Map<string, string[]>()
    for (const edge of edges) {
      parentCount.set(edge.targetCustomerId, (parentCount.get(edge.targetCustomerId) ?? 0) + 1)
      if ((parentCount.get(edge.targetCustomerId) ?? 0) > 1) {
        throw new BadRequestException('一个子公司只能属于一个集团')
      }
      childCount.set(edge.sourceCustomerId, (childCount.get(edge.sourceCustomerId) ?? 0) + 1)
      if ((childCount.get(edge.sourceCustomerId) ?? 0) > 10) {
        throw new BadRequestException('一个客户最多设置 10 个子公司')
      }
      const next = adjacency.get(edge.sourceCustomerId) ?? []
      next.push(edge.targetCustomerId)
      adjacency.set(edge.sourceCustomerId, next)
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false
      if (visited.has(id)) return true
      visiting.add(id)
      for (const next of adjacency.get(id) ?? []) {
        if (!visit(next)) return false
      }
      visiting.delete(id)
      visited.add(id)
      return true
    }
    for (const id of adjacency.keys()) {
      if (!visit(id)) throw new BadRequestException('客户关系不能形成循环')
    }
  }

  private async findExactCustomerDuplicate(user: AuthUser, name: string, phone?: string) {
    const phoneIds = phone
      ? await this.fieldValues.filterResourceIds(user.tenantId, 'customer', [
          { key: 'cf_phone', op: 'eq', value: phone },
        ])
      : []
    return this.prisma.customer.findFirst({
      where: {
        organizationId: user.tenantId,
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          ...(phoneIds.length ? [{ id: { in: phoneIds } }] : []),
        ],
      },
      select: { id: true, name: true },
    })
  }

  private async assertCustomerUniqueRules(
    tenantId: string,
    values: { name?: string; phone?: string; email?: string },
    excludeId?: string,
  ) {
    const fields = await this.metadata.fieldsMap(tenantId, MODULE)
    if (!fields.get('name')?.config?.unique || !values.name?.trim()) return
    const duplicate = await this.prisma.customer.findFirst({
      where: {
        organizationId: tenantId,
        ...(excludeId ? { id: { not: excludeId } } : {}),
        name: { equals: values.name.trim(), mode: 'insensitive' },
      },
      select: { id: true },
    })
    if (duplicate) throw new BadRequestException('「客户名称」不能重复')
  }

  private async inScopeCustomerIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const poolIds = (await this.pools.options(user, 'customer')).map((pool) => pool.id)
    const collaborationIds = await this.prisma.customerCollaboration.findMany({
      where: { customerId: { in: unique }, userId: user.id },
      select: { customerId: true },
    })
    const rows = await this.prisma.customer.findMany({
      where: {
        id: { in: unique },
        organizationId: user.tenantId,
        OR: [
          { inSharedPool: true, poolId: { in: poolIds } },
          await this.dataScope.directOwnerFilter(user, 'customer:read'),
          { id: { in: collaborationIds.map((item) => item.customerId) } },
        ],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async inScopeLeadIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const rows = await this.prisma.clue.findMany({
      where: {
        id: { in: unique },
        organizationId: user.tenantId,
        OR: [{ inSharedPool: true }, await this.dataScope.directOwnerFilter(user, 'menu:lead')],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async inScopeOpportunityIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.directOwnerFilter(user, 'menu:opportunity')
    const rows = await this.prisma.opportunity.findMany({
      where: {
        id: { in: unique },
        organizationId: user.tenantId,
        AND: [scope as Prisma.OpportunityWhereInput],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async attachmentMap(tenantId: string, targetType: string, targetIds: string[]) {
    const map = new Map<
      string,
      {
        id: string
        name: string
        size: number
        mime: string | null
        targetType: string | null
        targetId: string | null
        uploaderId: string | null
        createdAt: string
      }[]
    >()
    if (targetIds.length === 0) return map
    const rows = await this.prisma.attachment.findMany({
      where: { tenantId, targetType, targetId: { in: targetIds } },
      orderBy: { createdAt: 'asc' },
    })
    for (const row of rows) {
      if (!row.targetId) continue
      const list = map.get(row.targetId) ?? []
      list.push({
        id: row.id,
        name: row.name,
        size: row.size,
        mime: row.mime,
        targetType: row.targetType,
        targetId: row.targetId,
        uploaderId: row.uploaderId,
        createdAt: row.createdAt.toISOString(),
      })
      map.set(row.targetId, list)
    }
    return map
  }

  /** 导出 CSV（按字段配置的列表列） */
  async exportCsv(
    user: AuthUser,
    query: QueryCustomersDto,
  ): Promise<{ filename: string; csv: string }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const columns = fields.filter((f) => f.showInList && !f.hidden)
    const result = await this.findAll(user, { ...query, page: 1, pageSize: 5000 })

    const headers = [...columns.map((c) => c.label), '创建时间']
    const rows = result.items.map((item) => [
      ...columns.map((c) => formatForExport(c, item as unknown as Record<string, unknown>)),
      item.createdAt.slice(0, 10),
    ])
    return {
      filename: `客户导出_${new Date().toISOString().slice(0, 10)}.csv`,
      csv: toCsv(headers, rows),
    }
  }

  async importTemplate(
    user: AuthUser,
    importType: ImportType,
    poolId?: string,
  ): Promise<{ filename: string; data: Buffer }> {
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: poolId ? ['owner', 'ownerId'] : [],
    })
    return {
      filename: `${poolId ? '客户公海' : '客户'}${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async poolImportTemplate(
    user: AuthUser,
    importType: ImportType,
  ): Promise<{ filename: string; data: Buffer }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: ['owner', 'ownerId'],
    })
    return {
      filename: `客户公海${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
    poolId?: string,
  ): Promise<ImportResultVO> {
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['owner', 'ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    const seen = new Set<string>()
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
            const fingerprint = `${prepared.dto.name?.trim().toLowerCase() ?? ''}|${prepared.dto.phone?.trim() ?? ''}`
            if (seen.has(fingerprint)) throw new BadRequestException('导入文件内存在重复客户')
            seen.add(fingerprint)
          }
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
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['owner', 'ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    const seen = new Set<string>()
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
            const fingerprint = `${prepared.dto.name?.trim().toLowerCase() ?? ''}|${prepared.dto.phone?.trim() ?? ''}`
            if (seen.has(fingerprint)) throw new BadRequestException('导入文件内存在重复客户')
            seen.add(fingerprint)
            if (poolId) await this.createInSea(user, prepared.dto, poolId)
            else await this.create(user, prepared.dto as CreateCustomerDto)
          } else if (poolId) {
            if (!prepared.existing) throw new BadRequestException('客户不存在或不属于当前公海')
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
    query: QueryCustomersDto,
    input: { fileName: string; headList: string[]; ids?: string[]; poolId?: string },
  ) {
    const poolMode = Boolean(input.poolId)
    if (poolMode) await this.pools.assertPoolMember(user, 'customer', input.poolId as string)
    const effectiveQuery: QueryCustomersDto = {
      ...query,
      scope: poolMode ? 'sea' : undefined,
      poolId: poolMode ? input.poolId : undefined,
    }
    const items = await this.collectExportItems(user, effectiveQuery, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
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
    const rows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          const field = fieldMap.get(column.key)
          return [column.key, field ? formatForExport(field, source) : (source[column.key] ?? '')]
        }),
      )
    })
    return this.exportTasks.create(user, {
      module: poolMode ? 'customer_pool' : 'customer',
      fileName: input.fileName,
      columns,
      rows,
    })
  }

  /** 批量导入（前端解析 CSV 后传结构化行） */
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
        const name = String(rest.name ?? '').trim()
        const phone = rest.phone ? String(rest.phone).trim() : undefined
        if (!name) throw new BadRequestException('名称为空')
        const duplicate = await this.findExactCustomerDuplicate(user, name, phone)
        if (duplicate) throw new BadRequestException(`与已有客户「${duplicate.name}」重复`)
        await this.create(user, {
          name,
          industry: rest.industry ? String(rest.industry) : undefined,
          phone,
          email: rest.email ? String(rest.email) : undefined,
          remark: rest.remark ? String(rest.remark) : undefined,
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
      name: `导入客户 ${success} 条`,
    }
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
    poolId?: string,
  ): Promise<{
    dto: UpdateCustomerDto
    existing?: Customer
  }> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const dto: UpdateCustomerDto = {}
    const customData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap.get(key)
      if (!field || field.hidden || field.type === 'formula') continue
      this.metadata.validateBatchFieldValue(field, value)
      if (poolId && (key === 'owner' || key === 'ownerId'))
        throw new BadRequestException('客户公海导入不允许设置负责人')
      if (key === 'owner' || key === 'ownerId') {
        dto.ownerId = await this.resolveImportOwner(user, String(value))
      } else if (key.startsWith('cf_')) {
        customData[key] = value
        if (key === 'cf_industry') dto.industry = String(value ?? '')
        if (key === 'cf_phone') dto.phone = String(value ?? '')
        if (key === 'cf_email') dto.email = String(value ?? '')
        if (key === 'cf_remark') dto.remark = String(value ?? '')
      } else {
        ;(dto as Record<string, unknown>)[key] = value
      }
    }
    if (Object.keys(customData).length > 0) dto.customData = customData
    await this.fieldValues.validate(user.tenantId, 'customer', customData, {
      mode: importType === 'ADD' ? 'create' : 'update',
      resourceId: importType === 'UPDATE' ? resourceId : undefined,
    })

    if (importType === 'ADD') {
      const name = typeof dto.name === 'string' ? dto.name.trim() : ''
      if (!name) throw new BadRequestException('客户名称不能为空')
      const duplicate = await this.findExactCustomerDuplicate(user, name, dto.phone)
      if (duplicate) throw new BadRequestException(`与已有客户「${duplicate.name}」重复`)
      if (!poolId)
        await this.pools.assertCapacityForOwner(user.tenantId, 'customer', dto.ownerId ?? user.id)
      else await this.pools.resolveTargetPool(user, 'customer', poolId)
      return { dto }
    }

    if (!resourceId) throw new BadRequestException('唯一ID不能为空')
    const existing = poolId
      ? await this.prisma.customer.findFirst({
          where: {
            id: resourceId,
            organizationId: user.tenantId,
            inSharedPool: true,
            poolId,
          },
        })
      : await this.ensureInScope(user, resourceId, 'customer:import')
    if (!existing) throw new BadRequestException('客户不存在或不属于当前公海')
    if (dto.ownerId && dto.ownerId !== existing.owner) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', dto.ownerId)
    }
    return { dto, existing }
  }

  private async createInSea(user: AuthUser, dto: UpdateCustomerDto, poolId: string) {
    const pool = await this.pools.resolveTargetPool(user, 'customer', poolId)
    const values = this.customerFieldInput(dto)
    await this.fieldValues.validate(user.tenantId, 'customer', values, { mode: 'create' })
    const name = typeof dto.name === 'string' ? dto.name.trim() : ''
    if (!name) throw new BadRequestException('客户名称不能为空')
    const now = BigInt(Date.now())
    const customer = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name,
          organizationId: user.tenantId,
          inSharedPool: true,
          poolId: pool.id,
          owner: null,
          collectionTime: null,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(user.tenantId, 'customer', created.id, values, 'create', tx)
      return created
    })
    return this.toSingleVO(user, customer)
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

  private async collectExportItems(user: AuthUser, query: QueryCustomersDto, ids?: string[]) {
    const all: CustomerVO[] = []
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
      throw new BadRequestException('选中数据包含不存在或无权导出的客户')
    return selected
  }

  /**
   * Cordys 在删除客户前会阻止仍被 Contact / Opportunity 引用的客户。
   * MicroMatrix 另外有 Quote / Contract 直接外键，因此一起保护，避免把业务拒绝退化成数据库 FK 500。
   */
  private async assertCustomersDeletable(tenantId: string, ids: string[]) {
    const [contacts, opportunities, quotes, contracts] = await Promise.all([
      this.prisma.customerContact.count({
        where: { organizationId: tenantId, customerId: { in: ids } },
      }),
      this.prisma.opportunity.count({ where: { organizationId: tenantId, customerId: { in: ids } } }),
      this.prisma.quote.count({ where: { tenantId, customerId: { in: ids } } }),
      this.prisma.contract.count({ where: { tenantId, customerId: { in: ids } } }),
    ])
    if (contacts + opportunities + quotes + contracts > 0) {
      throw new BadRequestException('客户已关联联系人、商机或交易数据，不能删除')
    }
  }

  private async deleteCustomerResources(
    user: AuthUser,
    customers: { id: string; name: string; owner: string | null }[],
  ) {
    const ids = customers.map((customer) => customer.id)
    await this.prisma.$transaction(async (tx) => {
      await tx.customerField.deleteMany({ where: { resourceId: { in: ids } } })
      await tx.customerFieldBlob.deleteMany({ where: { resourceId: { in: ids } } })
      await tx.followUpRecord.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: ids } },
      })
      await tx.followUpPlan.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: ids } },
      })
      await tx.customerOwner.deleteMany({ where: { customerId: { in: ids } } })
      await tx.customerRelation.deleteMany({
        where: {
          OR: [{ sourceCustomerId: { in: ids } }, { targetCustomerId: { in: ids } }],
        },
      })
      await tx.customerCollaboration.deleteMany({
        where: { customerId: { in: ids } },
      })
      await tx.attachment.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: ids } },
      })
      await tx.customer.deleteMany({ where: { organizationId: user.tenantId, id: { in: ids } } })
    })

    for (const customer of customers) {
      await this.changeLog.record(user, {
        module: 'customer',
        action: 'delete',
        targetId: customer.id,
        targetName: customer.name,
        before: customer,
        after: null,
      })
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CUSTOMER_DELETED',
        operatorId: user.id,
        recipientIds: [customer.owner],
        excludeSelf: true,
        type: 'system',
        title: '客户已删除',
        content: `${user.name} 删除了客户「${customer.name}」`,
        link: '/customers',
      })
    }
  }

  private async resolveListScope(
    user: AuthUser,
    view?: 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION',
  ): Promise<Prisma.CustomerWhereInput> {
    if (!view) return this.dataScope.directOwnerFilter(user, 'customer:read')
    if (view === 'SELF') return { owner: user.id }
    if (view === 'COLLABORATION') {
      const collaborations = await this.prisma.customerCollaboration.findMany({
        where: { userId: user.id, customer: { organizationId: user.tenantId } },
        select: { customerId: true },
      })
      return { id: { in: collaborations.map((item) => item.customerId) } }
    }
    if (view === 'ALL') {
      const roles = user.roles.filter((role) => hasPermission(role.permissions, 'customer:read'))
      if (!roles.some((role) => role.dataScope === 'ALL' || role.dataScope === 'CUSTOM')) {
        throw new ForbiddenException('当前角色没有全部客户视图权限')
      }
      return this.dataScope.directOwnerFilter(user, 'customer:read')
    }
    if (view === 'DEPARTMENT') {
      const roles = user.roles.filter((role) => hasPermission(role.permissions, 'customer:read'))
      if (!roles.some((role) => ['ALL', 'DEPT_AND_CHILD', 'CUSTOM'].includes(role.dataScope))) {
        throw new ForbiddenException('当前角色没有部门客户视图权限')
      }
      const effective = await this.dataScope.resolveScope(user, 'customer:read')
      if (effective.all) return {}
      const owners = await this.prisma.user.findMany({
        where: {
          tenantId: user.tenantId,
          OR: [{ id: user.id }, { deptId: { in: effective.deptIds } }],
        },
        select: { id: true },
      })
      return { owner: { in: owners.map((item) => item.id) } }
    }
    return this.dataScope.directOwnerFilter(user, 'customer:read')
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

  private async scopedWhere(
    user: AuthUser,
    id: string,
    permission: string,
  ): Promise<Prisma.CustomerWhereInput> {
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    return { id, organizationId: user.tenantId, inSharedPool: false, AND: [scope] }
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const found = await this.prisma.customer.findFirst({
      where: await this.scopedWhere(user, id, permission),
    })
    if (!found) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return found
  }

  private customerFieldInput(dto: UpdateCustomerDto): Record<string, unknown> {
    const values: Record<string, unknown> = { ...(dto.customData ?? {}) }
    const aliases = [
      ['cf_industry', dto.industry],
      ['cf_phone', dto.phone],
      ['cf_email', dto.email],
      ['cf_remark', dto.remark],
    ] as const
    for (const [key, value] of aliases) {
      if (value !== undefined) values[key] = value
    }
    return values
  }

  private async toSingleVO(user: AuthUser, customer: Customer): Promise<CustomerVO> {
    const [fields, values, ownerMap] = await Promise.all([
      this.metadata.listFields(user.tenantId, MODULE),
      this.fieldValues.load(user.tenantId, 'customer', [customer.id]),
      this.userNames([customer.owner]),
    ])
    return this.toVO(
      customer,
      fields,
      values.get(customer.id) ?? {},
      ownerMap.get(customer.owner ?? '') ?? null,
    )
  }

  private async filterCustomerIds(
    organizationId: string,
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ): Promise<string[]> {
    if (!conditions.length) return []
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
            await this.fieldValues.filterResourceIds(organizationId, 'customer', [condition]),
          )
        }
        const normalized = condition.key === 'ownerId' ? { ...condition, key: 'owner' } : condition
        const clauses = buildFilterClauses(fieldMap, [normalized])
        const rows = await this.prisma.customer.findMany({
          where: { organizationId, AND: clauses as Prisma.CustomerWhereInput[] },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }),
    )
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce((result, set) => new Set([...result].filter((id) => set.has(id))), sets[0]),
    ]
  }

  private async keywordCustomerIds(organizationId: string, keyword: string): Promise<string[]> {
    const conditions: FilterCondition[] = [
      { key: 'cf_phone', op: 'contains', value: keyword },
      { key: 'cf_email', op: 'contains', value: keyword },
    ]
    const matches = await Promise.all(
      conditions.map((condition) =>
        this.fieldValues.filterResourceIds(organizationId, 'customer', [condition]),
      ),
    )
    return [...new Set(matches.flat())]
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private toVO(
    customer: Customer,
    fields: FieldVO[],
    customData: Record<string, unknown>,
    ownerName: string | null,
  ): CustomerVO {
    const stringValue = (key: string) => {
      const value = customData[key]
      return value === undefined || value === null || value === '' ? null : String(value)
    }
    const record: Record<string, unknown> = {
      name: customer.name,
      industry: stringValue('cf_industry'),
      phone: stringValue('cf_phone'),
      email: stringValue('cf_email'),
      remark: stringValue('cf_remark'),
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)

    return {
      id: customer.id,
      name: customer.name,
      industry: stringValue('cf_industry'),
      phone: stringValue('cf_phone'),
      email: stringValue('cf_email'),
      remark: stringValue('cf_remark'),
      inSea: customer.inSharedPool,
      poolId: customer.poolId,
      ownerId: customer.owner,
      ownerName,
      deptId: null,
      customData: { ...customData, ...formulas },
      collectedAt:
        customer.collectionTime === null
          ? null
          : new Date(Number(customer.collectionTime)).toISOString(),
      poolEnteredAt: customer.inSharedPool
        ? new Date(Number(customer.updateTime)).toISOString()
        : null,
      lastFollowedAt:
        customer.followTime === null ? null : new Date(Number(customer.followTime)).toISOString(),
      createdAt: new Date(Number(customer.createTime)).toISOString(),
      updatedAt: new Date(Number(customer.updateTime)).toISOString(),
    }
  }
}
