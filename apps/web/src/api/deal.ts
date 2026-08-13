import type {
  ContractVO,
  InvoiceTitleVO,
  InvoiceVO,
  OrderVO,
  PageQuery,
  PaginatedResult,
  ProductVO,
  QuoteVO,
  ReceivablePlanVO,
  ReceivableRecordVO,
} from '@micromatrix/shared'
import { http } from './http'

// ===== 产品 =====

export const productApi = {
  list: (params: PageQuery & { status?: string; filters?: string }) =>
    http.get<PaginatedResult<ProductVO>>('/products', { params }),
  create: (data: Record<string, unknown>) => http.post<ProductVO>('/products', data),
  update: (id: string, data: Record<string, unknown>) =>
    http.patch<ProductVO>(`/products/${id}`, data),
  toggleStatus: (id: string) => http.post(`/products/${id}/toggle-status`),
  remove: (id: string) => http.delete(`/products/${id}`),
}

// ===== 报价 =====

export const quoteApi = {
  list: (params: PageQuery & { status?: string; customerId?: string; filters?: string }) =>
    http.get<PaginatedResult<QuoteVO>>('/quotes', { params }),
  create: (data: Record<string, unknown>) => http.post<QuoteVO>('/quotes', data),
  update: (id: string, data: Record<string, unknown>) => http.patch<QuoteVO>(`/quotes/${id}`, data),
  confirm: (id: string) => http.post(`/quotes/${id}/confirm`),
  void: (id: string) => http.post(`/quotes/${id}/void`),
  remove: (id: string) => http.delete(`/quotes/${id}`),
}

// ===== 合同 =====

export const contractApi = {
  list: (params: PageQuery & { status?: string; customerId?: string; filters?: string }) =>
    http.get<PaginatedResult<ContractVO>>('/contracts', { params }),
  detail: (id: string) => http.get<ContractVO>(`/contracts/${id}`),
  create: (data: Record<string, unknown>) => http.post<ContractVO>('/contracts', data),
  update: (id: string, data: Record<string, unknown>) =>
    http.patch<ContractVO>(`/contracts/${id}`, data),
  changeStatus: (id: string, status: string) => http.post(`/contracts/${id}/status`, { status }),
  remove: (id: string) => http.delete(`/contracts/${id}`),

  // 回款计划
  plans: (contractId: string) =>
    http.get<ReceivablePlanVO[]>(`/contracts/${contractId}/receivable-plans`),
  createPlan: (data: { contractId: string; amount: number; dueDate: string; remark?: string }) =>
    http.post('/contracts/receivable-plans', data),
  removePlan: (planId: string) => http.delete(`/contracts/receivable-plans/${planId}`),

  // 回款记录
  records: (contractId: string) =>
    http.get<ReceivableRecordVO[]>(`/contracts/${contractId}/receivable-records`),
  createRecord: (data: {
    contractId: string
    planId?: string
    amount: number
    receivedAt: string
    method?: string
    remark?: string
  }) => http.post('/contracts/receivable-records', data),
  removeRecord: (recordId: string) => http.delete(`/contracts/receivable-records/${recordId}`),

  // 发票
  invoices: (contractId: string) => http.get<InvoiceVO[]>(`/contracts/${contractId}/invoices`),
  createInvoice: (data: {
    contractId: string
    titleId?: string
    amount: number
    type?: string
    remark?: string
  }) => http.post('/contracts/invoices', data),
  issueInvoice: (invoiceId: string, invoiceNo: string) =>
    http.post(`/contracts/invoices/${invoiceId}/issue`, { invoiceNo }),
  voidInvoice: (invoiceId: string) => http.post(`/contracts/invoices/${invoiceId}/void`),

  // 工商抬头
  titles: (customerId?: string) =>
    http.get<InvoiceTitleVO[]>('/contracts/invoice-titles', { params: { customerId } }),
  createTitle: (data: Partial<InvoiceTitleVO> & { name: string; taxNo: string }) =>
    http.post('/contracts/invoice-titles', data),
  updateTitle: (id: string, data: Partial<InvoiceTitleVO>) =>
    http.patch(`/contracts/invoice-titles/${id}`, data),
  removeTitle: (id: string) => http.delete(`/contracts/invoice-titles/${id}`),
}

// ===== 订单 =====

export const orderApi = {
  list: (params: PageQuery & { status?: string; contractId?: string; filters?: string }) =>
    http.get<PaginatedResult<OrderVO>>('/orders', { params }),
  create: (data: Record<string, unknown>) => http.post<OrderVO>('/orders', data),
  update: (id: string, data: Record<string, unknown>) => http.patch<OrderVO>(`/orders/${id}`, data),
  changeStatus: (id: string, status: string) => http.post(`/orders/${id}/status`, { status }),
  remove: (id: string) => http.delete(`/orders/${id}`),
}
