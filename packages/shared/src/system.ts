import type { DataScope } from './permissions'

// ============ 组织架构 ============

export interface DepartmentVO {
  id: string
  name: string
  parentId: string | null
  leaderId: string | null
  leaderName?: string | null
  sort: number
  userCount?: number
  children?: DepartmentVO[]
}

export interface MemberVO {
  id: string
  email: string
  name: string
  status: 'ACTIVE' | 'DISABLED'
  roles: Array<{ id: string; name: string }>
  roleIds: string[]
  deptId: string | null
  deptName?: string | null
  leaderId: string | null
  leaderName?: string | null
  position: string | null
  phone: string | null
  createdAt: string
}

export interface RoleVO {
  id: string
  name: string
  permissions: string[]
  dataScope: DataScope
  scopeDeptIds: string[]
  isSystem: boolean
  remark: string | null
  userCount?: number
}

// ============ 日志 ============

export interface OperationLogVO {
  id: string
  userName: string | null
  module: string
  action: string
  targetName: string | null
  detail: unknown
  ip: string | null
  createdAt: string
}

export interface LoginLogVO {
  id: string
  email: string
  ip: string | null
  userAgent: string | null
  success: boolean
  message: string | null
  createdAt: string
}

// ============ 通知 ============

export type NotificationBizType = 'assign' | 'approval' | 'receivable' | 'pool' | 'system'

export type ExportTaskStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELED'

export interface ExportTaskVO {
  id: string
  module: string
  fileName: string
  status: ExportTaskStatus
  rowCount: number
  fileSize: number | null
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string
}

export interface ImportErrorVO {
  rowNum: number
  errMsg: string
}

export interface ImportResultVO {
  successCount: number
  failCount: number
  errorMessages: ImportErrorVO[]
}

export interface NotificationVO {
  id: string
  type: NotificationBizType
  title: string
  content: string | null
  link: string | null
  readAt: string | null
  createdAt: string
}

// ============ 模块（业务对象）标识 ============

export type ModuleKey =
  | 'lead'
  | 'customer'
  | 'contact'
  | 'opportunity'
  | 'product'
  | 'quote'
  | 'contract'
  | 'order'

export const MODULE_LABELS: Record<ModuleKey, string> = {
  lead: '线索',
  customer: '客户',
  contact: '联系人',
  opportunity: '商机',
  product: '产品',
  quote: '报价',
  contract: '合同',
  order: '订单',
}
