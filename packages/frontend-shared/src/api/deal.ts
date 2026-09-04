import type {
  BusinessTitleConfigVO,
  BusinessTitleVO,
  ContractInvoiceVO,
  ContractPaymentPlanVO,
  ContractPaymentRecordVO,
  ContractVO,
  ImportResultVO,
  OrderVO,
  ProductPriceVO,
  ProductVO,
  QuoteVO,
} from '@micromatrix/shared'
import { http } from '../http'

// ===== 产品 =====

export const productApi = {
  moduleForm: () => http.get('/product/module/form'),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    status?: '1' | '2'
    filters?: unknown[]
  }) =>
    http.post<{
      list: ProductVO[]
      total: number
      current: number
      pageSize: number
      optionMap: Record<string, unknown>
    }>('/product/page', data),
  detail: (id: string) => http.get<ProductVO>(`/product/get/${id}`),
  create: (data: Record<string, unknown>) => http.post<ProductVO>('/product/add', data),
  update: (data: Record<string, unknown>) => http.post<ProductVO>('/product/update', data),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post('/product/batch/update', data),
  remove: (id: string) => http.get(`/product/delete/${id}`),
  batchDelete: (ids: string[]) => http.post('/product/batch/delete', ids),
  sort: (data: { dragNodeId: string; dropNodeId?: string; dropPosition: -1 | 1 }) =>
    http.post('/product/edit/pos', data),
  options: () => http.get<Array<{ id: string; name: string }>>('/product/list/option'),
  downloadTemplate: (importType: 'ADD' | 'UPDATE') =>
    http.get<Blob>('/product/template/download', { params: { importType }, responseType: 'blob' }),
  precheckImport: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post('/product/import/pre-check', form)
  },
  importXlsx: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post('/product/import', form)
  },
  exportAll: (data: Record<string, unknown>) => http.post('/product/export-all', data),
  exportSelected: (data: Record<string, unknown>) => http.post('/product/export-select', data),
}

export const productPriceApi = {
  moduleForm: () => http.get('/price/module/form'),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    status?: '1' | '2'
    filters?: unknown[]
  }) =>
    http.post<{
      list: ProductPriceVO[]
      total: number
      current: number
      pageSize: number
      optionMap: Record<string, unknown>
    }>('/price/page', data),
  detail: (id: string) => http.get<ProductPriceVO>(`/price/get/${id}`),
  create: (data: Record<string, unknown>) => http.post<ProductPriceVO>('/price/add', data),
  update: (data: Record<string, unknown>) => http.post<ProductPriceVO>('/price/update', data),
  copy: (id: string) => http.get<ProductPriceVO>(`/price/copy/${id}`),
  remove: (id: string) => http.get(`/price/delete/${id}`),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post('/price/batch/update', data),
  sort: (data: { dragNodeId: string; dropNodeId?: string; dropPosition: -1 | 1 }) =>
    http.post('/price/edit/pos', data),
  downloadTemplate: (importType: 'ADD' | 'UPDATE') =>
    http.get<Blob>('/price/template/download', { params: { importType }, responseType: 'blob' }),
  precheckImport: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post('/price/import/pre-check', form)
  },
  importXlsx: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post('/price/import', form)
  },
  exportAll: (data: Record<string, unknown>) => http.post('/price/export', data),
  exportSelected: (data: Record<string, unknown>) => http.post('/price/export-select', data),
}

// ===== 报价 =====

