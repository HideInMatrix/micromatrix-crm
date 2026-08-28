import { http } from './http'

export type DashboardNodeType = 'MODULE' | 'DASHBOARD'

export interface DashboardScopeMember {
  id: string
  name: string
  type: 'USER' | 'DEPARTMENT'
}

export interface DashboardTreeNode {
  id: string
  name: string
  parentId: string
  type: DashboardNodeType
  pos: number
  resourceUrl?: string
  myCollect?: boolean
  children?: DashboardTreeNode[]
}

export interface DashboardVO {
  id: string
  name: string
  resourceUrl: string
  dashboardModuleId: string
  dashboardModuleName: string
  organizationId: string
  pos: number
  scopeId: string
  scopeIds: string[]
  members: DashboardScopeMember[]
  description: string | null
  createTime: number
  updateTime: number
  createUser: string
  updateUser: string
  createUserName: string
  updateUserName: string
  myCollect: boolean
}

export interface DashboardPageInput {
  current?: number
  pageSize?: number
  keyword?: string
  dashboardModuleIds?: string[]
  sort?: {
    name: 'create_time' | 'name' | 'dashboard_module_name' | 'create_user_name' | 'pos'
    type: 'asc' | 'desc'
  }
}

export interface DashboardPageResult {
  list: DashboardVO[]
  total: number
  current: number
  pageSize: number
}

export interface SaveDashboardInput {
  name: string
  resourceUrl: string
  dashboardModuleId: string
  scopeIds: string[]
  description?: string
}

export interface DashboardEmbedPolicy {
  dashboardId: string
  resourceUrl: string
  origin: string
  postMessageOrigin: string
  frameSrc: string[]
  csp: string
  sandbox: string
}

export const dashboardApi = {
  tree: () => http.get<DashboardTreeNode[]>('/dashboard/module/tree'),
  count: () => http.get<Record<string, number>>('/dashboard/module/count'),
  addModule: (input: { name: string; parentId: string }) =>
    http.post('/dashboard/module/add', input),
  renameModule: (input: { id: string; name: string }) =>
    http.post('/dashboard/module/rename', input),
  deleteModules: (ids: string[]) => http.post('/dashboard/module/delete', ids),
  moveModule: (input: { dragNodeId: string; dropNodeId: string; dropPosition: -1 | 0 | 1 }) =>
    http.post('/dashboard/module/move', input),

  page: (input: DashboardPageInput) => http.post<DashboardPageResult>('/dashboard/page', input),
  collectPage: (input: DashboardPageInput) =>
    http.post<DashboardPageResult>('/dashboard/collect/page', input),
  detail: (id: string) => http.get<DashboardVO>(`/dashboard/detail/${id}`),
  add: (input: SaveDashboardInput) => http.post<DashboardVO>('/dashboard/add', input),
  update: (input: SaveDashboardInput & { id: string }) =>
    http.post<DashboardVO>('/dashboard/update', input),
  rename: (input: { id: string; dashboardModuleId: string; name: string }) =>
    http.post<DashboardVO>('/dashboard/rename', input),
  remove: (id: string) => http.get(`/dashboard/delete/${id}`),
  collect: (id: string) => http.get(`/dashboard/collect/${id}`),
  unCollect: (id: string) => http.get(`/dashboard/un-collect/${id}`),
  move: (input: {
    dashboardModuleId: string
    moveId: string
    targetId: string
    moveMode: 'BEFORE' | 'AFTER' | 'APPEND'
  }) => http.post('/dashboard/edit/pos', input),
  embedPolicy: (id: string) =>
    http.get<DashboardEmbedPolicy>(`/dashboard/embed/policy/${id}`),
}
