import { http } from './http'

export interface DashboardSummary {
  newLeads: number
  newCustomers: number
  newOpportunities: number
  wonAmount: number
  receivedAmount: number
  pendingApprovals: number
  upcomingFollows: number
  overduePlans: number
}

export interface FunnelStage {
  name: string
  probability: number
  isWon: boolean
  count: number
  amount: number
}

export interface RankingData {
  won: { name: string; amount: number; count: number }[]
  received: { name: string; amount: number }[]
}

export interface TrendData {
  months: string[]
  won: number[]
  received: number[]
}

export interface ConversionData {
  totalLeads: number
  convertedLeads: number
  conversionRate: number
  lostReasons: { reason: string; count: number }[]
}

export const dashboardApi = {
  summary: () => http.get<DashboardSummary>('/dashboard/summary'),
  funnel: () => http.get<FunnelStage[]>('/dashboard/funnel'),
  ranking: () => http.get<RankingData>('/dashboard/ranking'),
  trend: () => http.get<TrendData>('/dashboard/trend'),
  conversion: () => http.get<ConversionData>('/dashboard/conversion'),
}