export const quoteApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/opportunity/quotation/module/form',
    ),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    opportunityId?: string
    viewId?: string
    filters?: unknown[]
  }) =>
    http.post<{ list: QuoteVO[]; total: number; current: number; pageSize: number }>(
      '/opportunity/quotation/page',
      data,
    ),
  detail: (id: string) => http.get<QuoteVO>(`/opportunity/quotation/get/${id}`),
  snapshot: (id: string) =>
    http.get<Record<string, unknown>>(`/opportunity/quotation/get/snapshot/${id}`),
  snapshotForm: (id: string) =>
    http.get<Record<string, unknown>>(`/opportunity/quotation/module/form/snapshot/${id}`),
  create: (data: Record<string, unknown>) => http.post<QuoteVO>('/opportunity/quotation/add', data),
  update: (data: Record<string, unknown>) =>
    http.post<QuoteVO>('/opportunity/quotation/update', data),
  revoke: (id: string) => http.get<string>(`/opportunity/quotation/revoke/${id}`),
  void: (id: string) => http.get(`/opportunity/quotation/voided/${id}`),
  batchVoid: (ids: string[]) =>
    http.post<{ success: number; fail: number; skip: number; errorMessages?: string }>(
      '/opportunity/quotation/batch/voided',
      { ids },
    ),
  approve: (data: { id: string; approvalStatus: string }) =>
    http.post<string>('/opportunity/quotation/approve', data),
  batchApprove: (data: { ids: string[]; approvalStatus: string }) =>
    http.post<{ success: number; fail: number; skip: number }>(
      '/opportunity/quotation/batch/approve',
      data,
    ),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post('/opportunity/quotation/batch/update', data),
  remove: (id: string) =>
    http.get<{ id: string; name: string; pendingApproval: boolean }>(
      `/opportunity/quotation/delete/${id}`,
    ),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/opportunity/quotation/tab'),
  download: (id: string) =>
    http.get<{ id: string; name: string }>(`/opportunity/quotation/download/${id}`),
}

// ===== 合同 =====

export const contractApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/contract/module/form',
    ),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    viewId?: string
    filters?: unknown[]
    board?: boolean
    stage?: string
    customerId?: string
  }) =>
    http.post<{
      list: ContractVO[]
      total: number
      current: number
      pageSize: number
      stages: Array<{
        id: string
        name: string
        type: string
        pos: number
        circulationType: string
      }>
      optionMap: Record<string, unknown>
    }>('/contract/page', data),
  detail: (id: string) => http.get<ContractVO>(`/contract/get/${id}`),
  snapshot: (id: string) => http.get<Record<string, unknown>>(`/contract/get/snapshot/${id}`),
  snapshotForm: (id: string) =>
    http.get<Record<string, unknown>>(`/contract/module/form/snapshot/${id}`),
  create: (data: Record<string, unknown>) => http.post<ContractVO>('/contract/add', data),
  update: (data: Record<string, unknown>) => http.post<ContractVO>('/contract/update', data),
  updateStage: (data: {
    id: string
    stage: string
    voidReason?: string
    fields?: Array<{ fieldId: string; fieldValue?: unknown }>
  }) => http.post<ContractVO>('/contract/update/stage', data),
  approve: (data: { id: string; approvalStatus: string }) => http.post('/contract/approval', data),
  batchApprove: (data: { ids: string[]; approvalStatus: string }) =>
    http.post<{ success: number; fail: number; skip: number }>('/contract/batch/approval', data),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post<{ success: number; fail: number; skip: number }>('/contract/batch/update', data),
  revoke: (id: string) => http.get(`/contract/revoke/${id}`),
  remove: (id: string) =>
    http.get<{ id: string; name: string; pendingApproval: boolean }>(`/contract/delete/${id}`),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/contract/tab'),
  statistic: (data: Record<string, unknown>) =>
    http.post<{ count: number; amount: number; paidAmount: number; invoicedAmount: number }>(
      '/contract/statistic',
      data,
    ),
  sort: (data: { id: string; stage: string; pos?: number }) => http.post('/contract/sort', data),
  stages: () =>
    http.get<{
      stageConfigList: Array<{
        id: string
        name: string
        type: string
        pos: number
        circulationType: string
        stageHasData: boolean
      }>
      afootRollBack: boolean
      endRollBack: boolean
      circulationType: string
    }>('/contract/stage/get'),
}

// ===== 发票 / 工商抬头（Cordys direct） =====

