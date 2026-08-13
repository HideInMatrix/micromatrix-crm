// ============ 交易链路：产品 / 报价 / 合同 / 回款 / 发票 / 订单 ============

export type ProductStatus = 'ON' | 'OFF'

export interface ProductVO {
  id: string
  name: string
  code: string | null
  category: string | null
  unit: string | null
  price: number
  cost: number | null
  status: ProductStatus
  description: string | null
  ownerId: string | null
  customData: Record<string, unknown>
  createdAt: string
}

// ===== 明细行（报价/合同共用） =====

export interface LineItemVO {
  id?: string
  productId: string | null
  productName: string
  unit: string | null
  quantity: number
  unitPrice: number
  /** 折扣百分比，100 = 不打折 */
  discount: number
  amount: number
}

export function lineAmount(item: Pick<LineItemVO, 'quantity' | 'unitPrice' | 'discount'>): number {
  return Math.round(item.quantity * item.unitPrice * (item.discount / 100) * 100) / 100
}

// ===== 报价 =====

export type QuoteStatus = 'DRAFT' | 'CONFIRMED' | 'VOID'

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: '草稿',
  CONFIRMED: '已确认',
  VOID: '已作废',
}

export interface QuoteVO {
  id: string
  code: string
  name: string
  customerId: string
  customerName?: string
  opportunityId: string | null
  totalAmount: number
  status: QuoteStatus
  approvalStatus: string
  validUntil: string | null
  remark: string | null
  ownerId: string | null
  ownerName?: string | null
  customData: Record<string, unknown>
  items: LineItemVO[]
  createdAt: string
}

// ===== 合同 =====

export type ContractStatus = 'DRAFT' | 'EXECUTING' | 'COMPLETED' | 'TERMINATED'

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: '草稿',
  EXECUTING: '履约中',
  COMPLETED: '已完成',
  TERMINATED: '已终止',
}

export interface ContractVO {
  id: string
  code: string
  name: string
  customerId: string
  customerName?: string
  opportunityId: string | null
  quoteId: string | null
  amount: number
  paidAmount: number
  invoicedAmount: number
  status: ContractStatus
  approvalStatus: string
  signedAt: string | null
  startAt: string | null
  endAt: string | null
  remark: string | null
  ownerId: string | null
  ownerName?: string | null
  customData: Record<string, unknown>
  items: LineItemVO[]
  createdAt: string
}

// ===== 回款 =====

export type ReceivablePlanStatus = 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE'

export const RECEIVABLE_PLAN_STATUS_LABELS: Record<ReceivablePlanStatus, string> = {
  PENDING: '待回款',
  PARTIAL: '部分回款',
  PAID: '已回款',
  OVERDUE: '已逾期',
}

export interface ReceivablePlanVO {
  id: string
  contractId: string
  period: number
  amount: number
  paidAmount: number
  status: ReceivablePlanStatus
  dueDate: string
  remark: string | null
}

export interface ReceivableRecordVO {
  id: string
  contractId: string
  planId: string | null
  planPeriod?: number | null
  amount: number
  receivedAt: string
  method: string | null
  remark: string | null
  approvalStatus: string
  ownerName?: string | null
}

export const RECEIVABLE_METHODS = ['银行转账', '现金', '票据', '在线支付', '其他'] as const

// ===== 工商抬头与发票 =====

export interface InvoiceTitleVO {
  id: string
  customerId: string | null
  name: string
  taxNo: string
  bankName: string | null
  bankAccount: string | null
  address: string | null
  phone: string | null
}

export type InvoiceStatus = 'PENDING' | 'ISSUED' | 'VOID'

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: '待开票',
  ISSUED: '已开票',
  VOID: '已作废',
}

export const INVOICE_TYPES = ['增值税专用发票', '增值税普通发票', '电子发票'] as const

export interface InvoiceVO {
  id: string
  contractId: string
  titleId: string | null
  titleName?: string | null
  amount: number
  type: string
  status: InvoiceStatus
  invoiceNo: string | null
  issuedAt: string | null
  remark: string | null
}

// ===== 订单 =====

export type OrderStatus = 'PENDING' | 'DELIVERING' | 'ACCEPTED' | 'COMPLETED' | 'CANCELED'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: '待交付',
  DELIVERING: '交付中',
  ACCEPTED: '已验收',
  COMPLETED: '已完成',
  CANCELED: '已取消',
}

/** 订单状态机：允许的流转 */
export const ORDER_STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['DELIVERING', 'CANCELED'],
  DELIVERING: ['ACCEPTED', 'CANCELED'],
  ACCEPTED: ['COMPLETED'],
  COMPLETED: [],
  CANCELED: [],
}

export interface OrderVO {
  id: string
  code: string
  name: string
  contractId: string
  contractName?: string
  customerName?: string
  amount: number
  status: OrderStatus
  approvalStatus: string
  deliveredAt: string | null
  acceptedAt: string | null
  remark: string | null
  ownerId: string | null
  ownerName?: string | null
  customData: Record<string, unknown>
  createdAt: string
}
