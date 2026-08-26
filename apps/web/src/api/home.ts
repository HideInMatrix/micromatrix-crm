import type {
  HomeDepartmentNode,
  HomeLeadStatistic,
  HomeOpportunityStatistic,
  HomeStatisticRequest,
} from '@micromatrix/shared'
import { http } from './http'

export const homeApi = {
  departmentTree: () => http.get<HomeDepartmentNode[]>('/home/statistic/department/tree'),
  lead: (data: HomeStatisticRequest) => http.post<HomeLeadStatistic>('/home/statistic/lead', data),
  opportunity: (data: HomeStatisticRequest) =>
    http.post<HomeOpportunityStatistic>('/home/statistic/opportunity', data),
  opportunityUnderway: (data: HomeStatisticRequest) =>
    http.post<HomeOpportunityStatistic>('/home/statistic/opportunity/underway', data),
  opportunitySuccess: (data: HomeStatisticRequest) =>
    http.post<HomeOpportunityStatistic>('/home/statistic/opportunity/success', data),
}
