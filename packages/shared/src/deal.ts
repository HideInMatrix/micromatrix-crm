// ============ 交易链路：产品 / 报价 / 合同 / 回款 / 发票 / 订单 ============

export type ProductStatus = '1' | '2'

export interface ProductVO {
  id: string
  name: string
  price: number | null
  status: ProductStatus
  pos: number
  customData: Record<string, unknown>
  createdAt: string
  updatedAt: string
  createUser: string
  updateUser: string
}

export type ProductPriceStatus = '1' | '2'

export interface ProductPriceItemVO {
  rowId: string
  bizId: string
  productId: string
  productName?: string
  amount: number
  values: Record<string, unknown>
}

export interface ProductPriceVO {
  id: string
  name: string
  status: ProductPriceStatus
  pos: number
  customData: Record<string, unknown>
  products: ProductPriceItemVO[]
  createdAt: string
  updatedAt: string
  createUser: string
  updateUser: string
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

// ===== 报价（Cordys Opportunity Quotation） =====

export type QuotationApprovalStatus =
  | 'NONE'
  | 'APPROVING'
  | 'APPROVED'
  | 'UNAPPROVED'
  | 'REVOKED'

export const QUOTATION_APPROVAL_STATUS_LABELS: Record<QuotationApprovalStatus, string> = {
  NONE: '未提审',
  APPROVING: '审批中',
  APPROVED: '审批通过',
  UNAPPROVED: '审批未通过',
  REVOKED: '已撤销',
}

export interface QuotationModuleFieldValue {
  fieldId: string
  fieldValue?: unknown
}

export interface QuotationProductVO {
  rowId: string
  bizId: string
  productId: string
  productName?: string
  priceId?: string | null
  priceName?: string | null
  productAmount: number
  discount: number
  tax: number
  amount: number
  values?: Record<string, unknown>
}

export interface QuoteVO {
  id: string
  name: string
  opportunityId: string
  opportunityName?: string
  departmentId?: string | null
  departmentName?: string | null
  amount: number
  approvalStatus: QuotationApprovalStatus
  invalid: boolean
  untilTime: number
  createUser: string
  updateUser: string
  createTime: number
  updateTime: number
  createUserName?: string | null
  updateUserName?: string | null
  moduleFields: QuotationModuleFieldValue[]
  products: QuotationProductVO[]
  firstApproved?: boolean
  approved: boolean
}

// ===== 合同 =====

export interface ContractModuleFieldValue {
  fieldId: string
  fieldValue?: unknown
}

export interface ContractProductVO {
  rowId: string
  bizId: string
  productId: string
  productName?: string
  productAmount: number
  productNumber: number
  amount: number
  values?: Record<string, unknown>
}

export interface ContractVO {
  id: string
  name: string
  customerId: string
  customerName?: string
  owner: string
  ownerName?: string | null
  departmentId?: string | null
  departmentName?: string | null
  amount: number
  number: string
  stage: string
  stageName?: string | null
  paidAmount: number
  invoicedAmount: number
  approvalStatus: string
  approved: boolean
  startTime: number | null
  endTime: number | null
  voidReason: string | null
  createUser: string
  updateUser: string
  createTime: number
  updateTime: number
  moduleFields: ContractModuleFieldValue[]
  products: ContractProductVO[]
  firstApproved?: boolean
}

// ===== 回款 =====

export type ContractPaymentPlanStatus = 'PENDING' | 'PARTIALLY_COMPLETED' | 'COMPLETED'

export const CONTRACT_PAYMENT_PLAN_STATUS_LABELS: Record<ContractPaymentPlanStatus, string> = {
  PENDING: '待处理',
  PARTIALLY_COMPLETED: '部分完成',
  COMPLETED: '已完成',
}

export interface ContractPaymentModuleFieldValue {
  fieldId: string
  fieldValue?: unknown
}

export interface ContractPaymentPlanVO {
  id: string
  name: string
  contractId: string
  contractName?: string
  customerId?: string
  owner: string
  ownerName?: string | null
  departmentId?: string | null
  departmentName?: string | null
  planStatus: ContractPaymentPlanStatus
  planAmount: number | null
  planEndTime: number | null
  createUser: string
  createUserName?: string | null
  updateUser: string
  updateUserName?: string | null
  createTime: number
  updateTime: number
  moduleFields: ContractPaymentModuleFieldValue[]
}

export interface ContractPaymentRecordVO {
  id: string
  name: string
  no: string | null
  contractId: string
  contractName?: string
  customerId?: string
  paymentPlanId: string | null
  paymentPlanName?: string | null
  owner: string
  ownerName?: string | null
  departmentId?: string | null
  departmentName?: string | null
  recordAmount: number | null
  recordEndTime: number | null
  createUser: string
  createUserName?: string | null
  updateUser: string
  updateUserName?: string | null
  createTime: number
  updateTime: number
  moduleFields: ContractPaymentModuleFieldValue[]
}

// ===== 工商抬头与发票 =====

export const INVOICE_TYPES = ['增值税专用发票', '增值税普通发票', '电子发票'] as const

export type ContractInvoiceApprovalStatus = QuotationApprovalStatus

export const CONTRACT_INVOICE_APPROVAL_STATUS_LABELS: Record<ContractInvoiceApprovalStatus, string> =
  QUOTATION_APPROVAL_STATUS_LABELS

export interface ContractInvoiceModuleFieldValue {
  fieldId: string
  fieldValue?: unknown
}

export interface ContractInvoiceVO {
  id: string
  name: string
  contractId: string
  contractName?: string
  customerId?: string
  owner: string
  ownerName?: string | null
  amount: number | null
  invoiceType: string | null
  taxRate: number | null
  approvalStatus: ContractInvoiceApprovalStatus | null
  businessTitleId: string | null
  businessTitleName?: string | null
  approved: boolean
  createTime: number
  updateTime: number
  moduleFields: ContractInvoiceModuleFieldValue[]
}

export interface BusinessTitleVO {
  id: string
  name: string
  type: 'CUSTOM' | 'THIRD_PARTY' | null
  identificationNumber: string | null
  openingBank: string | null
  bankAccount: string | null
  registrationAddress: string | null
  phoneNumber: string | null
  registeredCapital: string | null
  companySize: string | null
  registrationNumber: string | null
  approvalStatus: ContractInvoiceApprovalStatus | null
  unapprovedReason: string | null
  province: string | null
  city: string | null
  scale: string | null
  industry: string | null
  remark: string | null
  companyNumber: number
  createTime: number
  updateTime: number
  createUser: string
  updateUser: string
}

export interface BusinessTitleConfigVO {
  id: string
  field: string
  required: boolean
  organizationId: string
}

// ===== 订单 =====

export interface OrderProductVO {
  rowId: string
  bizId: string
  productId: string
  productName?: string
  productPrice: number
  productNumber: number
  amount: number
  values: Record<string, unknown>
}

export interface OrderModuleFieldValue {
  fieldId: string
  fieldValue?: unknown
}

export interface OrderVO {
  id: string
  number: string
  name: string
  customerId: string | null
  customerName?: string | null
  contractId: string | null
  contractName?: string | null
  owner: string | null
  ownerName?: string | null
  amount: number | null
  stage: string
  stageName?: string | null
  approvalStatus: string
  approved: boolean
  pos: number | null
  moduleFields: OrderModuleFieldValue[]
  products: OrderProductVO[]
  createTime: number
  updateTime: number
  organizationId: string
}
