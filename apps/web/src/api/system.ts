import type {
  DepartmentVO,
  LoginLogVO,
  MemberVO,
  NotificationVO,
  OperationLogVO,
  PageQuery,
  PaginatedResult,
  RoleVO,
} from '@micromatrix/shared'
import { http } from './http'

// ===== 部门 =====

export interface DepartmentForm {
  name: string
  parentId?: string
  leaderId?: string
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
  roleId?: string
  deptId?: string
  leaderId?: string
  position?: string
  phone?: string
}

export interface MemberOption {
  id: string
  name: string
  deptId: string | null
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
}

// ===== 角色 =====

export interface RoleForm {
  name: string
  permissions: string[]
  dataScope: string
  scopeDeptIds?: string[]
  remark?: string
}

export const roleApi = {
  list: () => http.get<RoleVO[]>('/roles'),
  create: (data: RoleForm) => http.post<RoleVO>('/roles', data),
  update: (id: string, data: Partial<RoleForm>) => http.patch<RoleVO>(`/roles/${id}`, data),
  remove: (id: string) => http.delete(`/roles/${id}`),
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

// ===== 企业设置 =====

export const settingApi = {
  get: () => http.get<Record<string, unknown>>('/settings'),
  update: (entries: Record<string, unknown>) => http.put('/settings', entries),
}
