import { Injectable } from '@nestjs/common'
import {
  DEFAULT_LEAD_STAGES,
  type FieldVO,
  type HomeAnalyticsChannelItem,
  type HomeAnalyticsPerformanceItem,
  type HomeAnalyticsResultItem,
  type HomeAnalyticsVO,
  type HomeStatisticRequest,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { LeadPoolSlaService } from '../pool-rules/lead-pool-sla.service'
import { HomeDepartmentScopeService } from './home-department-scope.service'

function monthKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`
}

function monthsThroughCurrent(count: number): string[] {
  const now = new Date()
  const result: string[] = []
  for (let offset = -(count - 1); offset <= 0; offset++) {
    result.push(monthKey(new Date(now.getFullYear(), now.getMonth() + offset, 1)))
  }
  return result
}

@Injectable()
export class HomeAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly departments: HomeDepartmentScopeService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly leadSla: LeadPoolSlaService,
  ) {}

  async overview(user: AuthUser, request: HomeStatisticRequest): Promise<HomeAnalyticsVO> {
    const [leadConfig, customerConfig, leadScope, customerScope] = await Promise.all([
      this.moduleForms.getConfig(user.tenantId, 'lead'),
      this.moduleForms.getConfig(user.tenantId, 'customer'),
      this.departments.resolve(user, 'menu:lead', request.searchType, request.deptIds ?? []),
      this.departments.resolve(user, 'menu:customer', request.searchType, request.deptIds ?? []),
    ])

    const leadAnalytics = leadConfig.formProp.homeAnalytics ?? {}
    const legacyAnalytics = leadAnalytics
    // 只有 Customer 尚未建立自己的配置时才兼容旧版误存在 Lead 的 customerResult*。
    // 一旦 Customer formProp.homeAnalytics 存在（即使是空对象），就以 Customer 为唯一真相，
    // 避免管理员清空某个字段后又被旧 Lead 配置回填。
    const customerAnalytics = customerConfig.formProp.homeAnalytics ?? legacyAnalytics
    const sourceField =
      this.fieldByKey(leadConfig.fields, leadAnalytics.leadSourceFieldKey) ??
      this.fieldByKey(leadConfig.fields, 'cf_source')
    const resultField = this.fieldByKey(
      customerConfig.fields,
      customerAnalytics.customerResultFieldKey,
    )
    const resultTimeField = this.fieldByKey(
      customerConfig.fields,
      customerAnalytics.customerResultTimeFieldKey,
    )
    const resultAmountField = this.fieldByKey(
      customerConfig.fields,
      customerAnalytics.customerResultAmountFieldKey,
    )

    const [leads, customers, stageEvents] = await Promise.all([
      this.loadLeads(user, leadScope),
      this.loadCustomers(user, customerScope),
      this.loadStageEvents(user, leadScope),
    ])
    const [leadValues, customerValues] = await Promise.all([
      sourceField
        ? this.fieldValues.load(
            user.tenantId,
            'clue',
            leads.map((lead) => String(lead.id)),
          )
        : Promise.resolve(new Map<string, Record<string, unknown>>()),
      resultField || resultTimeField || resultAmountField
        ? this.fieldValues.load(
            user.tenantId,
            'customer',
            customers.map((customer) => String(customer.id)),
          )
        : Promise.resolve(new Map<string, Record<string, unknown>>()),
    ])

    const resultValues = [...new Set(customerAnalytics.customerResultValues ?? [])]
    const resultCustomerIds = new Set<string>()
    let resultAmount = resultAmountField ? 0 : null
    const resultDistribution = new Map<string, number>()
    for (const customer of customers) {
      const id = String(customer.id)
      const values = customerValues.get(id) ?? {}
      const resultValue = resultField ? values[resultField.key] : undefined
      const normalizedResult = this.scalarValue(resultValue)
      if (resultField && normalizedResult) {
        resultDistribution.set(
          normalizedResult,
          (resultDistribution.get(normalizedResult) ?? 0) + 1,
        )
      }
      if (!resultField || !this.matchesResult(resultValue, resultValues)) continue
      resultCustomerIds.add(id)
      if (resultAmountField && resultAmount !== null) {
        const amount = Number(values[resultAmountField.key])
        if (Number.isFinite(amount)) resultAmount += amount
      }
    }

    const convertedLeads = leads.filter(
      (lead) => lead.transitionType === 'CUSTOMER' && Boolean(lead.transitionId),
    )
    const ownerIds = leadScope.all ? null : (leadScope.userIds ?? [])
    const overdue = await this.leadSla.overdue(user.tenantId, ownerIds)
    const ownerNameMap = await this.ownerNames(
      user.tenantId,
      leads.flatMap((lead) => (lead.owner ? [String(lead.owner)] : [])),
    )
    const stages = (leadConfig.formProp.leadStages?.length
      ? leadConfig.formProp.leadStages
      : DEFAULT_LEAD_STAGES
    ).map((stage) => ({ ...stage, enabled: stage.enabled !== false }))

    return {
      config: {
        leadSourceField: this.fieldRef(sourceField),
        customerResultField: this.fieldRef(resultField),
        customerResultValues: resultValues,
        customerResultTimeField: this.fieldRef(resultTimeField),
        customerResultAmountField: this.fieldRef(resultAmountField),
      },
      summary: {
        totalLeads: leads.length,
        convertedLeads: convertedLeads.length,
        conversionRate:
          leads.length > 0 ? Math.round((convertedLeads.length / leads.length) * 1000) / 10 : 0,
        overdueLeads: overdue.length,
        resultCustomers: resultCustomerIds.size,
        resultAmount: resultAmount === null ? null : Math.round(resultAmount * 100) / 100,
      },
      funnel: this.funnel(stages, leads, stageEvents),
      trend: this.trend(leads, customers, customerValues, resultCustomerIds, resultTimeField),
      channels: this.channels(leads, leadValues, sourceField, resultCustomerIds),
      performance: this.performance(leads, ownerNameMap, resultCustomerIds),
      resultDistribution: this.resultDistributionItems(resultDistribution, resultField),
    }
  }

  private async loadLeads(
    user: AuthUser,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
  ) {
    if (!scope.all && (scope.userIds?.length ?? 0) === 0) return []
    let query = this.prisma.client.orm.public.Clue.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    if (!scope.all) query = query.where((row) => row.owner.in(scope.userIds ?? []))
    return query
      .select('id', 'owner', 'stage', 'transitionType', 'transitionId', 'createTime')
      .all()
  }

  private async loadCustomers(
    user: AuthUser,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
  ) {
    if (!scope.all && (scope.userIds?.length ?? 0) === 0) return []
    let query = this.prisma.client.orm.public.Customer.where({
      organizationId: user.tenantId,
      inSharedPool: false,
    })
    if (!scope.all) query = query.where((row) => row.owner.in(scope.userIds ?? []))
    return query.select('id', 'owner', 'createTime').all()
  }

  private async loadStageEvents(
    user: AuthUser,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
  ) {
    if (!scope.all && (scope.userIds?.length ?? 0) === 0) return []
    let query = this.prisma.client.orm.public.LeadStageEvent.where({
      organizationId: user.tenantId,
    })
    if (!scope.all) query = query.where((row) => row.ownerId.in(scope.userIds ?? []))
    return query.select('leadId', 'fromStageKey', 'toStageKey').all()
  }

  private funnel(
    stages: Array<{
      key: string
      name: string
      kind: 'ACTIVE' | 'SUCCESS' | 'FAILURE'
      enabled?: boolean
    }>,
    leads: Awaited<ReturnType<HomeAnalyticsService['loadLeads']>>,
    events: Awaited<ReturnType<HomeAnalyticsService['loadStageEvents']>>,
  ) {
    const reached = new Map<string, Set<string>>()
    const eventLeadIds = new Set<string>()
    const add = (stageKey: string | null, leadId: string) => {
      if (!stageKey) return
      const ids = reached.get(stageKey) ?? new Set<string>()
      ids.add(leadId)
      reached.set(stageKey, ids)
    }

    for (const event of events) {
      const leadId = String(event.leadId)
      eventLeadIds.add(leadId)
      add(event.fromStageKey, leadId)
      add(event.toStageKey, leadId)
    }
    for (const lead of leads) {
      const leadId = String(lead.id)
      if (!eventLeadIds.has(leadId)) add(lead.stage, leadId)
    }

    return stages.map((stage) => ({
      stageKey: stage.key,
      name: stage.name,
      kind: stage.kind,
      count: reached.get(stage.key)?.size ?? 0,
    }))
  }

  private channels(
    leads: Awaited<ReturnType<HomeAnalyticsService['loadLeads']>>,
    values: Map<string, Record<string, unknown>>,
    sourceField: FieldVO | null,
    resultCustomerIds: Set<string>,
  ): HomeAnalyticsChannelItem[] {
    if (!sourceField) return []
    const grouped = new Map<string, HomeAnalyticsChannelItem>()
    for (const lead of leads) {
      const value = this.scalarValue(values.get(String(lead.id))?.[sourceField.key]) || '__EMPTY__'
      const item = grouped.get(value) ?? {
        value,
        label: value === '__EMPTY__' ? '未填写' : this.optionLabel(sourceField, value),
        count: 0,
        convertedCount: 0,
        resultCount: 0,
      }
      item.count++
      if (lead.transitionType === 'CUSTOMER' && lead.transitionId) item.convertedCount++
      if (lead.transitionId && resultCustomerIds.has(String(lead.transitionId))) item.resultCount++
      grouped.set(value, item)
    }
    return [...grouped.values()].sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label),
    )
  }

  private performance(
    leads: Awaited<ReturnType<HomeAnalyticsService['loadLeads']>>,
    ownerNameMap: Map<string, string>,
    resultCustomerIds: Set<string>,
  ): HomeAnalyticsPerformanceItem[] {
    const grouped = new Map<string, HomeAnalyticsPerformanceItem>()
    for (const lead of leads) {
      const ownerId = lead.owner ? String(lead.owner) : '__UNASSIGNED__'
      const item = grouped.get(ownerId) ?? {
        ownerId,
        ownerName: ownerId === '__UNASSIGNED__' ? '未分配' : (ownerNameMap.get(ownerId) ?? '未知'),
        leadCount: 0,
        convertedCount: 0,
        resultCount: 0,
      }
      item.leadCount++
      if (lead.transitionType === 'CUSTOMER' && lead.transitionId) item.convertedCount++
      if (lead.transitionId && resultCustomerIds.has(String(lead.transitionId))) item.resultCount++
      grouped.set(ownerId, item)
    }
    return [...grouped.values()]
      .sort(
        (left, right) =>
          right.resultCount - left.resultCount ||
          right.convertedCount - left.convertedCount ||
          right.leadCount - left.leadCount ||
          left.ownerName.localeCompare(right.ownerName),
      )
      .slice(0, 20)
  }

  private trend(
    leads: Awaited<ReturnType<HomeAnalyticsService['loadLeads']>>,
    customers: Awaited<ReturnType<HomeAnalyticsService['loadCustomers']>>,
    customerValues: Map<string, Record<string, unknown>>,
    resultCustomerIds: Set<string>,
    resultTimeField: FieldVO | null,
  ) {
    const months = monthsThroughCurrent(6)
    const leadMap = new Map(months.map((month) => [month, 0]))
    for (const lead of leads) {
      const key = monthKey(new Date(Number(lead.createTime)))
      if (leadMap.has(key)) leadMap.set(key, (leadMap.get(key) ?? 0) + 1)
    }

    if (!resultTimeField) {
      return { months, leads: months.map((month) => leadMap.get(month) ?? 0), results: null }
    }
    const resultMap = new Map(months.map((month) => [month, 0]))
    for (const customer of customers) {
      const id = String(customer.id)
      if (!resultCustomerIds.has(id)) continue
      const value = customerValues.get(id)?.[resultTimeField.key]
      const key = this.dateMonth(value)
      if (key && resultMap.has(key)) resultMap.set(key, (resultMap.get(key) ?? 0) + 1)
    }
    return {
      months,
      leads: months.map((month) => leadMap.get(month) ?? 0),
      results: months.map((month) => resultMap.get(month) ?? 0),
    }
  }

  private resultDistributionItems(
    grouped: Map<string, number>,
    field: FieldVO | null,
  ): HomeAnalyticsResultItem[] {
    if (!field) return []
    return [...grouped.entries()]
      .map(([value, count]) => ({ value, label: this.optionLabel(field, value), count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
  }

  private async ownerNames(tenantId: string, ownerIds: string[]) {
    const ids = [...new Set(ownerIds)]
    if (!ids.length) return new Map<string, string>()
    const users = await this.prisma.client.orm.public.Users.where({ tenantId })
      .where((row) => row.id.in(ids))
      .select('id', 'name')
      .all()
    return new Map(users.map((user) => [String(user.id), user.name]))
  }

  private fieldByKey(fields: FieldVO[], key: string | undefined): FieldVO | null {
    if (!key) return null
    return fields.find((field) => field.key === key) ?? null
  }

  private fieldRef(field: FieldVO | null) {
    return field ? { key: field.key, label: field.label } : null
  }

  private matchesResult(value: unknown, configuredValues: string[]) {
    const normalized = this.scalarValue(value)
    if (!normalized) return false
    return configuredValues.length === 0 || configuredValues.includes(normalized)
  }

  private scalarValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return ''
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return ''
  }

  private dateMonth(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const match = /^(\d{4})-(\d{2})/.exec(value.trim())
    return match ? `${match[1]}-${match[2]}` : null
  }

  private optionLabel(field: FieldVO, value: string): string {
    if (field.type === 'switch') return value === 'true' ? '是' : value === 'false' ? '否' : value
    return field.options?.find((option) => option.value === value)?.label ?? value
  }
}
