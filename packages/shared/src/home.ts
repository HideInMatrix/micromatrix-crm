import type { FilterCondition } from './metadata'

export const HOME_SEARCH_TYPES = ['ALL', 'SELF', 'DEPARTMENT'] as const
export type HomeSearchType = (typeof HOME_SEARCH_TYPES)[number]

export const HOME_STATISTIC_PERIODS = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'THIS_YEAR'] as const
export type HomeStatisticPeriod = (typeof HOME_STATISTIC_PERIODS)[number]

export const HOME_TIME_FIELDS = ['CREATE_TIME', 'EXPECTED_END_TIME', 'ACTUAL_END_TIME'] as const
export type HomeTimeField = (typeof HOME_TIME_FIELDS)[number]

export const HOME_USER_FIELDS = ['CREATE_USER', 'OWNER'] as const
export type HomeUserField = (typeof HOME_USER_FIELDS)[number]

export interface HomeStatisticRequest {
  searchType: HomeSearchType
  deptIds: string[]
  timeField?: HomeTimeField
  userField?: HomeUserField
  winOrderTimeField?: Extract<HomeTimeField, 'EXPECTED_END_TIME' | 'ACTUAL_END_TIME'>
  priorPeriodEnable?: boolean
}

export interface HomeStatisticValue {
  value: number
  priorPeriodCompareRate: number | null
}

export interface HomeLeadStatistic {
  todayClue: HomeStatisticValue
  thisWeekClue: HomeStatisticValue
  thisMonthClue: HomeStatisticValue
  thisYearClue: HomeStatisticValue
}

export interface HomeLeadSlaStatistic {
  overdueClue: number
}

export interface HomeAnalyticsFieldRef {
  key: string
  label: string
}

export interface HomeAnalyticsResolvedConfig {
  leadSourceField: HomeAnalyticsFieldRef | null
  customerResultField: HomeAnalyticsFieldRef | null
  customerResultValues: string[]
  customerResultTimeField: HomeAnalyticsFieldRef | null
  customerResultAmountField: HomeAnalyticsFieldRef | null
}

export interface HomeAnalyticsSummary {
  totalLeads: number
  convertedLeads: number
  conversionRate: number
  overdueLeads: number
  resultCustomers: number
  resultAmount: number | null
}

export interface HomeAnalyticsFunnelItem {
  stageKey: string
  name: string
  kind: 'ACTIVE' | 'SUCCESS' | 'FAILURE'
  count: number
}

export interface HomeAnalyticsTrend {
  months: string[]
  leads: number[]
  results: number[] | null
}

export interface HomeAnalyticsChannelItem {
  value: string
  label: string
  count: number
  convertedCount: number
  resultCount: number
}

export interface HomeAnalyticsPerformanceItem {
  ownerId: string
  ownerName: string
  leadCount: number
  convertedCount: number
  resultCount: number
}

export interface HomeAnalyticsResultItem {
  value: string
  label: string
  count: number
}

export interface HomeAnalyticsVO {
  config: HomeAnalyticsResolvedConfig
  summary: HomeAnalyticsSummary
  funnel: HomeAnalyticsFunnelItem[]
  trend: HomeAnalyticsTrend
  channels: HomeAnalyticsChannelItem[]
  performance: HomeAnalyticsPerformanceItem[]
  resultDistribution: HomeAnalyticsResultItem[]
}

export interface HomeDepartmentNode {
  id: string
  name: string
  children?: HomeDepartmentNode[]
}

export type HomeFilterModule = 'lead' | 'customer'

/**
 * 首页统计与目标列表之间唯一的筛选协议。
 * Payload 本体存 sessionStorage，URL 只携带一次性 token。
 */
export interface HomeFilterPayload {
  module: HomeFilterModule
  period?: HomeStatisticPeriod
  searchType: HomeSearchType
  deptIds: string[]
  userField?: HomeUserField
  timeField?: HomeTimeField
  /** Dashboard 内部 Lead 阶段筛选，不暴露为通用查询 DSL。 */
  leadStageKey?: string
  /** Dashboard 内部“已转 Customer”筛选。 */
  converted?: boolean
  /** Dashboard 内部 SLA 超时筛选，服务端复用 LeadPoolSlaService。 */
  overdue?: boolean
  filters?: FilterCondition[]
}
