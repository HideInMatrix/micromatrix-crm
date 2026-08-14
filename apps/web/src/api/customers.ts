import type {
  CustomerRelatedVO,
  CustomerVO,
  DuplicateHitVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from './http'

export interface CustomerListParams extends PageQuery {
  /** FilterCondition[] 的 JSON 字符串 */
  filters?: string
  /** sea=客户公海 */
  scope?: 'mine' | 'sea'
}

/** 动态表单载荷：系统字段 + customData（cf_* 键） */
export type CustomerPayload = Record<string, unknown>

export function listCustomers(params: CustomerListParams) {
  return http.get<PaginatedResult<CustomerVO>>('/customers', { params })
}

export function getCustomer(id: string) {
  return http.get<CustomerVO>(`/customers/${id}`)
}

export function getCustomerRelated(id: string) {
  return http.get<CustomerRelatedVO>(`/customers/${id}/related`)
}

export function checkDuplicate(params: { name?: string; phone?: string }) {
  return http.get<DuplicateHitVO[]>('/customers/check-duplicate', { params })
}

export function createCustomer(data: CustomerPayload) {
  return http.post<CustomerVO>('/customers', data)
}

export function updateCustomer(id: string, data: CustomerPayload) {
  return http.patch<CustomerVO>(`/customers/${id}`, data)
}

export function removeCustomer(id: string) {
  return http.delete<{ id: string }>(`/customers/${id}`)
}

export interface ImportResult {
  success: number
  failed: number
  errors: string[]
}

export function importCustomers(rows: Record<string, unknown>[]) {
  return http.post<ImportResult>('/customers/import', { rows })
}

export function exportCustomersCsv(params: CustomerListParams) {
  return http.get<Blob>('/customers/export', { params, responseType: 'blob' })
}
