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

export interface HomeOpportunityStatistic {
  todayOpportunity: HomeStatisticValue
  thisWeekOpportunity: HomeStatisticValue
  thisMonthOpportunity: HomeStatisticValue
  thisYearOpportunity: HomeStatisticValue
  todayOpportunityAmount: HomeStatisticValue
  thisWeekOpportunityAmount: HomeStatisticValue
  thisMonthOpportunityAmount: HomeStatisticValue
  thisYearOpportunityAmount: HomeStatisticValue
}

export interface HomeDepartmentNode {
  id: string
  name: string
  children?: HomeDepartmentNode[]
}

export type HomeFilterModule = 'lead' | 'opportunity'
export type HomeOpportunityFilterStatus = 'AFOOT' | 'SUCCESS'

/**
 * 首页统计与目标列表之间唯一的筛选协议。
 * Payload 本体存 sessionStorage，URL 只携带一次性 token。
 */
export interface HomeFilterPayload {
  module: HomeFilterModule
  period: HomeStatisticPeriod
  searchType: HomeSearchType
  deptIds: string[]
  userField?: HomeUserField
  timeField?: HomeTimeField
  status?: HomeOpportunityFilterStatus
}
