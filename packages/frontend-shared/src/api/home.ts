import type {
  HomeAnalyticsVO,
  HomeDepartmentNode,
  HomeLeadStatistic,
  HomeStatisticRequest,
} from '@micromatrix/shared'
import { http } from '../http'

export const homeApi = {
  departmentTree: () => http.get<HomeDepartmentNode[]>('/home/statistic/department/tree'),
  lead: (data: HomeStatisticRequest) => http.post<HomeLeadStatistic>('/home/statistic/lead', data),
  analytics: (data: HomeStatisticRequest) =>
    http.post<HomeAnalyticsVO>('/home/statistic/analytics', data),
}
