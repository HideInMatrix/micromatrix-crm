export * from './approval'
export * from './bidding'
export * from './deal'
export * from './metadata'
export * from './permissions'
export * from './sales'
export * from './system'

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
