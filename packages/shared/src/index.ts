export * from './approval'
export * from './bidding'
export * from './deal'
export * from './metadata'
export * from './permissions'
export * from './sales'
export * from './system'

import type { FollowUpVO, TeamMemberVO } from './sales'

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
  email: string
  name: string
  roleName: string | null
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
  ownerId: string | null
  ownerName?: string | null
  deptId?: string | null
  /** 自定义字段值（含计算字段的求值结果） */
  customData: Record<string, unknown>
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
    position: string | null
    phone: string | null
    email: string | null
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
