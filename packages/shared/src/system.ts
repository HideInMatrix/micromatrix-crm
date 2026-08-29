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
  email: string | null
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
  passwordLoginEnabled: boolean
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
  authType: 'PASSWORD' | 'WECOM' | 'WECOM_OAUTH2'
  externalSubject: string | null
  ip: string | null
  userAgent: string | null
  success: boolean
  message: string | null
  createdAt: string
}

// ============ 企业集成 ============

export type EnterpriseIntegrationProvider = 'WECOM' | 'DINGTALK' | 'LARK'
export type OrganizationSyncStatus =
  'FETCHING' | 'PREVIEW_READY' | 'APPLYING' | 'SUCCEEDED' | 'FAILED' | 'INVALIDATED'

export interface EnterpriseIntegrationVO {
  id: string | null
  provider: EnterpriseIntegrationProvider
  configured: boolean
  corpId: string
  agentId: string
  secretConfigured: boolean
  credentialVersion: number
  syncEnabled: boolean
  syncDefaultRoleId: string | null
  lastTestSucceeded: boolean | null
  lastTestMessage: string | null
  lastTestedAt: string | null
  lastSyncStatus: OrganizationSyncStatus | null
  lastSyncMessage: string | null
  lastSyncedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface SaveWeComIntegrationInput {
  corpId: string
  agentId: string
  appSecret?: string
}

export interface WeComIntegrationSecretVO {
  appSecret: string
}

export interface WeComConnectionTestVO {
  success: boolean
  message: string
  providerCode: number | null
  integration: EnterpriseIntegrationVO
}

export interface UpdateWeComSyncInput {
  enabled: boolean
  defaultRoleId?: string
}

// ============ 企业微信统一登录 / 外部身份 ============

export interface WeComLoginDiscoveryVO {
  tenantSlug: string
  tenantName: string
  available: boolean
  reason: string | null
  corpId: string | null
  agentId: string | null
  loginPath: string
}

export interface WeComLoginStartInput {
  tenantSlug?: string
  returnPath?: string
}

export interface WeComLoginStartVO {
  authorizationUrl: string
  corpId: string
  agentId: string
  redirectUri: string
  state: string
  expiresAt: string
}

export interface WeComLoginCallbackInput {
  code: string
  state: string
}

export type ExternalIdentityStatus = 'ACTIVE' | 'REVOKED'

export interface ExternalIdentityVO {
  provider: 'WECOM'
  mapped: boolean
  externalSubject: string | null
  status: ExternalIdentityStatus | null
  boundAt: string | null
  revokedAt: string | null
  lastLoginAt: string | null
}

// ============ 企业微信组织同步 ============

export type OrganizationSyncResourceType = 'DEPARTMENT' | 'USER'
export type OrganizationSyncAction =
  'CREATE' | 'UPDATE' | 'DISABLE' | 'UNCHANGED' | 'CONFLICT' | 'SKIP'
export type OrganizationSyncItemResult = 'PENDING' | 'RESOLVED' | 'APPLIED' | 'SKIPPED' | 'FAILED'
export type OrganizationSyncResolution = 'BIND' | 'SKIP'

export interface OrganizationSyncCounts {
  create: number
  update: number
  disable: number
  unchanged: number
  conflict: number
  skip: number
  failed: number
}

export interface OrganizationSyncBatchVO {
  id: string
  provider: EnterpriseIntegrationProvider
  status: OrganizationSyncStatus
  targetDepartmentId: string
  credentialVersion: number
  counts: OrganizationSyncCounts
  errorCode: string | null
  errorMessage: string | null
  createdById: string
  appliedById: string | null
  fetchStartedAt: string | null
  previewedAt: string | null
  applyStartedAt: string | null
  finishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateOrganizationSyncPreviewInput {
  targetDepartmentId: string
}

export interface OrganizationSyncItemVO {
  id: string
  resourceType: OrganizationSyncResourceType
  externalId: string
  action: OrganizationSyncAction
  result: OrganizationSyncItemResult
  localId: string | null
  sourceData: Record<string, unknown>
  changes: Record<string, { before: unknown; after: unknown }> | null
  conflictType: string | null
  conflictMessage: string | null
  resolution: OrganizationSyncResolution | null
  resolvedLocalId: string | null
  errorMessage: string | null
}

export interface OrganizationSyncGateVO {
  configured: boolean
  verified: boolean
  enabled: boolean
  defaultRoleId: string | null
  disabledReason: string | null
  activeBatch: OrganizationSyncBatchVO | null
  latestBatch: OrganizationSyncBatchVO | null
}

export interface ResolveOrganizationSyncItemInput {
  itemId: string
  resolution: OrganizationSyncResolution
  localId?: string
}

export interface ResolveOrganizationSyncInput {
  items: ResolveOrganizationSyncItemInput[]
}

// ============ 通知 ============

export type NotificationBizType =
  'assign' | 'approval' | 'receivable' | 'pool' | 'follow_plan' | 'system'

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
  | 'price'
  | 'quote'
  | 'contract'
  | 'order'

export const MODULE_LABELS: Record<ModuleKey, string> = {
  lead: '线索',
  customer: '客户',
  contact: '联系人',
  opportunity: '商机',
  product: '产品',
  price: '价格表',
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
