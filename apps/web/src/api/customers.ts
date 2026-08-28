import type {
  Customer360ContractVO,
  Customer360InvoiceVO,
  Customer360OpportunityVO,
  Customer360OrderVO,
  Customer360ReceivablePlanVO,
  Customer360ReceivableRecordVO,
  Customer360Resource,
  CustomerVO,
  DuplicateHitVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import type { AxiosResponse } from 'axios'
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

export interface CustomerMergePayload {
  mergeIds: string[]
  toMergeId: string
  ownerId: string
}

export interface CustomerMergePreviewVO {
  targetWasSelected: boolean
  target: { id: string; name: string; ownerId: string | null; ownerName: string | null }
  sources: { id: string; name: string; ownerId: string | null; ownerName: string | null }[]
  finalOwner: { id: string; name: string | null }
  counts: {
    customersToDelete: number
    contacts: number
    contactsWillMove: number
    contactsWillSkip: number
    opportunities: number
    quotes: number
    contracts: number
    followUps: number
    followUpPlans: number
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

interface CordysPager<T> {
  list: T[]
  total: number
  pageSize: number
  current: number
  optionMap?: Record<string, unknown>
}

function parseCustomerFilters(raw?: string) {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function customerPageBody(params: CustomerListParams) {
  return {
    current: params.page ?? 1,
    pageSize: params.pageSize ?? 10,
    keyword: params.keyword,
    view: params.view,
    viewId: params.viewId,
    filters: parseCustomerFilters(params.filters),
  }
}

function toAccountPayload(data: CustomerPayload) {
  const customData =
    data.customData && typeof data.customData === 'object'
      ? (data.customData as Record<string, unknown>)
      : {}
  return {
    name: data.name,
    owner: data.owner ?? data.ownerId,
    moduleFields: Object.entries(customData).map(([fieldId, fieldValue]) => ({
      fieldId,
      fieldValue,
    })),
  }
}

export async function listCustomers(
  params: CustomerListParams,
): Promise<AxiosResponse<PaginatedResult<CustomerVO>>> {
  const poolMode = params.scope === 'sea'
  const response = await http.post<CordysPager<CustomerVO>>(
    poolMode ? '/pool/account/page' : '/account/page',
    poolMode
      ? { ...customerPageBody(params), poolId: params.poolId }
      : customerPageBody(params),
  )
  return {
    ...response,
    data: {
      items: response.data.list,
      total: response.data.total,
      page: response.data.current,
      pageSize: response.data.pageSize,
    },
  }
}

export function getCustomerTabs() {
  return http.get<CustomerTabVO>('/account/tab')
}

export function getCustomer(id: string, pool = false) {
  return http.get<CustomerVO>(pool ? `/pool/account/get/${id}` : `/account/get/${id}`)
}

export function batchTransferCustomers(ids: string[], owner: string) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/account/batch/transfer', { ids, owner })
}

export function moveCustomerToPool(id: string, poolId?: string, reasonId?: string) {
  return http.post('/account/to-pool', { id, poolId, reasonId })
}

export function batchMoveCustomersToPool(ids: string[], poolId?: string, reasonId?: string) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/account/batch/to-pool', {
    ids,
    poolId,
    reasonId,
  })
}

export function poolBatchPickCustomers(poolId: string, ids: string[]) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/account/batch-pick', {
    poolId,
    batchIds: ids,
  })
}

export function poolBatchAssignCustomers(ids: string[], ownerId: string) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/account/batch-assign', {
    batchIds: ids,
    assignUserId: ownerId,
  })
}

export function poolDeleteCustomer(id: string) {
  return http.get(`/pool/account/delete/${id}`)
}

export interface Customer360ResourceMap {
  opportunities: Customer360OpportunityVO
  contracts: Customer360ContractVO
  receivablePlans: Customer360ReceivablePlanVO
  receivableRecords: Customer360ReceivableRecordVO
  invoices: Customer360InvoiceVO
  orders: Customer360OrderVO
}

