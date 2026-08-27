import type {
  BatchUpdateMessageTaskSettingInput,
  DataScope,
  DepartmentVO,
  EnterpriseIntegrationVO,
  ExternalIdentityVO,
  LoginLogVO,
  MemberVO,
  MessageTaskConfig,
  MessageChannelGateVO,
  MessageDeliveryStatus,
  MessageDeliveryVO,
  MessageTaskGroupVO,
  MessageTaskSettingVO,
  ModuleConfigVO,
  NavigationModuleKey,
  NotificationVO,
  OperationLogVO,
  OrganizationSyncBatchVO,
  CreateOrganizationSyncPreviewInput,
  OrganizationSyncGateVO,
  OrganizationSyncItemVO,
  PageQuery,
  PaginatedResult,
  RoleVO,
  TopNavigationConfigVO,
  TopNavigationKey,
  UpdateMessageTaskSettingInput,
  SaveWeComIntegrationInput,
  WeComIntegrationSecretVO,
  WeComConnectionTestVO,
  UpdateWeComSyncInput,
  ResolveOrganizationSyncInput,
} from '@micromatrix/shared'
import { http } from './http'

// ===== 部门 =====

export interface DepartmentForm {
  name: string
  parentId?: string | null
  leaderId?: string | null
  sort?: number
}

export const deptApi = {
  tree: () => http.get<DepartmentVO[]>('/departments/tree'),
  create: (data: DepartmentForm) => http.post<DepartmentVO>('/departments', data),
  update: (id: string, data: Partial<DepartmentForm>) =>
    http.patch<DepartmentVO>(`/departments/${id}`, data),
  remove: (id: string) => http.delete(`/departments/${id}`),
}

// ===== 成员 =====

export interface MemberForm {
  email?: string
  name: string
  password?: string
  roleIds: string[]
  deptId?: string | null
  leaderId?: string | null
  position?: string
  phone?: string
}

export interface MemberOption {
  id: string
  name: string
  deptId: string | null
}

export interface RoleOption {
  id: string
  name: string
}

export const memberApi = {
  list: (params: PageQuery & { deptId?: string; status?: string }) =>
    http.get<PaginatedResult<MemberVO>>('/members', { params }),
  options: () => http.get<MemberOption[]>('/members/options'),
  create: (data: MemberForm) => http.post<MemberVO>('/members', data),
  update: (id: string, data: MemberForm) => http.patch<MemberVO>(`/members/${id}`, data),
  resetPassword: (id: string, password: string) =>
    http.post(`/members/${id}/reset-password`, { password }),
  toggleStatus: (id: string) => http.post(`/members/${id}/toggle-status`),
  remove: (id: string) => http.delete(`/members/${id}`),
}

export const externalIdentityApi = {
  getWeCom: (userId: string) =>
    http.get<ExternalIdentityVO>(`/external-identities/wecom/users/${userId}`),
  bindWeCom: (userId: string) =>
    http.post<ExternalIdentityVO>(`/external-identities/wecom/users/${userId}/bind`),
  unbindWeCom: (userId: string) =>
    http.post<ExternalIdentityVO>(`/external-identities/wecom/users/${userId}/unbind`),
}

// ===== 角色 =====

export interface RoleForm {
  name: string
  permissions: string[]
  dataScope: DataScope
  scopeDeptIds?: string[]
  remark?: string
}

export const roleApi = {
  list: () => http.get<RoleVO[]>('/roles'),
  options: () => http.get<RoleOption[]>('/roles/options'),
  create: (data: RoleForm) => http.post<RoleVO>('/roles', data),
  update: (id: string, data: Partial<RoleForm>) => http.patch<RoleVO>(`/roles/${id}`, data),
  remove: (id: string) => http.delete(`/roles/${id}`),
  members: (id: string, params?: PageQuery) =>
    http.get<PaginatedResult<MemberVO>>(`/roles/${id}/members`, { params }),
  addMembers: (id: string, userIds: string[]) => http.post(`/roles/${id}/members`, { userIds }),
  removeMember: (id: string, userId: string) => http.delete(`/roles/${id}/members/${userId}`),
}

// ===== 模块配置 =====

export const moduleConfigApi = {
  list: () => http.get<ModuleConfigVO[]>('/module-configs'),
  update: (moduleKey: NavigationModuleKey, enabled: boolean) =>
    http.patch<ModuleConfigVO>(`/module-configs/${moduleKey}`, { enabled }),
  reorder: (moduleKeys: NavigationModuleKey[]) =>
    http.post<ModuleConfigVO[]>('/module-configs/reorder', { moduleKeys }),
  listTopNavigation: () => http.get<TopNavigationConfigVO[]>('/module-configs/top-navigation'),
  reorderTopNavigation: (navigationKeys: TopNavigationKey[]) =>
    http.post<TopNavigationConfigVO[]>('/module-configs/top-navigation/reorder', {
      navigationKeys,
    }),
}

// ===== Cordys 模块字典（移池原因等） =====