export const contractInvoiceApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/invoice/module/form',
    ),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    viewId?: string
    filters?: unknown[]
    contractId?: string
    customerId?: string
  }) =>
    http.post<{
      list: ContractInvoiceVO[]
      total: number
      current: number
      pageSize: number
      optionMap: Record<string, unknown>
    }>('/invoice/page', data),
  detail: (id: string) => http.get<ContractInvoiceVO>(`/invoice/get/${id}`),
  snapshot: (id: string) => http.get<Record<string, unknown>>(`/invoice/get/snapshot/${id}`),
  snapshotForm: (id: string) =>
    http.get<Record<string, unknown>>(`/invoice/module/form/snapshot/${id}`),
  create: (data: Record<string, unknown>) => http.post<ContractInvoiceVO>('/invoice/add', data),
  update: (data: Record<string, unknown>) => http.post<ContractInvoiceVO>('/invoice/update', data),
  remove: (id: string) => http.get(`/invoice/delete/${id}`),
  batchDelete: (ids: string[]) => http.post('/invoice/batch/delete', ids),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/invoice/tab'),
  contractStatistic: (contractId: string) =>
    http.get<{ contractAmount: number; invoicedAmount: number; uninvoicedAmount: number }>(
      `/contract/invoice/statistic/${contractId}`,
    ),
  approvalPush: (resourceId: string) =>
    http.post<ContractInvoiceVO>('/approval-resource/push', { resourceId, formKey: 'invoice' }),
  approvalRevoke: (resourceId: string) =>
    http.post<ContractInvoiceVO>('/approval-resource/revoke', { resourceId, formKey: 'invoice' }),
  approvalSimpleDetail: (resourceId: string) =>
    http.get<Record<string, unknown>>(`/approval-resource/simple-detail/${resourceId}`),
  approvalDetail: (resourceId: string) =>
    http.get<Record<string, unknown>>(`/approval-resource/detail/${resourceId}`),
  downloadTemplate: (importType: 'ADD' | 'UPDATE') =>
    http.get<Blob>('/invoice/template/download', { params: { importType }, responseType: 'blob' }),
  precheckImport: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post<ImportResultVO>('/invoice/import/pre-check', form)
  },
  importXlsx: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post<ImportResultVO>('/invoice/import', form)
  },
  exportAll: (data: Record<string, unknown>) => http.post('/invoice/export-all', data),
  exportSelected: (data: Record<string, unknown>) => http.post('/invoice/export-select', data),
}

export const businessTitleApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/contract/business-title/module/form',
    ),
  page: (data: { current?: number; pageSize?: number; keyword?: string; filters?: unknown[] }) =>
    http.post<{ list: BusinessTitleVO[]; total: number; current: number; pageSize: number }>(
      '/contract/business-title/page',
      data,
    ),
  detail: (id: string) => http.get<BusinessTitleVO>(`/contract/business-title/get/${id}`),
  options: () => http.get<BusinessTitleVO[]>('/contract/business-title/option'),
  create: (data: Record<string, unknown>) =>
    http.post<BusinessTitleVO>('/contract/business-title/add', data),
  update: (data: Record<string, unknown>) =>
    http.post<BusinessTitleVO>('/contract/business-title/update', data),
  remove: (id: string) => http.get(`/contract/business-title/delete/${id}`),
  approval: (data: { id: string; approvalStatus: 'APPROVED' | 'UNAPPROVED'; reason?: string }) =>
    http.post<BusinessTitleVO>('/contract/business-title/approval', data),
  revoke: (id: string) => http.get<BusinessTitleVO>(`/contract/business-title/revoke/${id}`),
  hasInvoice: (id: string) => http.get<boolean>(`/contract/business-title/invoice/check/${id}`),
  downloadTemplate: (importType: 'ADD' | 'UPDATE') =>
    http.get<Blob>('/contract/business-title/template/download', {
      params: { importType },
      responseType: 'blob',
    }),
  precheckImport: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post<ImportResultVO>('/contract/business-title/import/pre-check', form)
  },
  importXlsx: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post<ImportResultVO>('/contract/business-title/import', form)
  },
  exportAll: (data: Record<string, unknown>) =>
    http.post('/contract/business-title/export-all', data),
  exportSelected: (data: Record<string, unknown>) =>
    http.post('/contract/business-title/export-select', data),
  config: () => http.get<BusinessTitleConfigVO[]>('/business-title/config/get'),
  switchRequired: (id: string) =>
    http.get<BusinessTitleConfigVO>(`/business-title/config/switch/${id}`),
}

// ===== 回款计划 / 回款记录（Cordys direct） =====

export const contractPaymentPlanApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/contract/payment-plan/module/form',
    ),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    viewId?: string
    filters?: unknown[]
    contractId?: string
    customerId?: string
  }) =>
    http.post<{
      list: ContractPaymentPlanVO[]
      total: number
      current: number
      pageSize: number
      optionMap: Record<string, unknown>
    }>('/contract/payment-plan/page', data),
  detail: (id: string) => http.get<ContractPaymentPlanVO>(`/contract/payment-plan/get/${id}`),
  create: (data: Record<string, unknown>) =>
    http.post<ContractPaymentPlanVO>('/contract/payment-plan/add', data),
  update: (data: Record<string, unknown>) =>
    http.post<ContractPaymentPlanVO>('/contract/payment-plan/update', data),
  remove: (id: string) => http.get(`/contract/payment-plan/delete/${id}`),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/contract/payment-plan/tab'),
}

