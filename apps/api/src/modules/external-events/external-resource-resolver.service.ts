import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { filterOpsForType, hasPermission, type FilterCondition } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { PrismaService } from '../../prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'

export type ExternalResolvedResource =
  | { kind: 'CUSTOMER'; customerId: string; sourceLeadId?: string }
  | { kind: 'LEAD'; leadId: string; ownerId: string }

type TargetResource = 'customer' | 'lead'

interface PreparedWhere {
  supported: boolean
  conditions: FilterCondition[]
  system: Array<{ key: string; value: unknown }>
  issues: string[]
}

const CUSTOMER_SYSTEM_FIELDS = new Set(['id', 'name', 'owner'])
const LEAD_SYSTEM_FIELDS = new Set(['id', 'name', 'contact', 'phone', 'owner'])

/**
 * External Event 专用严格定位器。
 *
 * 与页面高级筛选不同：未知字段、不可 eq 字段、无权限数据都采用 fail-closed 语义，
 * 不允许错误条件退化成“不筛选”。这里只负责定位，不执行转换或字段更新。
 */
@Injectable()
export class ExternalResourceResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly pools: ResourcePoolsService,
  ) {}

  async resolve(
    user: AuthUser,
    where: Record<string, unknown>,
    allowPooledConversion = false,
  ): Promise<ExternalResolvedResource> {
    const entries = this.validateWhere(where)
    const [customerWhere, leadWhere] = await Promise.all([
      this.prepareWhere(user.tenantId, 'customer', entries),
      this.prepareWhere(user.tenantId, 'lead', entries),
    ])

    if (!customerWhere.supported && !leadWhere.supported) {
      throw new BadRequestException({
        code: 'INVALID_QUERY_FIELD',
        message: 'where 字段无法在 Customer 或 Lead 上形成完整精确查询',
        details: { customer: customerWhere.issues, lead: leadWhere.issues },
      })
    }

    if (customerWhere.supported) {
      const customerIds = await this.findCustomerIds(user, customerWhere)
      if (customerIds.length > 1) this.nonUnique('CUSTOMER')
      if (customerIds.length === 1) return { kind: 'CUSTOMER', customerId: customerIds[0]! }
    }

    if (leadWhere.supported) {
      const leads = await this.findLeads(user, leadWhere, allowPooledConversion)
      if (leads.length > 1) this.nonUnique('LEAD')
      const lead = leads[0]
      if (lead) {
        if (lead.transitionId) {
          if (lead.transitionType !== 'CUSTOMER') {
            throw new ConflictException({
              code: 'UNSUPPORTED_TRANSITION',
              message: '线索已转换为非 Customer 资源，不能由外部财务事件再次转换',
            })
          }
          const customerIds = await this.findCustomerIdsById(user, String(lead.transitionId))
          if (customerIds.length !== 1) this.notFound()
          return {
            kind: 'CUSTOMER',
            customerId: customerIds[0]!,
            sourceLeadId: String(lead.id),
          }
        }
        if (!lead.owner && !lead.inSharedPool) {
          throw new ConflictException({
            code: 'LEAD_OWNER_REQUIRED',
            message: '线索尚无负责人，不能自动转换为客户',
          })
        }
        return { kind: 'LEAD', leadId: String(lead.id), ownerId: String(lead.owner ?? '') }
      }
    }

    this.notFound()
  }

  /**
   * Cross-module identity lookup for payment and enrollment workflows.
   * The two modules may use different CRM field keys for the same external identity
   * (for example Customer.cf_phone and Lead.phone). Both modules are checked so an
   * independent customer + lead collision fails closed instead of choosing arbitrarily.
   * Returns null only when both lookups are valid and no record exists.
   */
  async resolvePaymentTargetOptional(
    user: AuthUser,
    customerWhere: Record<string, unknown>,
    leadWhere: Record<string, unknown>,
  ): Promise<ExternalResolvedResource | null> {
    const [customerPrepared, leadPrepared] = await Promise.all([
      this.prepareWhere(user.tenantId, 'customer', this.validateWhere(customerWhere)),
      this.prepareWhere(user.tenantId, 'lead', this.validateWhere(leadWhere)),
    ])
    if (!customerPrepared.supported || !leadPrepared.supported) {
      throw new BadRequestException({
        code: 'INVALID_QUERY_FIELD',
        message: '姓名和手机号必须映射到有效的客户、线索精确匹配字段',
        details: {
          customer: customerPrepared.issues,
          lead: leadPrepared.issues,
        },
      })
    }

    const [customerPools, leadPools, customerScope, leadScope] = await Promise.all([
      this.pools.list(user, 'customer'),
      this.pools.list(user, 'lead'),
      this.dataScope.directOwnerFilter(user, 'customer:update'),
      this.dataScope.directOwnerFilter(user, 'lead:update'),
    ])
    if (customerScope.owner !== undefined || leadScope.owner !== undefined) {
      throw new ForbiddenException(
        '缴费成功同步需要具有客户和线索全局数据范围的 API Key 账号，避免遗漏匹配记录',
      )
    }
    if (
      customerPools.length > 0 &&
      !hasPermission(user.permissions, 'customerPool:assign')
    ) {
      throw new ForbiddenException('缴费成功同步需要客户公海查询权限，避免遗漏公海客户')
    }
    if (
      leadPools.length > 0 &&
      !hasPermission(user.permissions, 'leadPool:assign')
    ) {
      throw new ForbiddenException('缴费成功同步需要线索池查询权限，避免遗漏公海线索')
    }

    const [customerIds, leads] = await Promise.all([
      this.findCustomerIds(user, customerPrepared, true),
      this.findLeads(user, leadPrepared, true),
    ])
    if (customerIds.length > 1) this.nonUnique('CUSTOMER')
    if (leads.length > 1) this.nonUnique('LEAD')
    const lead = leads[0]

    if (customerIds.length === 1) {
      const customerId = customerIds[0]!
      if (lead) {
        // A converted lead and its linked customer are one logical record, not a duplicate.
        if (lead.transitionType === 'CUSTOMER' && String(lead.transitionId ?? '') === customerId) {
          return { kind: 'CUSTOMER', customerId, sourceLeadId: String(lead.id) }
        }
        throw new ConflictException({
          code: 'CROSS_MODULE_IDENTITY_CONFLICT',
          message: '同一姓名和手机号同时匹配到独立客户与线索，存在重复数据；缴费事件未执行，请先处理重复记录',
        })
      }
      return { kind: 'CUSTOMER', customerId }
    }

    if (!lead) return null

    if (lead.transitionId) {
      if (lead.transitionType !== 'CUSTOMER') {
        throw new ConflictException({
          code: 'UNSUPPORTED_TRANSITION',
          message: '线索已转换为非 Customer 资源，不能由缴费事件自动转化',
        })
      }
      const customerIds = await this.findCustomerIdsById(user, String(lead.transitionId), true)
      if (customerIds.length !== 1) this.notFound()
      return {
        kind: 'CUSTOMER',
        customerId: customerIds[0]!,
        sourceLeadId: String(lead.id),
      }
    }

    return { kind: 'LEAD', leadId: String(lead.id), ownerId: String(lead.owner ?? '') }
  }

  /** Strict single-module lookup for v2 flows; never falls back to the other module. */
  async resolveTarget(
    user: AuthUser,
    target: TargetResource,
    where: Record<string, unknown>,
    followConversion = false,
    allowPooledConversion = false,
  ): Promise<ExternalResolvedResource> {
    const prepared = await this.prepareWhere(user.tenantId, target, this.validateWhere(where))
    if (!prepared.supported) {
      throw new BadRequestException({
        code: 'INVALID_QUERY_FIELD',
        message: '目标模块的定位字段无效',
        details: prepared.issues,
      })
    }
    if (target === 'customer') {
      const ids = await this.findCustomerIds(user, prepared)
      if (ids.length > 1) this.nonUnique('CUSTOMER')
      if (!ids.length) this.notFound()
      return { kind: 'CUSTOMER', customerId: ids[0]! }
    }
    const leads = await this.findLeads(user, prepared, allowPooledConversion)
    if (leads.length > 1) this.nonUnique('LEAD')
    const lead = leads[0]
    if (!lead) this.notFound()
    if (lead.transitionId) {
      if (followConversion && lead.transitionType === 'CUSTOMER') {
        const customerIds = await this.findCustomerIdsById(user, String(lead.transitionId))
        if (customerIds.length !== 1) this.notFound()
        return { kind: 'CUSTOMER', customerId: customerIds[0]!, sourceLeadId: String(lead.id) }
      }
      throw new ConflictException({
        code: 'LEAD_ALREADY_TRANSITIONED',
        message: '目标线索已转化，不允许按原线索执行动作',
      })
    }
    return { kind: 'LEAD', leadId: String(lead.id), ownerId: String(lead.owner ?? '') }
  }

  private validateWhere(where: Record<string, unknown>) {
    if (!where || typeof where !== 'object' || Array.isArray(where)) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: 'where 必须是字段对象' })
    }
    const entries = Object.entries(where)
    if (entries.length === 0) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: 'where 至少需要一个字段' })
    }
    if (entries.length > 20) {
      throw new BadRequestException({ code: 'INVALID_QUERY', message: 'where 最多支持 20 个字段' })
    }
    for (const [key, value] of entries) {
      if (!key.trim()) {
        throw new BadRequestException({
          code: 'INVALID_QUERY_FIELD',
          message: 'where 字段不能为空',
        })
      }
      if (
        value === null ||
        value === undefined ||
        Array.isArray(value) ||
        typeof value === 'object'
      ) {
        throw new BadRequestException({
          code: 'INVALID_QUERY_VALUE',
          message: `where.${key} 只支持非空标量精确值`,
        })
      }
      if (typeof value === 'string' && !value.trim()) {
        throw new BadRequestException({
          code: 'INVALID_QUERY_VALUE',
          message: `where.${key} 不能为空字符串`,
        })
      }
    }
    return entries
  }

  private async prepareWhere(
    organizationId: string,
    target: TargetResource,
    entries: Array<[string, unknown]>,
  ): Promise<PreparedWhere> {
    const fields = await this.metadata.listFields(organizationId, target)
    const fieldMap = new Map(
      fields.flatMap((field) => [[field.key, field] as const, [field.id, field] as const]),
    )
    const conditions: FilterCondition[] = []
    const system: Array<{ key: string; value: unknown }> = []
    const issues: string[] = []

    for (const [identity, value] of entries) {
      if (identity === 'id') {
        if (typeof value !== 'string') issues.push('id 必须是字符串')
        else system.push({ key: 'id', value })
        continue
      }
      const field = fieldMap.get(identity)
      if (!field) {
        issues.push(`字段不存在：${identity}`)
        continue
      }
      if (!filterOpsForType(field.type).includes('eq')) {
        issues.push(`字段不支持精确匹配：${field.label}`)
        continue
      }
      if (field.system) {
        const allowed = target === 'customer' ? CUSTOMER_SYSTEM_FIELDS : LEAD_SYSTEM_FIELDS
        if (!allowed.has(field.key)) {
          issues.push(`系统字段不允许用于外部定位：${field.label}`)
          continue
        }
        system.push({ key: field.key, value })
      } else {
        conditions.push({ key: field.key, op: 'eq', value })
      }
    }

    return { supported: issues.length === 0, conditions, system, issues }
  }

  private async findCustomerIds(
    user: AuthUser,
    prepared: PreparedWhere,
    includeVisiblePools = false,
  ): Promise<string[]> {
    await this.assertPermission(user, 'customer:update')
    const customIds = prepared.conditions.length
      ? await this.fieldValues.filterResourceIds(user.tenantId, 'customer', prepared.conditions)
      : null
    if (customIds && customIds.length === 0) return []
    return this.queryCustomerIds(user, prepared.system, customIds, includeVisiblePools)
  }

  private async findCustomerIdsById(
    user: AuthUser,
    id: string,
    includeVisiblePools = false,
  ): Promise<string[]> {
    await this.assertPermission(user, 'customer:update')
    return this.queryCustomerIds(user, [{ key: 'id', value: id }], null, includeVisiblePools)
  }

  private async queryCustomerIds(
    user: AuthUser,
    system: Array<{ key: string; value: unknown }>,
    customIds: string[] | null,
    includeVisiblePools = false,
  ): Promise<string[]> {
    const ownerScope = await this.dataScope.directOwnerFilter(user, 'customer:update')
    const applyConditions = (query: ReturnType<typeof this.prisma.client.orm.public.Customer.where>) => {
      if (customIds) query = query.where((row) => row.id.in(customIds))
      for (const condition of system) query = this.applyCustomerSystemCondition(query, condition)
      return query
    }
    let ordinary = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    if (typeof ownerScope.owner === 'string') ordinary = ordinary.where({ owner: ownerScope.owner })
    else if (ownerScope.owner?.in) {
      const ownerIds = ownerScope.owner.in
      ordinary = ordinary.where((row) => row.owner.in(ownerIds))
    }
    const rows = await applyConditions(ordinary).select('id').all()
    const ids = rows.map((row) => String(row.id))

    if (includeVisiblePools && hasPermission(user.permissions, 'customerPool:assign')) {
      const poolIds = (await this.pools.list(user, 'customer')).map((pool) => pool.id)
      if (poolIds.length) {
        const pooled = await applyConditions(
          this.prisma.client.orm.public.Customer.where({
            organizationId: user.tenantId,
            inSharedPool: true,
          }).where((row) => row.poolId.in(poolIds)),
        )
          .select('id')
          .all()
        ids.push(...pooled.map((row) => String(row.id)))
      }
    }
    return [...new Set(ids)]
  }

  private async findLeads(user: AuthUser, prepared: PreparedWhere, allowPooledConversion = false) {
    await this.assertPermission(user, 'lead:update')
    const customIds = prepared.conditions.length
      ? await this.fieldValues.filterResourceIds(user.tenantId, 'clue', prepared.conditions)
      : null
    if (customIds && customIds.length === 0) return []
    const ownerScope = await this.dataScope.directOwnerFilter(user, 'lead:update')
    const base = (pooled: boolean) => {
      let query = this.prisma.client.orm.public.Clue.where({
        organizationId: user.tenantId,
        inSharedPool: pooled,
      })
      if (!pooled) {
        if (typeof ownerScope.owner === 'string') query = query.where({ owner: ownerScope.owner })
        else if (ownerScope.owner?.in) {
          const ownerIds = ownerScope.owner.in
          query = query.where((row) => row.owner.in(ownerIds))
        }
      }
      if (customIds) query = query.where((row) => row.id.in(customIds))
      for (const condition of prepared.system)
        query = this.applyLeadSystemCondition(query, condition)
      return query
    }
    const ordinary = await base(false)
      .select('id', 'owner', 'transitionType', 'transitionId', 'inSharedPool')
      .all()
    // Pool lookup is only enabled by a conversion event and requires explicit pool permissions.
    if (!allowPooledConversion || !hasPermission(user.permissions, 'leadPool:assign'))
      return ordinary
    const poolIds = (await this.pools.list(user, 'lead')).map((pool) => pool.id)
    if (!poolIds.length) return ordinary
    const pooled = await base(true)
      .where((row) => row.poolId.in(poolIds))
      .select('id', 'owner', 'transitionType', 'transitionId', 'inSharedPool')
      .all()
    return [...ordinary, ...pooled]
  }

  private applyCustomerSystemCondition(
    query: ReturnType<typeof this.prisma.client.orm.public.Customer.where>,
    condition: { key: string; value: unknown },
  ) {
    const value = this.stringSystemValue(condition)
    switch (condition.key) {
      case 'id':
        return query.where({ id: value })
      case 'name':
        return query.where({ name: value })
      case 'owner':
        return query.where({ owner: value })
      default:
        throw new BadRequestException({
          code: 'INVALID_QUERY_FIELD',
          message: '不支持的 Customer 系统字段',
        })
    }
  }

  private applyLeadSystemCondition(
    query: ReturnType<typeof this.prisma.client.orm.public.Clue.where>,
    condition: { key: string; value: unknown },
  ) {
    const value = this.stringSystemValue(condition)
    switch (condition.key) {
      case 'id':
        return query.where({ id: value })
      case 'name':
        return query.where({ name: value })
      case 'phone':
        return query.where({ phone: value })
      case 'owner':
        return query.where({ owner: value })
      default:
        throw new BadRequestException({
          code: 'INVALID_QUERY_FIELD',
          message: '不支持的 Lead 系统字段',
        })
    }
  }

  private stringSystemValue(condition: { key: string; value: unknown }) {
    if (typeof condition.value !== 'string') {
      throw new BadRequestException({
        code: 'INVALID_QUERY_VALUE',
        message: `系统字段 ${condition.key} 必须使用字符串精确值`,
      })
    }
    return condition.value
  }

  private async assertPermission(user: AuthUser, permission: string) {
    const scope = await this.dataScope.resolveScope(user, permission)
    if (!scope.hasPermission) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: `缺少权限：${permission}`,
      })
    }
  }

  private nonUnique(type: 'CUSTOMER' | 'LEAD'): never {
    throw new ConflictException({
      code: 'NON_UNIQUE_MATCH',
      message: `${type} 查询命中多条，请增加更多定位字段`,
    })
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'NOT_FOUND',
      message: '当前 API Key 可见范围内未找到唯一业务数据',
    })
  }
}
