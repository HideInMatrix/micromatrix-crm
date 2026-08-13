import type {
  BiddingInfoVO,
  BiddingKeywordVO,
  BiddingSourceVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from './http'

export const biddingApi = {
  list: (params: PageQuery & { type?: string }) =>
    http.get<PaginatedResult<BiddingInfoVO>>('/bidding', { params }),
  convert: (id: string) => http.post<{ id: string; name: string }>(`/bidding/${id}/convert`),
  manualImport: (data: Record<string, unknown>) => http.post('/bidding/import', data),
  fetchNow: () => http.post<{ fetched: number; inserted: number }>('/bidding/fetch-now'),

  sources: () => http.get<BiddingSourceVO[]>('/bidding/sources'),
  saveSource: (provider: string, enabled: boolean, credentials?: Record<string, unknown>) =>
    http.put('/bidding/sources', { provider, enabled, credentials }),

  keywords: () => http.get<BiddingKeywordVO[]>('/bidding/keywords'),
  addKeyword: (keyword: string) => http.post('/bidding/keywords', { keyword }),
  toggleKeyword: (id: string) => http.post(`/bidding/keywords/${id}/toggle`),
  removeKeyword: (id: string) => http.delete(`/bidding/keywords/${id}`),
}
