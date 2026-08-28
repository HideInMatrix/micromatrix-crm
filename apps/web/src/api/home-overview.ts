import { http } from './http'

export interface HomeOverviewSummary {
  newLeads: number
  newCustomers: number
  newOpportunities: number
  wonAmount: number
  receivedAmount: number
  pendingApprovals: number
  upcomingFollows: number
  overduePlans: number
}

export interface HomeOverviewFunnelStage {
  name: string
  probability: number
  isWon: boolean
  count: number
  amount: number
}

export interface HomeOverviewRankingData {
  won: { name: string; amount: number; count: number }[]
  received: { name: string; amount: number }[]
}

export interface HomeOverviewTrendData {
  months: string[]
  won: number[]
  received: number[]
}

export interface HomeOverviewConversionData {
  totalLeads: number
  convertedLeads: number
  conversionRate: number
  lostReasons: { reason: string; count: number }[]
}

export const homeOverviewApi = {
  summary: () => http.get<HomeOverviewSummary>('/home/overview/summary'),
  funnel: () => http.get<HomeOverviewFunnelStage[]>('/home/overview/funnel'),
  ranking: () => http.get<HomeOverviewRankingData>('/home/overview/ranking'),
  trend: () => http.get<HomeOverviewTrendData>('/home/overview/trend'),
  conversion: () => http.get<HomeOverviewConversionData>('/home/overview/conversion'),
}