export type DictionaryModule = 'CLUE_POOL_RS' | 'CUSTOMER_POOL_RS' | 'OPPORTUNITY_FAIL_RS'

export interface DictionaryItemVO {
  id: string
  name: string
  module: DictionaryModule
  type: string
  pos: number
  organizationId: string
  createTime: number
  updateTime: number
  createUser: string
  updateUser: string
}

export interface DictionaryConfigVO {
  dictList: DictionaryItemVO[]
  enable: boolean
}

export const dictionaryApi = {
  list: (module: DictionaryModule) => http.get<DictionaryItemVO[]>(`/dict/get/${module}`),
  config: (module: DictionaryModule) =>
    http.get<DictionaryConfigVO>(`/dict/config/${module}`),
  add: (module: DictionaryModule, name: string) =>
    http.post<DictionaryItemVO>('/dict/add', { module, name }),
  update: (id: string, name: string) => http.post<DictionaryItemVO>('/dict/update', { id, name }),
  remove: (id: string) => http.get(`/dict/delete/${id}`),
  toggle: (module: DictionaryModule, enable: boolean) =>
    http.post('/dict/switch', { module, enable }),
  sort: (start: number, end: number, dragDictId: string) =>
    http.post<DictionaryItemVO[]>('/dict/sort', { start, end, dragDictId }),
}

// ===== 日志 =====

export const logApi = {
  operations: (params: PageQuery & { module?: string }) =>
    http.get<PaginatedResult<OperationLogVO>>('/logs/operations', { params }),
  logins: (params: PageQuery) => http.get<PaginatedResult<LoginLogVO>>('/logs/logins', { params }),
}

// ===== 通知 =====

export const notificationApi = {
  list: (params: PageQuery & { unreadOnly?: boolean }) =>
    http.get<PaginatedResult<NotificationVO>>('/notifications', { params }),
  unreadCount: () => http.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => http.post(`/notifications/${id}/read`),
  markAllRead: () => http.post('/notifications/read-all'),
}

// ===== 消息设置 =====

export const messageSettingApi = {
  list: () => http.get<MessageTaskGroupVO[]>('/message-settings'),
  weComStatus: () => http.get<MessageChannelGateVO>('/message-settings/channels/wecom/status'),
  update: (event: string, data: UpdateMessageTaskSettingInput) =>
    http.patch<MessageTaskSettingVO>(`/message-settings/${event}`, data),
  batchUpdate: (data: BatchUpdateMessageTaskSettingInput) =>
    http.post<MessageTaskGroupVO[]>('/message-settings/batch', data),
  getConfig: (event: string) =>
    http.get<MessageTaskConfig | null>(`/message-settings/${event}/config`),
}

export const messageDeliveryApi = {
  list: (
    params: PageQuery & {
      status?: MessageDeliveryStatus
      event?: string
    },
  ) => http.get<PaginatedResult<MessageDeliveryVO>>('/message-deliveries', { params }),
  retry: (id: string) => http.post<MessageDeliveryVO>(`/message-deliveries/${id}/retry`),
}

export const enterpriseIntegrationApi = {
  getWeCom: () => http.get<EnterpriseIntegrationVO>('/enterprise-integrations/wecom'),
  getWeComSecret: () => http.get<WeComIntegrationSecretVO>('/enterprise-integrations/wecom/secret'),
  saveWeCom: (data: SaveWeComIntegrationInput) =>
    http.put<EnterpriseIntegrationVO>('/enterprise-integrations/wecom', data),
  testWeCom: (data: SaveWeComIntegrationInput) =>
    http.post<WeComConnectionTestVO>('/enterprise-integrations/wecom/test', data),
  updateWeComSync: (data: UpdateWeComSyncInput) =>
    http.put<EnterpriseIntegrationVO>('/enterprise-integrations/wecom/sync', data),
}

export const organizationSyncApi = {
  status: () => http.get<OrganizationSyncGateVO>('/organization-sync/wecom/status'),
  preview: (data: CreateOrganizationSyncPreviewInput) =>
    http.post<OrganizationSyncBatchVO>('/organization-sync/wecom/previews', data),
  batches: (params?: PageQuery & { status?: string }) =>
    http.get<PaginatedResult<OrganizationSyncBatchVO>>('/organization-sync/wecom/batches', {
      params,
    }),
  batch: (id: string) =>
    http.get<OrganizationSyncBatchVO>(`/organization-sync/wecom/batches/${id}`),
  items: (
    id: string,
    params?: PageQuery & { resourceType?: string; action?: string; keyword?: string },
  ) =>
    http.get<PaginatedResult<OrganizationSyncItemVO>>(
      `/organization-sync/wecom/batches/${id}/items`,
      { params },
    ),
  resolve: (id: string, data: ResolveOrganizationSyncInput) =>
    http.put<OrganizationSyncBatchVO>(`/organization-sync/wecom/batches/${id}/resolutions`, data),
  apply: (id: string) =>
    http.post<OrganizationSyncBatchVO>(`/organization-sync/wecom/batches/${id}/apply`),
}
