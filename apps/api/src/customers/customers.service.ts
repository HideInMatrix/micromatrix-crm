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
import { parseFilters } from '../common/filter-builder'
import { DataScopeService } from '../common/services/data-scope.service'
import { BusinessChangeLogService } from '../common/services/business-change-log.service'
import { and, not, or } from '@prisma/orm-postgres/orm-client'
import { MetadataService } from '../modules/metadata/metadata.service'
import { ModuleFormsService } from '../modules/metadata/module-forms.service'
import { ResourceFieldValueService } from '../modules/metadata/resource-field-value.service'
import { DictionariesService } from '../modules/dictionaries/dictionaries.service'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../modules/import-export/export-tasks.service'
import type { ImportType } from '../modules/import-export/dto/import-export.dto'
import { SpreadsheetService } from '../modules/import-export/spreadsheet.service'
import { BusinessNotificationsService } from '../modules/notifications/business-notifications.service'
import { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import { CustomerPoolRepository } from '../modules/pool-rules/customer-pool.repository'
import { parseStringArray } from '../modules/pool-rules/pool-repository.helpers'
import { USER_VIEW_RESOURCE_TYPES } from '../modules/user-views/user-views.constants'
import { UserViewsService } from '../modules/user-views/user-views.service'
import type { PrismaClient } from '../prisma/prisma-client.js'
import { instantToISOString } from '../prisma/temporal.js'
import { createLegacyId32 } from '../common/legacy-id'
import { PrismaService } from '../prisma/prisma.service.js'
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
type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

type CustomerQueryInput = Omit<QueryCustomersDto, 'filters'> & {
  filters?: string | FilterCondition[]
}

type Customer = {
  id: string
  name: string
  owner: string | null
  collectionTime: bigint | null
  poolId: string | null
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
  inSharedPool: boolean
  organizationId: string
  follower: string | null
  followTime: bigint | null
  reasonId: string | null
}

type CustomerListScope = {
  owner?: string | { in: string[] }
  ids?: string[]
}

type CustomerQueryInput = Omit<QueryCustomersDto, 'filters'> & {
  filters?: string | FilterCondition[]
}

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
      filters: dto.filters,
      filterMode: dto.filterMode,
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
      filters: dto.filters,
      filterMode: dto.filterMode,
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
      await this.prisma.client.orm.public.Customer.where({
        id: result.id,
        organizationId: user.tenantId,
      }).update({
        follower: dto.follower ? dto.follower : null,
        followTime: dto.followTime === undefined ? undefined : BigInt(dto.followTime),
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
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    })
    if (value) query = query.where((row) => row.name.ilike('%' + value + '%'))
    const [list, aggregate] = await Promise.all([
      query
        .orderBy((row) => row.name.asc())
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .select('id', 'name')
        .all(),
      query.aggregate((row) => ({ count: row.count() })),
    ])
    return {
      list: list.map((item) => ({ id: String(item.id), name: String(item.name) })),
      total: aggregate.count,
      current,
      pageSize,
    }
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
      const subCategory = subCategoryField ? this.chartFieldValue(item, subCategoryField.key) : null
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
    const byIdentity = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
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

  async findAll(user: AuthUser, query: CustomerQueryInput): Promise<PaginatedResult<CustomerVO>> {
    const { page = 1, pageSize = 10, keyword } = query
    const poolMode = query.scope === 'sea'
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const adHocConditions = Array.isArray(query.filters)
      ? query.filters
      : parseFilters(query.filters)
    const viewResourceType = poolMode
      ? USER_VIEW_RESOURCE_TYPES.customer_pool
      : USER_VIEW_RESOURCE_TYPES.customer
    const saved = query.viewId
      ? await this.userViews.resolveFilters(user, query.viewId, viewResourceType)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterCustomerIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      adHocConditions.length
        ? this.filterCustomerIds(user.tenantId, adHocConditions, query.filterMode ?? 'AND')
        : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)

    let db = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    })
    if (poolMode) {
      const options = await this.pools.options(user, 'customer')
      const accessiblePoolIds = options.map((pool) => String(pool.id))
      if (query.poolId && !accessiblePoolIds.includes(query.poolId)) {
        throw new BadRequestException('你无权访问该公海')
      }
      db = db.where({ inSharedPool: true })
      if (query.poolId) {
        db = db.where({ poolId: query.poolId })
      } else {
        db = accessiblePoolIds.length
          ? db.where((row) => row.poolId.in(accessiblePoolIds))
          : db.where((row) => row.id.eq(''))
      }
    } else {
      db = db.where({ inSharedPool: false })
      const scope = await this.resolveListScope(user, query.view)
      if (scope.ids) {
        db = scope.ids.length
          ? db.where((row) => row.id.in(scope.ids!))
          : db.where((row) => row.id.eq(''))
      }
      const ownerScope = scope.owner
      if (typeof ownerScope === 'string') {
        db = db.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        db = db.where((row) => row.owner.in(ownerIds))
      }
    }
    if (filteredIds) db = db.where((row) => row.id.in(filteredIds))
    if (keyword) db = db.where((row) => row.name.ilike('%' + keyword + '%'))

    const [items, aggregate] = await Promise.all([
      db
        .orderBy((row) => row.createTime.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      db.aggregate((row) => ({ count: row.count() })),
    ])
    const normalized = items as unknown as Customer[]
    const [values, ownerMap] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customer',
        normalized.map((item) => item.id),
      ),
      this.userNames(normalized.map((item) => item.owner)),
    ])
    return {
      items: normalized.map((customer) =>
        this.toVO(
          customer,
          fields,
          values.get(customer.id) ?? {},
          ownerMap.get(customer.owner ?? '') ?? null,
        ),
      ),
      total: aggregate.count,
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
    const [adHocIds, collaborations, poolOptions, directScope] = await Promise.all([
      adHocConditions.length ? this.filterCustomerIds(user.tenantId, adHocConditions, 'AND') : null,
      this.prisma.client.orm.public.CustomerCollaboration.where({
        userId: user.id,
      })
        .select('customerId', 'collaborationType')
        .all(),
      this.pools.options(user, 'customer'),
      this.dataScope.directOwnerFilter(user, 'customer:read'),
    ])
    const accessiblePoolIds = poolOptions.map((pool) => String(pool.id))
    const collaborationIds = collaborations.map((item) => String(item.customerId))
    let db = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    })
    const directOwner = directScope.owner
    db = db.where((row) => {
      const direct =
        typeof directOwner === 'string'
          ? and(row.inSharedPool.eq(false), row.owner.eq(directOwner))
          : directOwner?.in
            ? and(row.inSharedPool.eq(false), row.owner.in(directOwner.in))
            : row.inSharedPool.eq(false)
      const collaborative = collaborationIds.length
        ? and(row.inSharedPool.eq(false), row.id.in(collaborationIds))
        : row.id.eq('')
      const pooled = accessiblePoolIds.length
        ? and(row.inSharedPool.eq(true), row.poolId.in(accessiblePoolIds))
        : row.id.eq('')
      return or(direct, collaborative, pooled)
    })
    if (adHocIds) db = db.where((row) => row.id.in(adHocIds))
    if (keyword) db = db.where((row) => row.name.ilike('%' + keyword + '%'))

    const [baseItems, aggregate] = await Promise.all([
      db
        .orderBy((row) => row.createTime.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      db.aggregate((row) => ({ count: row.count() })),
    ])
    const items = baseItems as unknown as Customer[]
    const [values, ownerMap] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customer',
        items.map((item) => item.id),
      ),
      this.userNames(items.map((item) => item.owner)),
    ])
    const collaborationMap = new Map(
      collaborations.map((item) => [String(item.customerId), String(item.collaborationType)]),
    )
    const directOwnerIds =
      typeof directOwner === 'string'
        ? new Set([directOwner])
        : directOwner?.in
          ? new Set(directOwner.in)
          : null
    return {
      items: items.map((customer) => {
        const direct = customer.inSharedPool
          ? !!customer.poolId && accessiblePoolIds.includes(customer.poolId)
          : directOwnerIds === null || (!!customer.owner && directOwnerIds.has(customer.owner))
        return {
          ...this.toVO(
            customer,
            fields,
            values.get(customer.id) ?? {},
            ownerMap.get(customer.owner ?? '') ?? null,
          ),
          collaborationType: direct ? null : (collaborationMap.get(customer.id) ?? null),
        }
      }),
      total: aggregate.count,
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
      this.prisma.client.orm.public.Customer.where({
        id: id,
        organizationId: user.tenantId,
      }).first(),
      this.metadata.listFields(user.tenantId, MODULE),
      this.fieldValues.load(user.tenantId, 'customer', [id]),
    ])
    if (!customer) throw new NotFoundException('客户不存在或不在你的数据范围内')
    const normalized = customer as unknown as Customer
    const ownerMap = await this.userNames([normalized.owner])
    return {
      ...this.toVO(
        normalized,
        fields,
        values.get(id) ?? {},
        ownerMap.get(normalized.owner ?? '') ?? null,
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
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    })
    if (value) query = query.where((row) => row.name.ilike('%' + value + '%'))
    const rows = await query
      .orderBy((row) => row.name.asc())
      .select('id', 'name')
      .limit(50)
      .all()
    return rows.map((row) => ({ id: String(row.id), name: String(row.name) }))
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

    let customerQuery = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    })
    if (name && customerPhoneIds.length) {
      customerQuery = customerQuery.where((row) =>
        or(row.name.ilike('%' + name + '%'), row.id.in(customerPhoneIds)),
      )
    } else if (name) {
      customerQuery = customerQuery.where((row) => row.name.ilike('%' + name + '%'))
    } else if (customerPhoneIds.length) {
      customerQuery = customerQuery.where((row) => row.id.in(customerPhoneIds))
    } else {
      customerQuery = customerQuery.where((row) => row.id.eq(''))
    }

    let contactQuery = this.prisma.client.orm.public.CustomerContact.where({
      organizationId: user.tenantId,
    })
    if (name && phone) {
      contactQuery = contactQuery.where((row) =>
        or(row.name.ilike('%' + name + '%'), row.phone.eq(phone)),
      )
    } else if (name) {
      contactQuery = contactQuery.where((row) => row.name.ilike('%' + name + '%'))
    } else if (phone) {
      contactQuery = contactQuery.where({ phone: phone })
    }

    let leadQuery = this.prisma.client.orm.public.Clue.where({
      organizationId: user.tenantId,
    }).where((row) => row.stage.neq('FAIL'))
    if (name && phone) {
      leadQuery = leadQuery.where((row) =>
        or(row.name.ilike('%' + name + '%'), row.phone.eq(phone)),
      )
    } else if (name) {
      leadQuery = leadQuery.where((row) => row.name.ilike('%' + name + '%'))
    } else if (phone) {
      leadQuery = leadQuery.where({ phone: phone })
    }

    const [customerRows, contactRows, leadRows, opportunityRows] = await Promise.all([
      customerQuery.limit(10).all(),
      contactQuery.limit(10).all(),
      leadQuery.limit(10).all(),
      name
        ? this.prisma.client.orm.public.Opportunity.where({
            organizationId: user.tenantId,
          })
            .where((row) => row.name.ilike('%' + name + '%'))
            .limit(10)
            .all()
        : Promise.resolve([]),
    ])
    const customers = customerRows as unknown as Customer[]
    const contactCustomerIds = [
      ...new Set(
        contactRows.flatMap((contact) => (contact.customerId ? [String(contact.customerId)] : [])),
      ),
    ]
    const opportunityCustomerIds = [
      ...new Set(
        opportunityRows.flatMap((item) => (item.customerId ? [String(item.customerId)] : [])),
      ),
    ]
    const refCustomerIds = [...new Set([...contactCustomerIds, ...opportunityCustomerIds])]
    const refCustomers = refCustomerIds.length
      ? await this.prisma.client.orm.public.Customer.where((row) => row.id.in(refCustomerIds))
          .select('id', 'name', 'owner', 'inSharedPool')
          .all()
      : []
    const customerRefMap = new Map(
      refCustomers.map((item) => [
        String(item.id),
        {
          id: String(item.id),
          name: String(item.name),
          owner: item.owner ? String(item.owner) : null,
          inSharedPool: item.inSharedPool,
        },
      ]),
    )
    const contacts = contactRows.map((contact) => ({
      id: String(contact.id),
      customerId: contact.customerId ? String(contact.customerId) : null,
      name: String(contact.name),
      phone: contact.phone ? String(contact.phone) : null,
      customer: contact.customerId
        ? (customerRefMap.get(String(contact.customerId)) ?? null)
        : null,
    }))
    const leads = leadRows.map((lead) => ({
      id: String(lead.id),
      name: String(lead.name),
      phone: lead.phone ? String(lead.phone) : null,
      owner: lead.owner ? String(lead.owner) : null,
      inSharedPool: lead.inSharedPool,
    }))
    const opportunities = opportunityRows.map((item) => ({
      id: String(item.id),
      name: String(item.name),
      owner: String(item.owner),
      customer: item.customerId ? (customerRefMap.get(String(item.customerId)) ?? null) : null,
    }))

    const customerIds = [
      ...customers.map((customer) => customer.id),
      ...contacts.flatMap((contact) => (contact.customerId ? [contact.customerId] : [])),
    ]
    const [inScopeCustomers, inScopeLeads, inScopeOpps, ownerMap, customerValues] =
      await Promise.all([
        this.inScopeCustomerIds(user, customerIds),
        this.inScopeLeadIds(
          user,
          leads.map((lead) => lead.id),
        ),
        this.inScopeOpportunityIds(
          user,
          opportunities.map((item) => item.id),
        ),
        this.userNames([
          ...customers.map((customer) => customer.owner),
          ...contacts.map((contact) => contact.customer?.owner),
          ...leads.map((lead) => lead.owner),
          ...opportunities.map((item) => item.owner),
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
        name: inScope ? row.name + '（' + row.customer.name + '）' : null,
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
        name: inScope ? row.name + (row.customer ? '（' + row.customer.name + '）' : '') : null,
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
      canReadContracts
        ? this.dataScope.directOwnerFilter(user, 'menu:contract')
        : Promise.resolve(null),
    ])

    let contactQuery = this.prisma.client.orm.public.CustomerContact.where({
      organizationId: user.tenantId,
      customerId: id,
    })
    if (!access.dataScope && !access.pool && access.collaborationType === 'COLLABORATION') {
      contactQuery = contactQuery.where({ owner: user.id })
    }
    let opportunityQuery = this.prisma.client.orm.public.Opportunity.where({
      organizationId: user.tenantId,
      customerId: id,
    })
    if (opportunityScope) {
      const ownerScope = opportunityScope.owner
      if (typeof ownerScope === 'string') {
        opportunityQuery = opportunityQuery.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        opportunityQuery = opportunityQuery.where((row) => row.owner.in(ownerIds))
      }
    }
    let contractQuery = this.prisma.client.orm.public.Contract.where({
      organizationId: user.tenantId,
      customerId: id,
    })
    if (contractScope) {
      const ownerScope = contractScope.owner
      if (typeof ownerScope === 'string') {
        contractQuery = contractQuery.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        contractQuery = contractQuery.where((row) => row.owner.in(ownerIds))
      }
    }

    const [contacts, opportunityRows, contracts, followUps, team] = await Promise.all([
      canReadContacts
        ? contactQuery.orderBy((row) => row.createTime.asc()).all()
        : Promise.resolve([]),
      canReadOpportunities
        ? opportunityQuery
            .orderBy((row) => row.createTime.desc())
            .limit(50)
            .all()
        : Promise.resolve([]),
      canReadContracts
        ? contractQuery
            .orderBy((row) => row.createTime.desc())
            .limit(50)
            .all()
        : Promise.resolve([]),
      this.prisma.client.orm.public.FollowUpRecords.where({
        tenantId: user.tenantId,
        targetType: 'customer',
        targetId: id,
      })
        .orderBy((row) => row.createdAt.desc())
        .limit(50)
        .all(),
      canReadTeam
        ? this.prisma.client.orm.public.CustomerCollaboration.where({
            customerId: id,
          })
            .orderBy((row) => row.createTime.asc())
            .all()
        : Promise.resolve([]),
    ])

    const stageIds = [...new Set(opportunityRows.map((item) => String(item.stage)))]
    const contractIds = contracts.map((item) => String(item.id))
    const [stageRows, paymentRecords, ownerMap] = await Promise.all([
      stageIds.length
        ? this.prisma.client.orm.public.OpportunityStageConfig.where((row) => row.id.in(stageIds))
            .select('id', 'name')
            .all()
        : Promise.resolve([]),
      contractIds.length
        ? this.prisma.client.orm.public.ContractPaymentRecord.where((row) =>
            row.contractId.in(contractIds),
          )
            .select('contractId', 'recordAmount')
            .all()
        : Promise.resolve([]),
      this.userNames([
        ...opportunityRows.map((item) => String(item.owner)),
        ...team.map((item) => String(item.userId)),
      ]),
    ])
    const stageMap = new Map(stageRows.map((stage) => [String(stage.id), String(stage.name)]))
    const paidMap = new Map<string, number>()
    for (const record of paymentRecords) {
      const contractId = String(record.contractId)
      paidMap.set(contractId, (paidMap.get(contractId) ?? 0) + Number(record.recordAmount ?? 0))
    }

    const contractRows = contracts.map((contract) => {
      const contractId = String(contract.id)
      return {
        id: contractId,
        name: String(contract.name),
        amount: Number(contract.amount),
        paidAmount: Math.round((paidMap.get(contractId) ?? 0) * 100) / 100,
        status: String(contract.stage),
        createdAt: new Date(Number(contract.createTime)).toISOString(),
      }
    })

    return {
      stats: {
        opportunityCount: opportunityRows.length,
        opportunityAmount:
          Math.round(
            opportunityRows.reduce((sum, item) => sum + Number(item.amount ?? 0), 0) * 100,
          ) / 100,
        contractCount: contracts.length,
        contractAmount:
          Math.round(contractRows.reduce((sum, item) => sum + item.amount, 0) * 100) / 100,
        paidAmount:
          Math.round(contractRows.reduce((sum, item) => sum + item.paidAmount, 0) * 100) / 100,
      },
      contacts: contacts.map((contact) => ({
        id: String(contact.id),
        name: String(contact.name),
        phone: contact.phone ? String(contact.phone) : null,
      })),
      opportunities: opportunityRows.map((item) => ({
        id: String(item.id),
        name: String(item.name),
        amount: item.amount === null ? null : Number(item.amount),
        stageName: stageMap.get(String(item.stage)) ?? String(item.stage),
        ownerName: ownerMap.get(String(item.owner)) ?? null,
        createdAt: new Date(Number(item.createTime)).toISOString(),
      })),
      contracts: contractRows,
      followUps: followUps.map((record) => ({
        id: record.id,
        targetType: record.targetType as 'customer',
        targetId: record.targetId,
        contactId: record.contactId,
        type: record._type,
        content: record.content,
        followedAt: record.followedAt ? instantToISOString(record.followedAt) : null,
        ownerId: record.ownerId,
        ownerName: record.ownerName,
        canManage: record.ownerId === user.id || hasPermission(user.permissions, '*'),
        commentCount: record.commentCount,
        moduleFields: [],
        createdAt: instantToISOString(record.createdAt),
        updatedAt: instantToISOString(record.updatedAt),
      })),
      team: team.map((member) => ({
        id: String(member.id),
        userId: String(member.userId),
        userName: ownerMap.get(String(member.userId)) ?? '未知',
        role: null,
        collaborationType: String(member.collaborationType) as 'READ_ONLY' | 'COLLABORATION',
        createdAt: new Date(Number(member.createTime)).toISOString(),
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
    const resourceScope = (await this.customer360ResourceScope(user, resource)) as CustomerListScope
    const ownerScope = resourceScope.owner
    const take = Math.min(Math.max(pageSize, 1), 100)
    const currentPage = Math.max(page, 1)
    const skip = (currentPage - 1) * take

    if (resource === 'opportunities') {
      let query = this.prisma.client.orm.public.Opportunity.where({
        organizationId: user.tenantId,
        customerId: id,
      })
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const [rows, aggregate] = await Promise.all([
        query
          .orderBy((row) => row.createTime.desc())
          .offset(skip)
          .limit(take)
          .all(),
        query.aggregate((row) => ({ count: row.count() })),
      ])
      const stageIds = [...new Set(rows.map((row) => String(row.stage)))]
      const [ownerMap, stages] = await Promise.all([
        this.userNames(rows.map((row) => String(row.owner))),
        stageIds.length
          ? this.prisma.client.orm.public.OpportunityStageConfig.where((row) => row.id.in(stageIds))
              .select('id', 'name')
              .all()
          : Promise.resolve([]),
      ])
      const stageMap = new Map(stages.map((stage) => [String(stage.id), String(stage.name)]))
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          amount: row.amount === null ? null : Number(row.amount),
          stageName: stageMap.get(String(row.stage)) ?? String(row.stage),
          ownerName: ownerMap.get(String(row.owner)) ?? null,
          createdAt: new Date(Number(row.createTime)).toISOString(),
        })),
        total: aggregate.count,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'contracts') {
      let query = this.prisma.client.orm.public.Contract.where({
        organizationId: user.tenantId,
        customerId: id,
      })
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const [rows, aggregate] = await Promise.all([
        query
          .orderBy((row) => row.createTime.desc())
          .offset(skip)
          .limit(take)
          .all(),
        query.aggregate((row) => ({ count: row.count() })),
      ])
      const contractIds = rows.map((row) => String(row.id))
      const [ownerMap, stageConfigs, paymentRecords] = await Promise.all([
        this.userNames(rows.map((row) => String(row.owner))),
        this.prisma.client.orm.public.ContractStageConfig.where({
          organizationId: user.tenantId,
        })
          .select('id', 'name')
          .all(),
        contractIds.length
          ? this.prisma.client.orm.public.ContractPaymentRecord.where((row) =>
              row.contractId.in(contractIds),
            )
              .select('contractId', 'recordAmount')
              .all()
          : Promise.resolve([]),
      ])
      const stageMap = new Map(stageConfigs.map((stage) => [String(stage.id), String(stage.name)]))
      const paidMap = new Map<string, number>()
      for (const record of paymentRecords) {
        const contractId = String(record.contractId)
        paidMap.set(contractId, (paidMap.get(contractId) ?? 0) + Number(record.recordAmount ?? 0))
      }
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          number: String(row.number),
          name: String(row.name),
          amount: Number(row.amount),
          paidAmount: Math.round((paidMap.get(String(row.id)) ?? 0) * 100) / 100,
          stage: String(row.stage),
          stageName: stageMap.get(String(row.stage)) ?? String(row.stage),
          approvalStatus: String(row.approvalStatus),
          ownerName: ownerMap.get(String(row.owner)) ?? null,
          createTime: Number(row.createTime),
        })),
        total: aggregate.count,
        page: currentPage,
        pageSize: take,
      }
    }

    const contractRows = await this.prisma.client.orm.public.Contract.where({
      organizationId: user.tenantId,
      customerId: id,
    })
      .select('id', 'name')
      .all()
    const contractIds = contractRows.map((row) => String(row.id))
    const contractMap = new Map(contractRows.map((row) => [String(row.id), String(row.name)]))

    if (resource === 'contractPaymentPlans') {
      let query = this.prisma.client.orm.public.ContractPaymentPlan.where({
        organizationId: user.tenantId,
      })
      query = contractIds.length
        ? query.where((row) => row.contractId.in(contractIds))
        : query.where((row) => row.id.eq(''))
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const [rows, aggregate] = await Promise.all([
        query
          .orderBy([(row) => row.planEndTime.asc(), (row) => row.createTime.asc()])
          .offset(skip)
          .limit(take)
          .all(),
        query.aggregate((row) => ({ count: row.count() })),
      ])
      const ownerMap = await this.userNames(rows.map((row) => String(row.owner)))
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          contractId: String(row.contractId),
          contractName: contractMap.get(String(row.contractId)) ?? '',
          owner: String(row.owner),
          ownerName: ownerMap.get(String(row.owner)) ?? null,
          planStatus: String(row.planStatus),
          planAmount: row.planAmount === null ? null : Number(row.planAmount),
          planEndTime: row.planEndTime === null ? null : Number(row.planEndTime),
          createTime: Number(row.createTime),
        })),
        total: aggregate.count,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'contractPaymentRecords') {
      let query = this.prisma.client.orm.public.ContractPaymentRecord.where({
        organizationId: user.tenantId,
      })
      query = contractIds.length
        ? query.where((row) => row.contractId.in(contractIds))
        : query.where((row) => row.id.eq(''))
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const [rows, aggregate] = await Promise.all([
        query
          .orderBy((row) => row.recordEndTime.desc())
          .offset(skip)
          .limit(take)
          .all(),
        query.aggregate((row) => ({ count: row.count() })),
      ])
      const planIds = [
        ...new Set(rows.flatMap((row) => (row.paymentPlanId ? [String(row.paymentPlanId)] : []))),
      ]
      const [ownerMap, plans] = await Promise.all([
        this.userNames(rows.map((row) => String(row.owner))),
        planIds.length
          ? this.prisma.client.orm.public.ContractPaymentPlan.where((row) => row.id.in(planIds))
              .select('id', 'name')
              .all()
          : Promise.resolve([]),
      ])
      const planMap = new Map(plans.map((plan) => [String(plan.id), String(plan.name)]))
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          no: row.no ? String(row.no) : null,
          contractId: String(row.contractId),
          contractName: contractMap.get(String(row.contractId)) ?? '',
          paymentPlanId: row.paymentPlanId ? String(row.paymentPlanId) : null,
          paymentPlanName: row.paymentPlanId
            ? (planMap.get(String(row.paymentPlanId)) ?? null)
            : null,
          owner: String(row.owner),
          ownerName: ownerMap.get(String(row.owner)) ?? null,
          recordAmount: row.recordAmount === null ? null : Number(row.recordAmount),
          recordEndTime: row.recordEndTime === null ? null : Number(row.recordEndTime),
          createTime: Number(row.createTime),
        })),
        total: aggregate.count,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'invoices') {
      let query = this.prisma.client.orm.public.ContractInvoice.where({
        organizationId: user.tenantId,
      })
      query = contractIds.length
        ? query.where((row) => row.contractId.in(contractIds))
        : query.where((row) => row.id.eq(''))
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const [rows, aggregate] = await Promise.all([
        query
          .orderBy((row) => row.createTime.desc())
          .offset(skip)
          .limit(take)
          .all(),
        query.aggregate((row) => ({ count: row.count() })),
      ])
      const titleIds = [
        ...new Set(
          rows.flatMap((row) => (row.businessTitleId ? [String(row.businessTitleId)] : [])),
        ),
      ]
      const [ownerMap, titles] = await Promise.all([
        this.userNames(rows.map((row) => String(row.owner))),
        titleIds.length
          ? this.prisma.client.orm.public.BusinessTitle.where((row) => row.id.in(titleIds))
              .select('id', 'name')
              .all()
          : Promise.resolve([]),
      ])
      const titleMap = new Map(titles.map((title) => [String(title.id), String(title.name)]))
      return {
        items: rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          contractId: String(row.contractId),
          contractName: contractMap.get(String(row.contractId)) ?? '',
          businessTitleId: row.businessTitleId ? String(row.businessTitleId) : null,
          businessTitleName: row.businessTitleId
            ? (titleMap.get(String(row.businessTitleId)) ?? null)
            : null,
          owner: String(row.owner),
          ownerName: ownerMap.get(String(row.owner)) ?? null,
          amount: row.amount === null ? null : Number(row.amount),
          invoiceType: String(row.invoiceType),
          taxRate: row.taxRate === null ? null : Number(row.taxRate),
          approvalStatus: String(row.approvalStatus),
          approved: row.approved,
          createTime: Number(row.createTime),
        })),
        total: aggregate.count,
        page: currentPage,
        pageSize: take,
      }
    }

    let query = this.prisma.client.orm.public.SalesOrder.where({
      organizationId: user.tenantId,
      customerId: id,
    })
    if (typeof ownerScope === 'string') {
      query = query.where({ owner: ownerScope })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      query = query.where((row) => row.owner.in(ownerIds))
    }
    const [rows, aggregate] = await Promise.all([
      query
        .orderBy((row) => row.createTime.desc())
        .offset(skip)
        .limit(take)
        .all(),
      query.aggregate((row) => ({ count: row.count() })),
    ])
    const orderContractIds = [
      ...new Set(rows.flatMap((row) => (row.contractId ? [String(row.contractId)] : []))),
    ]
    const orderContracts = orderContractIds.length
      ? await this.prisma.client.orm.public.Contract.where((row) => row.id.in(orderContractIds))
          .select('id', 'name')
          .all()
      : []
    const orderContractMap = new Map(
      orderContracts.map((contract) => [String(contract.id), String(contract.name)]),
    )
    const ownerMap = await this.userNames(
      rows.flatMap((row) => (row.owner ? [String(row.owner)] : [])),
    )
    return {
      items: rows.map((row) => ({
        id: String(row.id),
        number: String(row.number),
        name: String(row.name),
        contractId: row.contractId ? String(row.contractId) : null,
        contractName: row.contractId
          ? (orderContractMap.get(String(row.contractId)) ?? null)
          : null,
        amount: row.amount === null ? null : Number(row.amount),
        stage: String(row.stage),
        approvalStatus: String(row.approvalStatus),
        approved: row.approved,
        owner: row.owner ? String(row.owner) : null,
        ownerName: row.owner ? (ownerMap.get(String(row.owner)) ?? null) : null,
        createTime: Number(row.createTime),
      })),
      total: aggregate.count,
      page: currentPage,
      pageSize: take,
    }
  }

  async resourceStatistic(
    user: AuthUser,
    customerId: string,
    resource: 'contracts' | 'contractPaymentPlans' | 'contractPaymentRecords' | 'invoices',
  ) {
    await this.customerAccess.assertRead(user, customerId)
    this.assert360ResourcePermission(user, resource)
    const resourceScope = (await this.customer360ResourceScope(user, resource)) as CustomerListScope
    const contractScope =
      resource === 'invoices'
        ? ((await this.dataScope.directOwnerFilter(user, 'menu:contract')) as CustomerListScope)
        : resourceScope

    let contractQuery = this.prisma.client.orm.public.Contract.where({
      organizationId: user.tenantId,
      customerId: customerId,
    })
    const contractOwner = contractScope.owner
    if (typeof contractOwner === 'string') {
      contractQuery = contractQuery.where({ owner: contractOwner })
    } else if (contractOwner?.in) {
      const ownerIds = contractOwner.in
      contractQuery = contractQuery.where((row) => row.owner.in(ownerIds))
    }
    const contractAggregate = await contractQuery.aggregate((agg) => ({
      amount: agg.sum('amount'),
    }))
    const contractAmount = Number(contractAggregate.amount ?? 0)
    if (resource === 'contracts') return { totalAmount: contractAmount }

    const customerContracts = await this.prisma.client.orm.public.Contract.where({
      organizationId: user.tenantId,
      customerId: customerId,
    })
      .select('id')
      .all()
    const contractIds = customerContracts.map((row) => String(row.id))

    if (resource === 'contractPaymentPlans') {
      let query = this.prisma.client.orm.public.ContractPaymentPlan.where({
        organizationId: user.tenantId,
      })
      query = contractIds.length
        ? query.where((row) => row.contractId.in(contractIds))
        : query.where((row) => row.id.eq(''))
      const ownerScope = resourceScope.owner
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const result = await query.aggregate((agg) => ({ amount: agg.sum('planAmount') }))
      return { totalPlanAmount: Number(result.amount ?? 0) }
    }

    if (resource === 'contractPaymentRecords') {
      let query = this.prisma.client.orm.public.ContractPaymentRecord.where({
        organizationId: user.tenantId,
      })
      query = contractIds.length
        ? query.where((row) => row.contractId.in(contractIds))
        : query.where((row) => row.id.eq(''))
      const ownerScope = resourceScope.owner
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: ownerScope })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(ownerIds))
      }
      const result = await query.aggregate((agg) => ({ amount: agg.sum('recordAmount') }))
      const receivedAmount = Number(result.amount ?? 0)
      return {
        totalAmount: contractAmount,
        receivedAmount,
        pendingAmount: Math.max(0, contractAmount - receivedAmount),
      }
    }

    const invoiceApprovalAggregate = await this.prisma.client.orm.public.ApprovalFlows.where({
      tenantId: user.tenantId,
      formType: 'INVOICE',
      enabled: true,
    })
      .where((row) => row.deletedAt.isNull())
      .where((row) => row.currentVersionId.isNotNull())
      .aggregate((agg) => ({ count: agg.count() }))
    const invoiceApprovalEnabled = invoiceApprovalAggregate.count > 0

    let invoiceQuery = this.prisma.client.orm.public.ContractInvoice.where({
      organizationId: user.tenantId,
    })
    invoiceQuery = contractIds.length
      ? invoiceQuery.where((row) => row.contractId.in(contractIds))
      : invoiceQuery.where((row) => row.id.eq(''))
    const ownerScope = resourceScope.owner
    if (typeof ownerScope === 'string') {
      invoiceQuery = invoiceQuery.where({ owner: ownerScope })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      invoiceQuery = invoiceQuery.where((row) => row.owner.in(ownerIds))
    }
    if (invoiceApprovalEnabled) {
      invoiceQuery = invoiceQuery.where({ approvalStatus: 'APPROVED' })
    }
    const result = await invoiceQuery.aggregate((agg) => ({ amount: agg.sum('amount') }))
    const invoicedAmount = Number(result.amount ?? 0)
    return {
      contractAmount,
      invoicedAmount,
      uninvoicedAmount: Math.max(0, contractAmount - invoicedAmount),
    }
  }

  async create(user: AuthUser, dto: CreateCustomerDto): Promise<CustomerVO> {
    const prepared = await this.prepareCreateForTransaction(user, dto)
    const customer = await this.prisma.client.transaction((tx) =>
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
    tx: PrismaTransaction,
  ) {
    const now = BigInt(Date.now())
    const created = await tx.orm.public.Customer.create({
      id: createLegacyId32(),
      name: dto.name.trim(),
      owner: prepared.owner.id,
      collectionTime: now,
      poolId: null,
      createTime: now,
      updateTime: now,
      createUser: user.id,
      updateUser: user.id,
      inSharedPool: false,
      organizationId: user.tenantId,
      follower: null,
      followTime: null,
      reasonId: null,
    })
    await this.fieldValues.save(
      user.tenantId,
      'customer',
      created.id,
      prepared.values,
      'create',
      tx,
      user.id,
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
      templateContext: { name: customer.name },
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
    const customer = await this.prisma.client.transaction(async (tx) => {
      if (owner) {
        await this.customerPools.transferInTransaction(tx, {
          organizationId: user.tenantId,
          customerId: existing.id,
          ownerId: owner.id,
          operatorId: user.id,
          now,
        })
      }
      const updated = await tx.orm.public.Customer.where({
        id: existing.id,
      }).update({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        updateTime: now,
        updateUser: user.id,
      })
      if (!updated) throw new NotFoundException('客户不存在')
      await this.fieldValues.save(
        user.tenantId,
        'customer',
        existing.id,
        values,
        'update',
        tx,
        user.id,
      )
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
        templateContext: { name: customer.name },
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
      templateContext: { name: customer.name },
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
    const customer = await this.prisma.client.orm.public.Customer.where({
      id: id,
      organizationId: user.tenantId,
    })
      .select('name')
      .first()
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
          const customer = await this.prisma.client.orm.public.Customer.where({
            id: id,
            organizationId: user.tenantId,
            inSharedPool: true,
          })
            .select('poolId')
            .first()
          if (!customer || String(customer.poolId ?? '') !== poolId)
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
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', owner.id, changed.length)
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
      templateContext: { name: customer.name },
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
    const customers = await this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: true,
      poolId: poolId,
    })
      .where((row) => row.id.in([...new Set(ids)]))
      .all()
    for (const customer of customers) {
      await this.assignOwnerExisting(user, customer as unknown as Customer, ownerId)
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
      await this.prisma.client.transaction((tx) =>
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
    const rawCustomers = await this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: true,
      poolId: dto.poolId,
    })
      .where((row) => row.id.in(dto.ids))
      .all()
    const customers = rawCustomers as unknown as Customer[]
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
      await this.prisma.client.transaction((tx) =>
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
    const customers = (await this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: true,
      poolId: poolId,
    })
      .where((row) => row.id.in(ids))
      .all()) as unknown as Customer[]
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
    const aggregate = await this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: true,
      poolId: first.poolId,
    })
      .where((row) => row.id.in(uniqueIds))
      .aggregate((row) => ({ count: row.count() }))
    if (aggregate.count !== uniqueIds.length) {
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
    await this.ensureInScope(user, customerId, 'customer:read')
    const members = await this.prisma.client.orm.public.CustomerCollaboration.where({
      customerId: customerId,
    })
      .orderBy((row) => row.createTime.asc())
      .all()
    const userMap = await this.userNames(members.map((member) => String(member.userId)))
    return members.map((member) => ({
      id: String(member.id),
      userId: String(member.userId),
      userName: userMap.get(String(member.userId)) ?? '未知',
      role: null,
      collaborationType: String(member.collaborationType) as 'READ_ONLY' | 'COLLABORATION',
      createdAt: new Date(Number(member.createTime)).toISOString(),
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
    const member = await this.prisma.client.orm.public.Users.where({
      id: userId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id', 'name')
      .first()
    if (!member) throw new BadRequestException('协作成员不存在或已禁用')
    const exists = await this.prisma.client.orm.public.CustomerCollaboration.where({
      customerId: customerId,
      userId: userId,
    }).first()
    if (exists) throw new BadRequestException('该成员已在团队中')
    const now = BigInt(Date.now())
    await this.prisma.client.orm.public.CustomerCollaboration.create({
      id: createLegacyId32(),
      customerId: customerId,
      userId: userId,
      collaborationType: collaborationType,
      createTime: now,
      updateTime: now,
      createUser: user.id,
      updateUser: user.id,
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_COLLABORATION_ADD',
      operatorId: user.id,
      recipientIds: [customer.owner],
      excludeSelf: true,
      type: 'system',
      templateContext: {
        operator: user.name,
        uName: member.name,
        name: customer.name,
      },
      link: '/customers/' + customerId,
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
    const count = await this.prisma.client.orm.public.CustomerCollaboration.where({
      id: memberId,
      customerId: customerId,
    }).updateAndCount({
      collaborationType: collaborationType,
      updateUser: user.id,
      updateTime: BigInt(Date.now()),
    })
    if (count === 0) throw new NotFoundException('协作成员不存在')
    return { id: memberId, collaborationType }
  }

  async teamRemove(user: AuthUser, customerId: string, memberId: string) {
    await this.customerAccess.assertManageCustomer(user, customerId)
    await this.prisma.client.orm.public.CustomerCollaboration.where({
      id: memberId,
      customerId: customerId,
    }).deleteAll()
    return { id: memberId }
  }

  private async collaborationCustomerId(user: AuthUser, memberId: string) {
    const member = await this.prisma.client.orm.public.CustomerCollaboration.where({
      id: memberId,
    })
      .select('customerId')
      .first()
    if (!member) throw new NotFoundException('协作成员不存在')
    const customerId = String(member.customerId)
    const customer = await this.prisma.client.orm.public.Customer.where({
      id: customerId,
      organizationId: user.tenantId,
    })
      .select('id')
      .first()
    if (!customer) throw new NotFoundException('协作成员不存在')
    return customerId
  }

  async collaborationUpdate(
    user: AuthUser,
    memberId: string,
    collaborationType: 'READ_ONLY' | 'COLLABORATION',
  ) {
    const customerId = await this.collaborationCustomerId(user, memberId)
    return this.teamUpdate(user, customerId, memberId, collaborationType)
  }

  async collaborationRemove(user: AuthUser, memberId: string) {
    const customerId = await this.collaborationCustomerId(user, memberId)
    return this.teamRemove(user, customerId, memberId)
  }

  async collaborationBatchRemove(user: AuthUser, ids: string[]) {
    const uniqueIds = [...new Set(ids)]
    const members = uniqueIds.length
      ? await this.prisma.client.orm.public.CustomerCollaboration.where((row) =>
          row.id.in(uniqueIds),
        )
          .select('id', 'customerId')
          .all()
      : []
    if (members.length !== uniqueIds.length) throw new NotFoundException('协作成员不存在')
    const customerIds = [...new Set(members.map((member) => String(member.customerId)))]
    const tenantCustomers = customerIds.length
      ? await this.prisma.client.orm.public.Customer.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(customerIds))
          .select('id')
          .all()
      : []
    if (tenantCustomers.length !== customerIds.length) throw new NotFoundException('协作成员不存在')
    await Promise.all(customerIds.map((id) => this.customerAccess.assertManageCustomer(user, id)))
    if (uniqueIds.length) {
      await this.prisma.client.orm.public.CustomerCollaboration.where((row) =>
        row.id.in(uniqueIds),
      ).deleteAll()
    }
    return { count: members.length }
  }

  // ===== 客户集团 / 子公司关系 =====

  async relationList(user: AuthUser, customerId: string) {
    await this.customerAccess.assertRead(user, customerId)
    const rows = await this.prisma.client.orm.public.CustomerRelation.where((row) =>
      or(row.sourceCustomerId.eq(customerId), row.targetCustomerId.eq(customerId)),
    )
      .orderBy((row) => row.createTime.asc())
      .all()
    const relatedIds = rows.map((row) =>
      String(row.sourceCustomerId) === customerId
        ? String(row.targetCustomerId)
        : String(row.sourceCustomerId),
    )
    const customers = relatedIds.length
      ? await this.prisma.client.orm.public.Customer.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(relatedIds))
          .select('id', 'name')
          .all()
      : []
    const names = new Map(customers.map((item) => [String(item.id), String(item.name)]))
    return rows.map((row) => {
      const sourceId = String(row.sourceCustomerId)
      const targetId = String(row.targetCustomerId)
      const isGroup = targetId === customerId
      const relatedId = isGroup ? sourceId : targetId
      return {
        id: String(row.id),
        relationType: isGroup ? ('GROUP' as const) : ('SUBSIDIARY' as const),
        customerId: relatedId,
        customerName: names.get(relatedId) ?? null,
        createdAt: new Date(Number(row.createTime)).toISOString(),
      }
    })
  }

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

    const currentRows = await this.prisma.client.orm.public.CustomerRelation.where((row) =>
      or(row.sourceCustomerId.eq(customerId), row.targetCustomerId.eq(customerId)),
    )
      .select('id')
      .all()
    const excludeIds = currentRows.map((row) => String(row.id))
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

    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.CustomerRelation.where((row) =>
        or(row.sourceCustomerId.eq(customerId), row.targetCustomerId.eq(customerId)),
      ).deleteAll()
      for (const relation of relations) {
        await tx.orm.public.CustomerRelation.create({
          id: createLegacyId32(),
          sourceCustomerId: relation.sourceCustomerId,
          targetCustomerId: relation.targetCustomerId,
          createTime: relation.createTime,
        })
      }
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
    return this.prisma.client.orm.public.CustomerRelation.create({
      id: createLegacyId32(),
      sourceCustomerId: relation.sourceCustomerId,
      targetCustomerId: relation.targetCustomerId,
      createTime: relation.createTime,
    })
  }

  async relationUpdate(
    user: AuthUser,
    customerId: string,
    relationId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const existing = await this.prisma.client.orm.public.CustomerRelation.where({
      id: relationId,
    })
      .where((row) => or(row.sourceCustomerId.eq(customerId), row.targetCustomerId.eq(customerId)))
      .first()
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
    return this.prisma.client.orm.public.CustomerRelation.where({
      id: relationId,
    }).update({
      sourceCustomerId: relation.sourceCustomerId,
      targetCustomerId: relation.targetCustomerId,
    })
  }

  async relationRemove(user: AuthUser, customerId: string, relationId: string) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const relation = await this.prisma.client.orm.public.CustomerRelation.where({
      id: relationId,
    })
      .where((row) => or(row.sourceCustomerId.eq(customerId), row.targetCustomerId.eq(customerId)))
      .first()
    if (!relation) throw new NotFoundException('客户关系不存在')
    await this.prisma.client.orm.public.CustomerRelation.where({
      id: relationId,
    }).delete()
    return { id: relationId }
  }

  async relationRemoveById(user: AuthUser, relationId: string) {
    const relation = await this.prisma.client.orm.public.CustomerRelation.where({
      id: relationId,
    })
      .select('sourceCustomerId', 'targetCustomerId')
      .first()
    if (!relation) throw new NotFoundException('客户关系不存在')
    const sourceCustomerId = String(relation.sourceCustomerId)
    const targetCustomerId = String(relation.targetCustomerId)
    const sourceCustomer = await this.prisma.client.orm.public.Customer.where({
      id: sourceCustomerId,
      organizationId: user.tenantId,
    })
      .select('id')
      .first()
    if (!sourceCustomer) throw new NotFoundException('客户关系不存在')
    const sourceAccess = await this.customerAccess
      .assertRead(user, sourceCustomerId)
      .catch(() => null)
    const customerId = sourceAccess ? sourceCustomerId : targetCustomerId
    return this.relationRemove(user, customerId, relationId)
  }

  async mergePreview(user: AuthUser, dto: CustomerMergeDto) {
    const context = await this.prepareMergeContext(user, dto)
    const sourceIds = context.sourceIds
    const sourceVarchars = sourceIds
    const sourceOpportunities = await this.prisma.client.orm.public.Opportunity.where({
      organizationId: user.tenantId,
    })
      .where((row) => row.customerId.in(sourceVarchars))
      .select('id')
      .all()
    const opportunityIds = sourceOpportunities.map((row) => String(row.id))
    const [
      ownerMap,
      opportunityAggregate,
      quoteAggregate,
      contractAggregate,
      followUpAggregate,
      followUpPlanAggregate,
      attachmentAggregate,
      collaborationAggregate,
      relationAggregate,
    ] = await Promise.all([
      this.userNames([
        context.target.owner,
        ...context.sources.map((item) => item.owner),
        context.newOwner.id,
      ]),
      this.prisma.client.orm.public.Opportunity.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.customerId.in(sourceVarchars))
        .aggregate((row) => ({ count: row.count() })),
      opportunityIds.length
        ? this.prisma.client.orm.public.OpportunityQuotation.where({
            organizationId: user.tenantId,
          })
            .where((row) => row.opportunityId.in(opportunityIds))
            .aggregate((row) => ({ count: row.count() }))
        : Promise.resolve({ count: 0 }),
      this.prisma.client.orm.public.Contract.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.customerId.in(sourceVarchars))
        .aggregate((row) => ({ count: row.count() })),
      this.prisma.client.orm.public.FollowUpRecords.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(sourceIds))
        .aggregate((row) => ({ count: row.count() })),
      this.prisma.client.orm.public.FollowUpPlans.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(sourceIds))
        .aggregate((row) => ({ count: row.count() })),
      this.prisma.client.orm.public.Attachments.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(sourceIds))
        .aggregate((row) => ({ count: row.count() })),
      this.prisma.client.orm.public.CustomerCollaboration.where((row) =>
        row.customerId.in(sourceVarchars),
      ).aggregate((row) => ({ count: row.count() })),
      this.prisma.client.orm.public.CustomerRelation.where((row) =>
        or(row.sourceCustomerId.in(sourceVarchars), row.targetCustomerId.in(sourceVarchars)),
      ).aggregate((row) => ({ count: row.count() })),
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
        opportunities: opportunityAggregate.count,
        quotes: quoteAggregate.count,
        contracts: contractAggregate.count,
        followUps: followUpAggregate.count,
        followUpPlans: followUpPlanAggregate.count,
        attachments: attachmentAggregate.count,
        collaborations: collaborationAggregate.count,
        relationsToRemove: relationAggregate.count,
      },
      contactConflicts: context.contactConflicts,
    }
  }

  async merge(user: AuthUser, dto: CustomerMergeDto) {
    const context = await this.prepareMergeContext(user, dto)
    const { sourceIds, target, sources, newOwner, skipContactIds, contactConflicts } = context
    const sourceVarchars = sourceIds

    const sourceNames = sources.map((source) => source.name)
    const [sourceTeams, targetTeams] = await Promise.all([
      this.prisma.client.orm.public.CustomerCollaboration.where((row) =>
        row.customerId.in(sourceVarchars),
      ).all(),
      this.prisma.client.orm.public.CustomerCollaboration.where({
        customerId: dto.toMergeId,
      })
        .select('userId')
        .all(),
    ])
    const existingTeamUsers = new Set(targetTeams.map((item) => String(item.userId)))
    const collaboration = new Map<string, 'READ_ONLY' | 'COLLABORATION'>()
    for (const item of sourceTeams) {
      const type = String(item.collaborationType) === 'READ_ONLY' ? 'READ_ONLY' : 'COLLABORATION'
      const userId = String(item.userId)
      const previous = collaboration.get(userId)
      if (!previous || type === 'COLLABORATION') collaboration.set(userId, type)
    }
    for (const source of sources) {
      if (source.owner && !collaboration.has(source.owner)) {
        collaboration.set(source.owner, 'COLLABORATION')
      }
    }

    const now = BigInt(Date.now())
    const result = await this.prisma.client.transaction(async (tx) => {
      if (skipContactIds.length > 0) {
        for (const conflict of contactConflicts) {
          if (!skipContactIds.includes(conflict.sourceContactId)) continue
          const targetContactId = conflict.targetContactIds[0]
          if (targetContactId) {
            await tx.orm.public.Opportunity.where({
              organizationId: user.tenantId,
              contactId: conflict.sourceContactId,
            }).updateAndCount({ contactId: targetContactId })
            await tx.orm.public.FollowUpPlans.where({
              tenantId: user.tenantId,
              contactId: conflict.sourceContactId,
            }).updateAndCount({ contactId: targetContactId })
            await tx.orm.public.FollowUpRecords.where({
              tenantId: user.tenantId,
              contactId: conflict.sourceContactId,
            }).updateAndCount({ contactId: targetContactId })
            await tx.orm.public.Attachments.where({
              tenantId: user.tenantId,
              targetType: 'contact',
              targetId: conflict.sourceContactId,
            }).updateAndCount({ targetId: targetContactId })
          }
        }
        await tx.orm.public.CustomerContact.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(skipContactIds))
          .deleteAll()
      }

      await tx.orm.public.CustomerContact.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.customerId.in(sourceVarchars))
        .updateAndCount({
          customerId: dto.toMergeId,
          updateTime: now,
          updateUser: user.id,
        })
      await tx.orm.public.Opportunity.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.customerId.in(sourceVarchars))
        .updateAndCount({ customerId: dto.toMergeId })
      await tx.orm.public.Contract.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.customerId.in(sourceVarchars))
        .updateAndCount({ customerId: dto.toMergeId })
      await tx.orm.public.FollowUpRecords.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(sourceIds))
        .updateAndCount({ targetId: dto.toMergeId })
      await tx.orm.public.FollowUpPlans.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(sourceIds))
        .updateAndCount({ targetId: dto.toMergeId })
      await tx.orm.public.Attachments.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(sourceIds))
        .updateAndCount({ targetId: dto.toMergeId })

      await tx.orm.public.CustomerRelation.where((row) =>
        or(row.sourceCustomerId.in(sourceVarchars), row.targetCustomerId.in(sourceVarchars)),
      ).deleteAll()

      for (const [userId, collaborationType] of collaboration) {
        if (userId === newOwner.id || existingTeamUsers.has(userId)) continue
        await tx.orm.public.CustomerCollaboration.create({
          id: createLegacyId32(),
          customerId: dto.toMergeId,
          userId: userId,
          collaborationType: collaborationType,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        })
      }
      await tx.orm.public.CustomerCollaboration.where((row) =>
        row.customerId.in(sourceVarchars),
      ).deleteAll()

      if (target.owner && target.owner !== newOwner.id && target.collectionTime !== null) {
        await tx.orm.public.CustomerOwner.create({
          id: createLegacyId32(),
          customerId: target.id,
          owner: target.owner,
          operator: user.id,
          collectionTime: target.collectionTime,
          endTime: now,
          reasonId: null,
        })
      }
      if (target.owner && target.owner !== newOwner.id) {
        await tx.orm.public.CustomerContact.where({
          organizationId: user.tenantId,
          customerId: target.id,
          owner: target.owner,
        }).updateAndCount({
          owner: newOwner.id,
          updateTime: now,
          updateUser: user.id,
        })
      }
      const mergedTarget = await tx.orm.public.Customer.where({
        id: target.id,
        organizationId: user.tenantId,
      }).update({
        owner: newOwner.id,
        inSharedPool: false,
        poolId: null,
        collectionTime:
          target.owner === newOwner.id && !target.inSharedPool ? target.collectionTime : now,
        updateTime: now,
        updateUser: user.id,
      })
      if (!mergedTarget) throw new NotFoundException('主客户不存在')
      await tx.orm.public.Customer.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.id.in(sourceVarchars))
        .deleteAll()
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
        templateContext: { name: target.name },
        link: '/customers/' + target.id,
      })
    }
    await this.changeLog.record(user, {
      module: 'customer',
      action: 'merge',
      targetId: target.id,
      targetName: target.name,
      before: { ownerId: target.owner, merge: sourceNames },
      after: { ownerId: String(result.owner), merge: [target.name] },
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

    const [targetContactRows, sourceContactRows] = await Promise.all([
      this.prisma.client.orm.public.CustomerContact.where({
        organizationId: user.tenantId,
        customerId: target.id,
      })
        .select('id', 'customerId', 'name', 'phone')
        .all(),
      this.prisma.client.orm.public.CustomerContact.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.customerId.in(sourceIds))
        .select('id', 'customerId', 'name', 'phone')
        .all(),
    ])
    const targetContacts = targetContactRows.map((contact) => ({
      id: String(contact.id),
      customerId: contact.customerId ? String(contact.customerId) : null,
      name: String(contact.name),
      phone: contact.phone ? String(contact.phone) : null,
    }))
    const sourceContacts = sourceContactRows.map((contact) => ({
      id: String(contact.id),
      customerId: contact.customerId ? String(contact.customerId) : null,
      name: String(contact.name),
      phone: contact.phone ? String(contact.phone) : null,
    }))
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
    const users = await this.prisma.client.orm.public.Users.where((row) => row.id.in(unique))
      .select('id', 'name')
      .all()
    return new Map(users.map((user) => [user.id, user.name]))
  }

  private assert360ResourcePermission(user: AuthUser, resource: Customer360Resource) {
    const permission = this.customer360ResourcePermission(resource)
    if (!hasPermission(user.permissions, permission)) {
      throw new ForbiddenException('没有查看该客户关联数据的权限')
    }
  }

  private customer360ResourceScope(user: AuthUser, resource: Customer360Resource) {
    const permission = this.customer360ResourcePermission(resource)
    return resource === 'opportunities' ||
      resource === 'contracts' ||
      resource === 'contractPaymentPlans' ||
      resource === 'contractPaymentRecords' ||
      resource === 'invoices' ||
      resource === 'orders'
      ? this.dataScope.directOwnerFilter(user, permission)
      : this.dataScope.scopeFilter(user, permission)
  }

  private customer360ResourcePermission(resource: Customer360Resource) {
    return resource === 'opportunities'
      ? 'menu:opportunity'
      : resource === 'invoices'
        ? 'CONTRACT_INVOICE:READ'
        : resource === 'orders'
          ? 'ORDER:READ'
          : 'menu:contract'
  }

  private async buildCustomerRelation(
    user: AuthUser,
    customerId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    if (customerId === relatedCustomerId) {
      throw new BadRequestException('客户不能与自己建立集团关系')
    }
    const related = await this.prisma.client.orm.public.Customer.where({
      id: relatedCustomerId,
      organizationId: user.tenantId,
    })
      .select('id')
      .first()
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
    let edgeQuery = this.prisma.client.orm.public.CustomerRelation.where({
      sourceCustomerId: sourceCustomerId,
      targetCustomerId: targetCustomerId,
    })
    if (excludeIds.length) {
      edgeQuery = edgeQuery.where((row) => not(row.id.in(excludeIds)))
    }
    const existingEdge = await edgeQuery.select('id').first()
    if (existingEdge) throw new BadRequestException('同一个客户不能重复建立关系')

    let parentQuery = this.prisma.client.orm.public.CustomerRelation.where({
      targetCustomerId: targetCustomerId,
    })
    if (excludeIds.length) {
      parentQuery = parentQuery.where((row) => not(row.id.in(excludeIds)))
    }
    const existingParent = await parentQuery.select('sourceCustomerId').first()
    if (existingParent && String(existingParent.sourceCustomerId) !== sourceCustomerId) {
      const group = await this.prisma.client.orm.public.Customer.where({
        id: existingParent.sourceCustomerId,
        organizationId: tenantId,
      })
        .select('name')
        .first()
      throw new BadRequestException(
        '该子公司已属于集团「' + (group ? String(group.name) : '未知客户') + '」',
      )
    }

    let childQuery = this.prisma.client.orm.public.CustomerRelation.where({
      sourceCustomerId: sourceCustomerId,
    })
    if (excludeIds.length) {
      childQuery = childQuery.where((row) => not(row.id.in(excludeIds)))
    }
    const childAggregate = await childQuery.aggregate((row) => ({ count: row.count() }))
    if (childAggregate.count >= 10) throw new BadRequestException('一个客户最多设置 10 个子公司')

    let current: string | null = sourceCustomerId
    const visited = new Set<string>()
    while (current) {
      if (current === targetCustomerId) throw new BadRequestException('客户集团关系不能形成循环')
      if (visited.has(current)) break
      visited.add(current)
      const baseQuery: ReturnType<typeof this.prisma.client.orm.public.CustomerRelation.where> =
        this.prisma.client.orm.public.CustomerRelation.where({
          targetCustomerId: current,
        })
      const parent: { sourceCustomerId: unknown } | null = excludeIds.length
        ? await baseQuery
            .where((row) => not(row.id.in(excludeIds)))
            .select('sourceCustomerId')
            .first()
        : await baseQuery.select('sourceCustomerId').first()
      current = parent ? String(parent.sourceCustomerId) : null
    }
  }

  private async assertCustomerRelationGraphValid(
    tenantId: string,
    pending: { sourceCustomerId: string; targetCustomerId: string }[],
    excludeIds: string[],
  ) {
    const tenantCustomers = await this.prisma.client.orm.public.Customer.where({
      organizationId: tenantId,
    })
      .select('id')
      .all()
    const tenantIds = tenantCustomers.map((item) => String(item.id))
    let query = this.prisma.client.orm.public.CustomerRelation.where((row) =>
      row.sourceCustomerId.in(tenantIds),
    )
    if (excludeIds.length) {
      query = query.where((row) => not(row.id.in(excludeIds)))
    }
    const rows = await query.select('sourceCustomerId', 'targetCustomerId').all()
    const existing = rows.map((row) => ({
      sourceCustomerId: String(row.sourceCustomerId),
      targetCustomerId: String(row.targetCustomerId),
    }))
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
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    })
    query = phoneIds.length
      ? query.where((row) => or(row.name.ilike(name), row.id.in(phoneIds)))
      : query.where((row) => row.name.ilike(name))
    const row = await query.select('id', 'name').first()
    return row ? { id: String(row.id), name: String(row.name) } : null
  }

  private async assertCustomerUniqueRules(
    tenantId: string,
    values: { name?: string; phone?: string; email?: string },
    excludeId?: string,
  ) {
    const fields = await this.metadata.fieldsMap(tenantId, MODULE)
    if (!fields.get('name')?.config?.unique || !values.name?.trim()) return
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: tenantId,
    }).where((row) => row.name.ilike(values.name!.trim()))
    if (excludeId) {
      query = query.where((row) => row.id.neq(excludeId))
    }
    const duplicate = await query.select('id').first()
    if (duplicate) throw new BadRequestException('「客户名称」不能重复')
  }

  private async inScopeCustomerIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const [poolOptions, collaborationRows, scope] = await Promise.all([
      this.pools.options(user, 'customer'),
      this.prisma.client.orm.public.CustomerCollaboration.where({
        userId: user.id,
      })
        .where((row) => row.customerId.in(unique))
        .select('customerId')
        .all(),
      this.dataScope.directOwnerFilter(user, 'customer:read'),
    ])
    const poolIds = poolOptions.map((pool) => String(pool.id))
    const collaborationIds = collaborationRows.map((item) => String(item.customerId))
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
    }).where((row) => row.id.in(unique))
    const ownerScope = scope.owner
    query = query.where((row) => {
      const pooled = poolIds.length
        ? and(row.inSharedPool.eq(true), row.poolId.in(poolIds))
        : row.id.eq('')
      const direct =
        typeof ownerScope === 'string'
          ? row.owner.eq(ownerScope)
          : ownerScope?.in
            ? row.owner.in(ownerScope.in)
            : row.id.in(unique)
      const collaborative = collaborationIds.length ? row.id.in(collaborationIds) : row.id.eq('')
      return or(pooled, direct, collaborative)
    })
    const rows = await query.select('id').all()
    return new Set(rows.map((row) => String(row.id)))
  }

  private async inScopeLeadIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.directOwnerFilter(user, 'menu:lead')
    let query = this.prisma.client.orm.public.Clue.where({
      organizationId: user.tenantId,
    }).where((row) => row.id.in(unique))
    const ownerScope = scope.owner
    query = query.where((row) => {
      const direct =
        typeof ownerScope === 'string'
          ? row.owner.eq(ownerScope)
          : ownerScope?.in
            ? row.owner.in(ownerScope.in)
            : row.id.in(unique)
      return or(row.inSharedPool.eq(true), direct)
    })
    const rows = await query.select('id').all()
    return new Set(rows.map((row) => String(row.id)))
  }

  private async inScopeOpportunityIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.directOwnerFilter(user, 'menu:opportunity')
    let query = this.prisma.client.orm.public.Opportunity.where({
      organizationId: user.tenantId,
    }).where((row) => row.id.in(unique))
    const ownerScope = scope.owner
    if (typeof ownerScope === 'string') {
      query = query.where({ owner: ownerScope })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      query = query.where((row) => row.owner.in(ownerIds))
    }
    const rows = await query.select('id').all()
    return new Set(rows.map((row) => String(row.id)))
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
            const fingerprint = prepared.dto.name?.trim().toLowerCase() ?? ''
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
            const fingerprint = prepared.dto.name?.trim().toLowerCase() ?? ''
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
    return this.exportTasks.enqueue(user, {
      module: input.poolId ? 'customer_pool' : 'customer',
      fileName: input.fileName,
      payload: {
        version: 1,
        query,
        input: { headList: input.headList, ids: input.ids, poolId: input.poolId },
      },
    })
  }

  async buildQueuedExport(
    user: AuthUser,
    payload: QueuedExportTaskPayload,
  ): Promise<ExportBuildResult> {
    return this.buildExportXlsx(
      user,
      payload.query as QueryCustomersDto,
      payload.input as { headList: string[]; ids?: string[]; poolId?: string },
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: QueryCustomersDto,
    input: { headList: string[]; ids?: string[]; poolId?: string },
  ): Promise<ExportBuildResult> {
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
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
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
        // cf_* 仅表示当前租户表单里的动态字段 key，语义/类型都允许被重新配置。
        // 导入必须原样写入 customData，不能再把 cf_industry/cf_phone/cf_email 等
        // 硬解释为行业/电话/邮箱，否则字段改造后会污染查重与业务 DTO。
        customData[key] = value
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
      // Customer 本身只有 name 等系统字段；电话等业务字段属于动态 moduleFields。
      // 自定义字段唯一性由 ResourceFieldValueService 按字段配置校验，不能固定拿
      // 某个 cf_* key 当作电话号码参与客户重复判断。
      const duplicate = await this.findExactCustomerDuplicate(user, name)
      if (duplicate) throw new BadRequestException(`与已有客户「${duplicate.name}」重复`)
      if (!poolId)
        await this.pools.assertCapacityForOwner(user.tenantId, 'customer', dto.ownerId ?? user.id)
      else await this.pools.resolveTargetPool(user, 'customer', poolId)
      return { dto }
    }

    if (!resourceId) throw new BadRequestException('唯一ID不能为空')
    const existing = poolId
      ? await this.prisma.client.orm.public.Customer.where({
          id: resourceId,
          organizationId: user.tenantId,
          inSharedPool: true,
          poolId: poolId,
        }).first()
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
    const customer = await this.prisma.client.transaction(async (tx) => {
      const created = await tx.orm.public.Customer.create({
        id: createLegacyId32(),
        name: name,
        organizationId: user.tenantId,
        inSharedPool: true,
        poolId: pool.id,
        owner: null,
        collectionTime: null,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
        follower: null,
        followTime: null,
        reasonId: null,
      })
      await this.fieldValues.save(
        user.tenantId,
        'customer',
        created.id,
        values,
        'create',
        tx,
        user.id,
      )
      return created
    })
    return this.toSingleVO(user, customer)
  }

  private async resolveImportOwner(user: AuthUser, value: string): Promise<string> {
    const input = value.trim()
    if (!input) throw new BadRequestException('负责人不能为空')
    const direct = await this.prisma.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .where((row) => or(row.id.eq(input), row.email.ilike(input)))
      .select('id')
      .first()
    if (direct) return direct.id
    const byName = await this.prisma.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
      name: input,
    })
      .select('id')
      .limit(2)
      .all()
    if (byName.length === 0) throw new BadRequestException('负责人「' + input + '」不存在或已禁用')
    if (byName.length > 1)
      throw new BadRequestException('负责人名称「' + input + '」不唯一，请填写邮箱')
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
   * 报价通过商机关联客户；Contract 仍有旧直接外键，因此一起保护，避免把业务拒绝退化成数据库 FK 500。
   */
  private async assertCustomersDeletable(tenantId: string, ids: string[]) {
    const customerIds = ids
    const opportunityRows = await this.prisma.client.orm.public.Opportunity.where({
      organizationId: tenantId,
    })
      .where((row) => row.customerId.in(customerIds))
      .select('id')
      .all()
    const opportunityIds = opportunityRows.map((row) => String(row.id))
    const [contacts, opportunities, quotes, contracts] = await Promise.all([
      this.prisma.client.orm.public.CustomerContact.where({
        organizationId: tenantId,
      })
        .where((row) => row.customerId.in(customerIds))
        .aggregate((row) => ({ count: row.count() })),
      this.prisma.client.orm.public.Opportunity.where({
        organizationId: tenantId,
      })
        .where((row) => row.customerId.in(customerIds))
        .aggregate((row) => ({ count: row.count() })),
      opportunityIds.length
        ? this.prisma.client.orm.public.OpportunityQuotation.where({
            organizationId: tenantId,
          })
            .where((row) => row.opportunityId.in(opportunityIds))
            .aggregate((row) => ({ count: row.count() }))
        : Promise.resolve({ count: 0 }),
      this.prisma.client.orm.public.Contract.where({
        organizationId: tenantId,
      })
        .where((row) => row.customerId.in(customerIds))
        .aggregate((row) => ({ count: row.count() })),
    ])
    if (contacts.count + opportunities.count + quotes.count + contracts.count > 0) {
      throw new BadRequestException('客户已关联联系人、商机或交易数据，不能删除')
    }
  }

  private async deleteCustomerResources(
    user: AuthUser,
    customers: { id: string; name: string; owner: string | null }[],
  ) {
    const ids = customers.map((customer) => customer.id)
    const customerIds = ids
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.CustomerField.where((row) => row.resourceId.in(customerIds)).deleteAll()
      await tx.orm.public.CustomerFieldBlob.where((row) =>
        row.resourceId.in(customerIds),
      ).deleteAll()
      await tx.orm.public.FollowUpRecords.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(ids))
        .deleteAll()
      await tx.orm.public.FollowUpPlans.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(ids))
        .deleteAll()
      await tx.orm.public.CustomerOwner.where((row) => row.customerId.in(customerIds)).deleteAll()
      await tx.orm.public.CustomerRelation.where((row) =>
        or(row.sourceCustomerId.in(customerIds), row.targetCustomerId.in(customerIds)),
      ).deleteAll()
      await tx.orm.public.CustomerCollaboration.where((row) =>
        row.customerId.in(customerIds),
      ).deleteAll()
      await tx.orm.public.Attachments.where({
        tenantId: user.tenantId,
        targetType: 'customer',
      })
        .where((row) => row.targetId.in(ids))
        .deleteAll()
      await tx.orm.public.Customer.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.id.in(customerIds))
        .deleteAll()
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
        templateContext: { name: customer.name },
        link: '/customers',
      })
    }
  }

  private async resolveListScope(
    user: AuthUser,
    view?: 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION',
  ): Promise<CustomerListScope> {
    if (!view) return this.dataScope.directOwnerFilter(user, 'customer:read')
    if (view === 'SELF') return { owner: user.id }
    if (view === 'COLLABORATION') {
      const collaborations = await this.prisma.client.orm.public.CustomerCollaboration.where({
        userId: user.id,
      })
        .select('customerId')
        .all()
      const candidateIds = collaborations.map((item) => String(item.customerId))
      if (!candidateIds.length) return { ids: [] }
      const customers = await this.prisma.client.orm.public.Customer.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.id.in(candidateIds))
        .select('id')
        .all()
      return { ids: customers.map((item) => String(item.id)) }
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
      let users = this.prisma.client.orm.public.Users.where({ tenantId: user.tenantId })
      if (effective.deptIds.length) {
        users = users.where((row) => or(row.id.eq(user.id), row.deptId.in(effective.deptIds)))
      } else {
        users = users.where({ id: user.id })
      }
      const owners = await users.select('id').all()
      return { owner: { in: owners.map((item) => item.id) } }
    }
    return this.dataScope.directOwnerFilter(user, 'customer:read')
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const owner = await this.prisma.client.orm.public.Users.where({
      id: ownerId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id', 'deptId')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    let query = this.prisma.client.orm.public.Customer.where({
      id: id,
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    const ownerScope = scope.owner
    if (typeof ownerScope === 'string') {
      query = query.where({ owner: ownerScope })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      query = query.where((row) => row.owner.in(ownerIds))
    }
    const found = await query.first()
    if (!found) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return found as unknown as Customer
  }

  private customerFieldInput(dto: UpdateCustomerDto): Record<string, unknown> {
    // Cordys 的 CustomerAdd/Update 只持久化显式 moduleFields。
    // cf_* 是可被租户重新配置类型/语义的动态字段，不能把 legacy DTO 的
    // industry/phone/email/remark 隐式写入固定 key，否则字段被改造后会发生
    // 例如 phone -> “线索来源”select 的错误类型写入。
    return { ...(dto.customData ?? {}) }
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
        [field.id, field],
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
        const field = fieldMap.get(condition.key) ?? fieldMap.get(normalized.key)
        let query = this.prisma.client.orm.public.Customer.where({
          organizationId: organizationId,
        })
        if (field && field.type !== 'formula') {
          query = this.applyCustomerSystemFilter(query, normalized.key, normalized, field)
        }
        const rows = await query.select('id').all()
        return new Set(rows.map((row) => String(row.id)))
      }),
    )
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce((result, set) => new Set([...result].filter((id) => set.has(id))), sets[0]),
    ]
  }

  private applyCustomerSystemFilter(
    collection: ReturnType<typeof this.prisma.client.orm.public.Customer.where>,
    key: string,
    condition: FilterCondition,
    field: FieldVO,
  ) {
    const impossible = () => collection.where((row) => row.id.eq(''))
    const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
    const nullableKeys = new Set([
      'owner',
      'collectionTime',
      'poolId',
      'follower',
      'followTime',
      'reasonId',
    ])
    const nullable = nullableKeys.has(key)

    if (condition.op === 'isEmpty') {
      if (key === 'name') {
        return field.type === 'text' ? collection.where((row) => row.name.eq('')) : impossible()
      }
      if (!nullable) return impossible()
      if (key === 'owner') return collection.where((row) => row.owner.isNull())
      if (key === 'collectionTime') return collection.where((row) => row.collectionTime.isNull())
      if (key === 'poolId') return collection.where((row) => row.poolId.isNull())
      if (key === 'follower') return collection.where((row) => row.follower.isNull())
      if (key === 'followTime') return collection.where((row) => row.followTime.isNull())
      return collection.where((row) => row.reasonId.isNull())
    }

    if (condition.op === 'notEmpty') {
      if (key === 'name') {
        return field.type === 'text' ? collection.where((row) => row.name.neq('')) : collection
      }
      if (!nullable) return collection
      if (key === 'owner') return collection.where((row) => row.owner.isNotNull())
      if (key === 'collectionTime') return collection.where((row) => row.collectionTime.isNotNull())
      if (key === 'poolId') return collection.where((row) => row.poolId.isNotNull())
      if (key === 'follower') return collection.where((row) => row.follower.isNotNull())
      if (key === 'followTime') return collection.where((row) => row.followTime.isNotNull())
      return collection.where((row) => row.reasonId.isNotNull())
    }

    if (
      key === 'collectionTime' ||
      key === 'followTime' ||
      key === 'createTime' ||
      key === 'updateTime'
    ) {
      const values: bigint[] = []
      for (const raw of rawValues) {
        const direct = Number(raw)
        const millis =
          Number.isFinite(direct) && String(raw ?? '').trim() !== ''
            ? direct
            : new Date(String(raw)).getTime()
        if (!Number.isFinite(millis)) return impossible()
        values.push(BigInt(Math.trunc(millis)))
      }
      const value = values[0]!
      return collection.where((row) => {
        const target =
          key === 'collectionTime'
            ? row.collectionTime
            : key === 'followTime'
              ? row.followTime
              : key === 'createTime'
                ? row.createTime
                : row.updateTime
        if (condition.op === 'eq') return target.eq(value)
        if (condition.op === 'ne') return target.neq(value)
        if (condition.op === 'in') return target.in(values)
        if (condition.op === 'notIn') return not(target.in(values))
        if (condition.op === 'gt') return target.gt(value)
        if (condition.op === 'gte') return target.gte(value)
        if (condition.op === 'lt') return target.lt(value)
        if (condition.op === 'lte') return target.lte(value)
        return row.id.eq('')
      })
    }

    if (key === 'inSharedPool') {
      const values = rawValues.map((item) => item === true || String(item).toLowerCase() === 'true')
      const value = values[0] ?? false
      return collection.where((row) => {
        if (condition.op === 'eq') return row.inSharedPool.eq(value)
        if (condition.op === 'ne') return row.inSharedPool.neq(value)
        if (condition.op === 'in') return row.inSharedPool.in(values)
        if (condition.op === 'notIn') return not(row.inSharedPool.in(values))
        return row.id.eq('')
      })
    }

    if (key === 'name') {
      const values = rawValues.map((item) => String(item ?? ''))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.name.eq(value)
        if (condition.op === 'ne') return row.name.neq(value)
        if (condition.op === 'in') return row.name.in(values)
        if (condition.op === 'notIn') return not(row.name.in(values))
        if (condition.op === 'contains')
          return row.name.ilike('%' + String(condition.value ?? '') + '%')
        if (condition.op === 'notContains') {
          return not(row.name.ilike('%' + String(condition.value ?? '') + '%'))
        }
        return row.id.eq('')
      })
    }

    if (
      key === 'owner' ||
      key === 'poolId' ||
      key === 'createUser' ||
      key === 'updateUser' ||
      key === 'follower' ||
      key === 'reasonId'
    ) {
      const values = rawValues.map((item) => String(item ?? ''))
      const value = values[0]!
      return collection.where((row) => {
        const target =
          key === 'owner'
            ? row.owner
            : key === 'poolId'
              ? row.poolId
              : key === 'createUser'
                ? row.createUser
                : key === 'updateUser'
                  ? row.updateUser
                  : key === 'follower'
                    ? row.follower
                    : row.reasonId
        if (condition.op === 'eq') return target.eq(value)
        if (condition.op === 'ne') return target.neq(value)
        if (condition.op === 'in') return target.in(values)
        if (condition.op === 'notIn') return not(target.in(values))
        if (condition.op === 'contains') {
          return target.ilike('%' + String(condition.value ?? '') + '%')
        }
        if (condition.op === 'notContains') {
          return not(target.ilike('%' + String(condition.value ?? '') + '%'))
        }
        return row.id.eq('')
      })
    }

    return collection
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
