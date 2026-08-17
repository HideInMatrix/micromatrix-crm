import type {
  CustomerRelatedVO,
  CustomerVO,
  DuplicateHitVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from './http'
import {
  createImportForm,
  type ExportCreatePayload,
  type ImportResult as XlsxImportResult,
  type ImportType,
} from './import-export'

export interface CustomerListParams extends PageQuery {
  /** FilterCondition[] 的 JSON 字符串 */
  filters?: string
  /** sea=客户公海；普通客户页使用 view */
  scope?: 'sea'
  /** Cordys 客户系统视图；ALL 仍受角色数据权限约束 */
  view?: 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'
  poolId?: string
  viewId?: string
}

export interface CustomerTabVO {
  all: boolean
  dept: boolean
}

export interface CustomerOptionVO {
  id: string
  name: string
}

export interface CustomerRelationVO {
  id: string
  relationType: 'GROUP' | 'SUBSIDIARY'
  customerId: string
  customerName: string | null
  createdAt: string
}

export interface CustomerRelationPayload {
  relationType: 'GROUP' | 'SUBSIDIARY'
  customerId: string
}

export type ContactConflictStrategy = 'KEEP_ALL' | 'SKIP_DUPLICATES'

export interface CustomerMergePayload {
  mergeIds: string[]
  toMergeId: string
  ownerId: string
  contactConflictStrategy?: ContactConflictStrategy
}

export interface CustomerMergePreviewVO {
  targetWasSelected: boolean
  target: { id: string; name: string; ownerId: string | null; ownerName: string | null }
  sources: { id: string; name: string; ownerId: string | null; ownerName: string | null }[]
  finalOwner: { id: string; name: string | null }
  contactConflictStrategy: ContactConflictStrategy
  counts: {
    customersToDelete: number
    contacts: number
    contactsWillMove: number
    contactsWillSkip: number
    opportunities: number
    quotes: number
    contracts: number
    followUps: number
    attachments: number
    collaborations: number
    relationsToRemove: number
  }
  contactConflicts: {
    sourceContactId: string
    sourceCustomerId: string
    name: string
    phone: string | null
    matchedBy: ('name' | 'phone')[]
    targetContactIds: string[]
  }[]
}

/** 动态表单载荷：系统字段 + customData（cf_* 键） */
export type CustomerPayload = Record<string, unknown>

export function listCustomers(params: CustomerListParams) {
  return http.get<PaginatedResult<CustomerVO>>('/customers', { params })
}

export function getCustomerTabs() {
  return http.get<CustomerTabVO>('/customers/tab')
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

export function listCustomerOptions(keyword?: string) {
  return http.get<CustomerOptionVO[]>('/customers/options', {
    params: { keyword: keyword?.trim() || undefined },
  })
}

export function listCustomerRelations(id: string) {
  return http.get<CustomerRelationVO[]>(`/customers/${id}/relations`)
}

export function replaceCustomerRelations(id: string, relations: CustomerRelationPayload[]) {
  return http.put<CustomerRelationVO[]>(`/customers/${id}/relations`, { relations })
}

export function previewCustomerMerge(data: CustomerMergePayload) {
  return http.post<CustomerMergePreviewVO>('/customers/merge/preview', data)
}

export function mergeCustomers(data: CustomerMergePayload) {
  return http.post<{ id: string; name: string; merged: number }>('/customers/merge', data)
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

export function batchUpdateCustomers(data: { ids: string[]; fieldId: string; fieldValue?: unknown }) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/customers/batch/update', data)
}

export function batchDeleteCustomers(ids: string[]) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/customers/batch/delete', { ids })
}

export function poolBatchUpdateCustomers(data: {
  poolId: string
  ids: string[]
  fieldId: string
  fieldValue?: unknown
}) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/customers/pool/batch/update', data)
}

export function poolBatchDeleteCustomers(poolId: string, ids: string[]) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/customers/pool/batch/delete', {
    poolId,
    ids,
  })
}

export interface ImportResult {
  success: number
  failed: number
  errors: string[]
}

export function importCustomers(rows: Record<string, unknown>[]) {
  return http.post<ImportResult>('/customers/import/rows', { rows })
}

export function exportCustomersCsv(params: CustomerListParams) {
  return http.get<Blob>('/customers/export', { params, responseType: 'blob' })
}

export const customerTransferApi = {
  importTemplate: (importType: ImportType, poolId?: string) =>
    http.get<Blob>(poolId ? '/customers/pool/import/template' : '/customers/import/template', {
      params: { importType, poolId },
      responseType: 'blob',
    }),
  importPrecheck: (file: File, importType: ImportType, poolId?: string) =>
    http.post<XlsxImportResult>(
      poolId ? '/customers/pool/import/pre-check' : '/customers/import/pre-check',
      createImportForm(file, importType, poolId),
    ),
  importXlsx: (file: File, importType: ImportType, poolId?: string) =>
    http.post<XlsxImportResult>(
      poolId ? '/customers/pool/import' : '/customers/import',
      createImportForm(file, importType, poolId),
    ),
  exportAll: (params: CustomerListParams, data: ExportCreatePayload, poolId?: string) =>
    http.post(poolId ? '/customers/pool/export/all' : '/customers/export/all', data, {
      params: { ...params, poolId },
    }),
  exportSelected: (
    params: CustomerListParams,
    data: ExportCreatePayload & { ids: string[] },
    poolId?: string,
  ) =>
    http.post(poolId ? '/customers/pool/export/select' : '/customers/export/select', data, {
      params: { ...params, poolId },
    }),
}
