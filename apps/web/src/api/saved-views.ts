import type { FilterCondition, FilterOp } from '@micromatrix/shared'
import { http } from './http'

export interface SavedViewConditionVO {
  id?: string
  field: string
  operator: FilterOp
  value?: unknown
  fieldType?: string | null
  multipleValue?: boolean
  containChildIds?: string[]
  sort?: number
}

export interface SavedViewVO {
  id: string
  module: string
  name: string
  fixed: boolean
  enabled: boolean
  sort: number
  searchMode: 'AND' | 'OR'
  conditions: SavedViewConditionVO[]
  createdAt: string
  updatedAt: string
}

export interface SavedViewPayload {
  name: string
  searchMode: 'AND' | 'OR'
  conditions: SavedViewConditionVO[]
}

export const savedViewApi = {
  list: (module: string) => http.get<SavedViewVO[]>(`/saved-views/${module}`),
  detail: (id: string) => http.get<SavedViewVO>(`/saved-views/detail/${id}`),
  create: (module: string, data: SavedViewPayload) =>
    http.post<SavedViewVO>(`/saved-views/${module}`, data),
  update: (id: string, data: Partial<SavedViewPayload>) =>
    http.patch<SavedViewVO>(`/saved-views/detail/${id}`, data),
  remove: (id: string) => http.delete(`/saved-views/detail/${id}`),
  toggleFixed: (id: string) => http.post(`/saved-views/detail/${id}/fixed`),
  toggleEnabled: (id: string) => http.post(`/saved-views/detail/${id}/enabled`),
  reorder: (module: string, ids: string[]) =>
    http.post<SavedViewVO[]>(`/saved-views/${module}/reorder`, { ids }),
}

export function savedConditionsToFilters(conditions: SavedViewConditionVO[]): FilterCondition[] {
  return conditions.map((condition) => ({
    key: condition.field,
    op: condition.operator,
    value: condition.value,
  }))
}
