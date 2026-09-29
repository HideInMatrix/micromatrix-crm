import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { filterOpsForType, type FilterCondition } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { PrismaService } from '../../prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'

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
const LEAD_SYSTEM_FIELDS = new Set(['id', 'name', 'contact', 'phone', 'owner', 'stage'])

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
  ) {}

  async resolve(
    user: AuthUser,
    where: Record<string, unknown>,
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
      const leads = await this.findLeads(user, leadWhere)
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
        if (!lead.owner) {
          throw new ConflictException({
            code: 'LEAD_OWNER_REQUIRED',
            message: '线索尚无负责人，不能自动转换为客户',
          })
        }
        return { kind: 'LEAD', leadId: String(lead.id), ownerId: String(lead.owner) }
      }
    }

    this.notFound()
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
        throw new BadRequestException({ code: 'INVALID_QUERY_FIELD', message: 'where 字段不能为空' })
      }
      if (value === null || value === undefined || Array.isArray(value) || typeof value === 'object') {
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
      fields.flatMap((field) => [
        [field.key, field] as const,
        [field.id, field] as const,
      ]),
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

  private async findCustomerIds(user: AuthUser, prepared: PreparedWhere): Promise<string[]> {
    await this.assertPermission(user, 'customer:update')
    const customIds = prepared.conditions.length
      ? await this.fieldValues.filterResourceIds(user.tenantId, 'customer', prepared.conditions)
      : null
    if (customIds && customIds.length === 0) return []
    return this.queryCustomerIds(user, prepared.system, customIds)
  }

  private async findCustomerIdsById(user: AuthUser, id: string): Promise<string[]> {
    await this.assertPermission(user, 'customer:update')
    return this.queryCustomerIds(user, [{ key: 'id', value: id }], null)
  }

  private async queryCustomerIds(
    user: AuthUser,
    system: Array<{ key: string; value: unknown }>,
    customIds: string[] | null,
  ): Promise<string[]> {
    const ownerScope = await this.dataScope.directOwnerFilter(user, 'customer:update')
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    if (typeof ownerScope.owner === 'string') query = query.where({ owner: ownerScope.owner })
    else if (ownerScope.owner?.in) {
      const ownerIds = ownerScope.owner.in
      query = query.where((row) => row.owner.in(ownerIds))
    }
    if (customIds) query = query.where((row) => row.id.in(customIds))
    for (const condition of system) query = this.applyCustomerSystemCondition(query, condition)
    const rows = await query.select('id').all()
    return rows.map((row) => String(row.id))
  }

  private async findLeads(user: AuthUser, prepared: PreparedWhere) {
    await this.assertPermission(user, 'lead:update')
    const customIds = prepared.conditions.length
      ? await this.fieldValues.filterResourceIds(user.tenantId, 'clue', prepared.conditions)
      : null
    if (customIds && customIds.length === 0) return []
    const ownerScope = await this.dataScope.directOwnerFilter(user, 'lead:update')
    let query = this.prisma.client.orm.public.Clue.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    if (typeof ownerScope.owner === 'string') query = query.where({ owner: ownerScope.owner })
    else if (ownerScope.owner?.in) {
      const ownerIds = ownerScope.owner.in
      query = query.where((row) => row.owner.in(ownerIds))
    }
    if (customIds) query = query.where((row) => row.id.in(customIds))
    for (const condition of prepared.system) query = this.applyLeadSystemCondition(query, condition)
    return query.select('id', 'owner', 'transitionType', 'transitionId').all()
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
        throw new BadRequestException({ code: 'INVALID_QUERY_FIELD', message: '不支持的 Customer 系统字段' })
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
      case 'contact':
        return query.where({ contact: value })
      case 'phone':
        return query.where({ phone: value })
      case 'owner':
        return query.where({ owner: value })
      case 'stage':
        return query.where({ stage: value })
      default:
        throw new BadRequestException({ code: 'INVALID_QUERY_FIELD', message: '不支持的 Lead 系统字段' })
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
      throw new ForbiddenException({ code: 'PERMISSION_DENIED', message: `缺少权限：${permission}` })
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