export function getCustomer360Resource<T extends Customer360Resource>(
  id: string,
  resource: T,
  params: PageQuery = {},
) {
  const paths: Record<Customer360Resource, string> = {
    opportunities: '/account/opportunity/page',
    contracts: '/account/contract/page',
    receivablePlans: '/account/contract/payment-plan/page',
    receivableRecords: '/account/contract/payment-record/page',
    invoices: '/account/invoice/page',
    orders: '/account/order/page',
  }
  return http
    .post<CordysPager<Customer360ResourceMap[T]>>(paths[resource], {
      accountId: id,
      current: params.page ?? 1,
      pageSize: params.pageSize ?? 10,
    })
    .then(
      (response): AxiosResponse<PaginatedResult<Customer360ResourceMap[T]>> => ({
        ...response,
        data: {
          items: response.data.list,
          total: response.data.total,
          page: response.data.current,
          pageSize: response.data.pageSize,
        },
      }),
    )
}

export function checkDuplicate(params: { name?: string; phone?: string }) {
  return http.get<DuplicateHitVO[]>('/account/check-duplicate', { params })
}

export async function listCustomerOptions(keyword?: string): Promise<AxiosResponse<CustomerOptionVO[]>> {
  const response = await http.post<CordysPager<CustomerOptionVO>>('/account/option', {
    current: 1,
    pageSize: 100,
    keyword: keyword?.trim() || undefined,
  })
  return { ...response, data: response.data.list }
}

export function listCustomerRelations(id: string) {
  return http.get<CustomerRelationVO[]>(`/account/relation/list/${id}`)
}

export function replaceCustomerRelations(id: string, relations: CustomerRelationPayload[]) {
  return http.post<CustomerRelationVO[]>(`/account/relation/save/${id}`, relations)
}

export function previewCustomerMerge(data: CustomerMergePayload) {
  return http.post<CustomerMergePreviewVO>('/account/merge/preview', data)
}

export function mergeCustomers(data: CustomerMergePayload) {
  return http.post<{ id: string; name: string; merged: number }>('/account/merge', data)
}

export function createCustomer(data: CustomerPayload) {
  return http.post<CustomerVO>('/account/add', toAccountPayload(data))
}

export function updateCustomer(id: string, data: CustomerPayload) {
  return http.post<CustomerVO>('/account/update', { id, ...toAccountPayload(data) })
}

export function removeCustomer(id: string) {
  return http.get<{ id: string }>(`/account/delete/${id}`)
}

export function batchUpdateCustomers(data: { ids: string[]; fieldId: string; fieldValue?: unknown }) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/account/batch/update', data)
}

export function batchDeleteCustomers(ids: string[]) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/account/batch/delete', ids)
}

export function poolBatchUpdateCustomers(data: {
  poolId: string
  ids: string[]
  fieldId: string
  fieldValue?: unknown
}) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/account/batch-update', {
    ids: data.ids,
    fieldId: data.fieldId,
    fieldValue: data.fieldValue,
  })
}

export function poolBatchDeleteCustomers(ids: string[]) {
  return http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/account/batch-delete', {
    batchIds: ids,
  })
}

export const customerTransferApi = {
  importTemplate: (importType: ImportType, poolId?: string) =>
    http.get<Blob>(poolId ? '/pool/account/template/download' : '/account/template/download', {
      params: { importType },
      responseType: 'blob',
    }),
  importPrecheck: (file: File, importType: ImportType, poolId?: string) =>
    http.post<XlsxImportResult>(
      poolId ? '/pool/account/import/pre-check' : '/account/import/pre-check',
      createImportForm(file, importType, poolId),
    ),
  importXlsx: (file: File, importType: ImportType, poolId?: string) =>
    http.post<XlsxImportResult>(
      poolId ? '/pool/account/import' : '/account/import',
      createImportForm(file, importType, poolId),
    ),
  exportAll: (params: CustomerListParams, data: ExportCreatePayload, poolId?: string) =>
    http.post(poolId ? '/pool/account/export-all' : '/account/export-all', {
      ...customerPageBody(params),
      ...data,
      poolId,
    }),
  exportSelected: (
    params: CustomerListParams,
    data: ExportCreatePayload & { ids: string[] },
    poolId?: string,
  ) =>
    http.post(poolId ? '/pool/account/export-select' : '/account/export-select', data),
}
