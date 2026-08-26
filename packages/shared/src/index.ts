export * from './approval'
export * from './bidding'
export * from './deal'
export * from './home'
export * from './metadata'
export * from './message-settings'
export * from './permissions'
export * from './sales'
export * from './system'

import type { FollowUpVO, TeamMemberVO } from './sales'
import type { InvoiceStatus, OrderStatus, ReceivablePlanStatus } from './deal'

// ============ 通用分页 ============

export interface PageQuery {
  page?: number
  pageSize?: number
  keyword?: string
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ============ 认证 ============

export interface AuthTokens {
  accessToken: string
  refreshToken: string
}

export interface CurrentUser {
  id: string
  tenantId: string
  tenantName: string
  tenantSlug: string
  email: string | null
  name: string
  /** Cordys sys_user.gender：false=男，true=女。 */
  gender: boolean
  avatarUrl: string | null
  /** Cordys 默认密码提醒标记；修改密码成功后由服务端清除。 */
  defaultPwd: boolean
  roles: Array<{ id: string; name: string }>
  permissions: string[]
  deptId: string | null
  deptName: string | null
}

export interface LoginResult extends AuthTokens {
  user: CurrentUser
}

// ============ 兼容旧权限常量（逐步以 permissions.ts 的权限树为准） ============

export const PERMISSIONS = {
  ALL: '*',
  CUSTOMER_READ: 'menu:customer',
  CUSTOMER_WRITE: 'customer:update',
  USER_MANAGE: 'system:member',
  ROLE_MANAGE: 'system:role',
} as const

// ============ 业务视图对象 ============

export interface CustomerVO {
  id: string
  name: string
  industry: string | null
  phone: string | null
  email: string | null
  remark: string | null
  inSea: boolean
  poolId: string | null
  ownerId: string | null
  ownerName?: string | null
  deptId?: string | null
  /** 仅当当前用户是依靠协作关系访问该客户时返回；正常数据范围访问为 null/undefined。 */
  collaborationType?: 'READ_ONLY' | 'COLLABORATION' | null
  /** 详情接口返回的资源级能力；列表场景可省略。 */
  canManageCustomer?: boolean
  canCollaborateWrite?: boolean
  /** 自定义字段值（含计算字段的求值结果） */
  customData: Record<string, unknown>
  collectedAt: string | null
  poolEnteredAt: string | null
  lastFollowedAt: string | null
  createdAt: string
  updatedAt: string
}

export type DuplicateSource = 'customer' | 'contact' | 'lead' | 'opportunity'

export const DUPLICATE_SOURCE_LABELS: Record<DuplicateSource, string> = {
  customer: '客户',
  contact: '联系人',
  lead: '线索',
  opportunity: '商机',
}

export interface DuplicateHitVO {
  id: string
  source: DuplicateSource
  /** 不在数据范围内时为 null */
  name: string | null
  phone: string | null
  ownerName: string | null
  inSea: boolean
  inScope: boolean
}

export interface CustomerRelatedVO {
  stats: {
    opportunityCount: number
    opportunityAmount: number
    contractCount: number
    contractAmount: number
    paidAmount: number
  }
  contacts: {
    id: string
    name: string
    phone: string | null
  }[]
  opportunities: {
    id: string
    name: string
    amount: number | null
    stageName: string
    ownerName: string | null
    createdAt: string
  }[]
  contracts: {
    id: string
    name: string
    amount: number
    paidAmount: number
    status: string
    createdAt: string
  }[]
  followUps: FollowUpVO[]
  team: TeamMemberVO[]
}

export type Customer360Resource =
  'opportunities' | 'contracts' | 'receivablePlans' | 'receivableRecords' | 'invoices' | 'orders'

export interface Customer360OpportunityVO {
  id: string
  name: string
  amount: number | null
  stageName: string
  ownerName: string | null
  createdAt: string
}

export interface Customer360ContractVO {
  id: string
  code: string
  name: string
  amount: number
  paidAmount: number
  status: string
  approvalStatus: string
  ownerName: string | null
  createdAt: string
}

export interface Customer360ReceivablePlanVO {
  id: string
  contractId: string
  contractName: string
  period: number
  amount: number
  paidAmount: number
  status: ReceivablePlanStatus
  dueDate: string
  remark: string | null
}

export interface Customer360ReceivableRecordVO {
  id: string
  contractId: string
  contractName: string
  planId: string | null
  planPeriod: number | null
  amount: number
  receivedAt: string
  method: string | null
  remark: string | null
  approvalStatus: string
  ownerName: string | null
}

export interface Customer360InvoiceVO {
  id: string
  contractId: string
  contractName: string
  titleName: string | null
  amount: number
  type: string
  status: InvoiceStatus
  invoiceNo: string | null
  issuedAt: string | null
  remark: string | null
}

export interface Customer360OrderVO {
  id: string
  code: string
  name: string
  contractId: string
  contractName: string
  amount: number
  status: OrderStatus
  approvalStatus: string
  ownerName: string | null
  createdAt: string
}