export const contractPaymentRecordApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/contract/payment-record/module/form',
    ),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    viewId?: string
    filters?: unknown[]
    contractId?: string
    customerId?: string
  }) =>
    http.post<{
      list: ContractPaymentRecordVO[]
      total: number
      current: number
      pageSize: number
      optionMap: Record<string, unknown>
    }>('/contract/payment-record/page', data),
  detail: (id: string) => http.get<ContractPaymentRecordVO>(`/contract/payment-record/get/${id}`),
  create: (data: Record<string, unknown>) =>
    http.post<ContractPaymentRecordVO>('/contract/payment-record/add', data),
  update: (data: Record<string, unknown>) =>
    http.post<ContractPaymentRecordVO>('/contract/payment-record/update', data),
  remove: (id: string) => http.get(`/contract/payment-record/delete/${id}`),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/contract/payment-record/tab'),
  statistic: (data: Record<string, unknown>) =>
    http.post<{ count: number; recordAmount: number }>('/contract/payment-record/statistic', data),
}

// ===== 订单 =====

export const orderApi = {
  moduleForm: () =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: unknown[] }>(
      '/order/module/form',
    ),
  page: (data: {
    current?: number
    pageSize?: number
    keyword?: string
    viewId?: string
    filters?: unknown[]
    board?: boolean
    stage?: string
    customerId?: string
    contractId?: string
  }) =>
    http.post<{
      list: OrderVO[]
      total: number
      current: number
      pageSize: number
      stages: Array<{
        id: string
        name: string
        type: string
        pos: number
        circulationType: string
      }>
      optionMap: Record<string, unknown>
    }>('/order/page', data),
  detail: (id: string) => http.get<OrderVO>(`/order/get/${id}`),
  snapshot: (id: string) => http.get<Record<string, unknown>>(`/order/get/snapshot/${id}`),
  snapshotForm: (id: string) =>
    http.get<Record<string, unknown>>(`/order/module/form/snapshot/${id}`),
  create: (data: Record<string, unknown>) => http.post<OrderVO>('/order/add', data),
  update: (data: Record<string, unknown>) => http.post<OrderVO>('/order/update', data),
  updateStage: (data: {
    id: string
    stage: string
    fields?: Array<{ fieldId: string; fieldValue?: unknown }>
  }) => http.post<OrderVO>('/order/update/stage', data),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post<{ success: number; fail: number; skip: number }>('/order/batch/update', data),
  remove: (id: string) =>
    http.get<{ id: string; name: string; approvalId?: string; pendingApproval: boolean }>(
      `/order/delete/${id}`,
    ),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/order/tab'),
  statistic: (data: Record<string, unknown>) =>
    http.post<{ count: number; amount: number }>('/order/statistic', data),
  sort: (data: { id: string; stage: string; pos?: number }) => http.post('/order/sort', data),
  approvalPush: (resourceId: string) =>
    http.post('/approval-resource/push', { resourceId, formKey: 'order' }),
  approvalRevoke: (resourceId: string) =>
    http.post('/approval-resource/revoke', { resourceId, formKey: 'order' }),
  approvalSimpleDetail: (resourceId: string) =>
    http.get<Record<string, unknown>>(`/approval-resource/simple-detail/${resourceId}`),
  approvalDetail: (resourceId: string) =>
    http.get<Record<string, unknown>>(`/approval-resource/detail/${resourceId}`),
  downloadTemplate: (importType: 'ADD' | 'UPDATE') =>
    http.get<Blob>('/order/template/download', { params: { importType }, responseType: 'blob' }),
  precheckImport: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post<ImportResultVO>('/order/import/pre-check', form)
  },
  importXlsx: (file: File, importType: 'ADD' | 'UPDATE') => {
    const form = new FormData()
    form.append('file', file)
    form.append('importType', importType)
    return http.post<ImportResultVO>('/order/import', form)
  },
  exportAll: (data: Record<string, unknown>) => http.post('/order/export-all', data),
  exportSelected: (data: Record<string, unknown>) => http.post('/order/export-select', data),
}
