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

export type NotificationBizType =
  | 'assign'
  | 'approval'
  | 'receivable'
  | 'pool'
  | 'follow_plan'
  | 'system'

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

// ============ 主导航模块配置 ============

export type NavigationModuleKey =
  | 'home'
  | 'lead'
  | 'customer'
  | 'opportunity'
  | 'product'
  | 'dashboard'
  | 'agent'
  | 'contract'
  | 'customForm'
  | 'bidding'
  | 'order'
  | 'system'

export interface NavigationModuleDefinition {
  key: NavigationModuleKey
  label: string
  defaultEnabled: boolean
  configurable: boolean
}

/** 顺序与当前 Cordys 实例的主导航配置一致。 */
export const NAVIGATION_MODULES: NavigationModuleDefinition[] = [
  { key: 'home', label: '首页', defaultEnabled: true, configurable: true },
  { key: 'lead', label: '线索', defaultEnabled: true, configurable: true },
  { key: 'customer', label: '客户', defaultEnabled: true, configurable: true },
  { key: 'opportunity', label: '商机', defaultEnabled: false, configurable: true },
  { key: 'product', label: '产品', defaultEnabled: false, configurable: true },
  { key: 'dashboard', label: '仪表板', defaultEnabled: true, configurable: true },
  { key: 'agent', label: '智能体', defaultEnabled: false, configurable: false },
  { key: 'contract', label: '合同', defaultEnabled: false, configurable: true },
  { key: 'customForm', label: '自定义表单', defaultEnabled: true, configurable: true },
  { key: 'bidding', label: '标讯', defaultEnabled: false, configurable: true },
  { key: 'order', label: '订单', defaultEnabled: true, configurable: true },
  { key: 'system', label: '系统', defaultEnabled: true, configurable: false },
]

export interface ModuleConfigVO {
  id: string
  moduleKey: NavigationModuleKey
  enabled: boolean
  sort: number
  configurable: boolean
}

// ============ 顶部导航配置 ============

export type TopNavigationKey =
  'search' | 'task' | 'event' | 'agent' | 'notify' | 'about' | 'language' | 'help'

export type TopNavigationCapabilityStatus = 'available' | 'planned' | 'excluded'

export interface TopNavigationDefinition {
  key: TopNavigationKey
  label: string
  defaultEnabled: boolean
  status: TopNavigationCapabilityStatus
  requiredPermission?: string
}

/**
 * 顺序来自 Cordys sys_navigation 的 1.2.1、1.2.3、1.7.1 迁移叠加结果。
 * status 描述 MicroMatrix 当前迁移状态，不改变 Cordys 的持久化 key。
 */
export const TOP_NAVIGATION_DEFINITIONS: TopNavigationDefinition[] = [
  { key: 'search', label: '搜索', defaultEnabled: true, status: 'planned' },
  {
    key: 'task',
    label: '待办',
    defaultEnabled: true,
    status: 'available',
    requiredPermission: 'menu:approval',
  },
  { key: 'event', label: '记录/计划', defaultEnabled: true, status: 'available' },
  { key: 'agent', label: '智能体', defaultEnabled: true, status: 'excluded' },
  { key: 'notify', label: '消息通知', defaultEnabled: true, status: 'available' },
  { key: 'about', label: '关于', defaultEnabled: true, status: 'available' },
  { key: 'language', label: '语言', defaultEnabled: true, status: 'planned' },
  { key: 'help', label: '帮助中心', defaultEnabled: true, status: 'available' },
]

export interface TopNavigationConfigVO {
  id: string
  navigationKey: TopNavigationKey
  enabled: boolean
  sort: number
}
