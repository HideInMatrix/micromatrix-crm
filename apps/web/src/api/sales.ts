import type {
  FollowUpVO,
  LeadVO,
  OpportunityStageVO,
  OpportunityVO,
  OwnerHistoryVO,
  PageQuery,
  PaginatedResult,
  PoolRuleVO,
  StageLogVO,
  TeamMemberVO,
} from '@micromatrix/shared'
import { http } from './http'

// ===== 线索 =====

export interface LeadListParams extends PageQuery {
  scope?: 'mine' | 'pool'
  poolId?: string
  status?: string
  filters?: string
  viewId?: string
}

export interface ResourcePoolVO {
  id: string
  module: 'lead' | 'customer'
  name: string
  scopeIds: string[]
  managerIds: string[]
  enabled: boolean
  autoRecycle: boolean
  hiddenFieldIds: string[]
  pickRule?: {
    limitDailyPick: boolean
    dailyPickLimit: number | null
    limitPreviousOwner: boolean
    previousOwnerCooldownDays: number | null
    limitNewData: boolean
    newDataCooldownDays: number | null
  } | null
  recycleRule?: {
    operator: 'AND' | 'OR'
    conditions: ResourcePoolRecycleCondition[] | null
  } | null
}

export interface ResourcePoolRecycleCondition {
  column: 'storageTime' | 'followUpTime'
  operator: 'FIXED' | 'DYNAMICS'
  value: string
  scope?: ('Created' | 'Picked')[]
}

export interface ResourceCapacityVO {
  id: string
  module: 'lead' | 'customer'
  scopeIds: string[]
  capacity: number
  filters: Record<string, unknown>[] | null
}

export const resourcePoolApi = {
  options: (module: 'lead' | 'customer') =>
    http.get<ResourcePoolVO[]>('/resource-pools/options', { params: { module } }),
  list: (module: 'lead' | 'customer') =>
    http.get<ResourcePoolVO[]>('/resource-pools', { params: { module } }),
  create: (data: Record<string, unknown>) => http.post<ResourcePoolVO>('/resource-pools', data),
  update: (id: string, data: Record<string, unknown>) =>
    http.patch<ResourcePoolVO>(`/resource-pools/${id}`, data),
  toggle: (id: string) => http.post<ResourcePoolVO>(`/resource-pools/${id}/toggle`),
  remove: (id: string) => http.delete(`/resource-pools/${id}`),
}

export const resourceCapacityApi = {
  list: (module: 'lead' | 'customer') =>
    http.get<ResourceCapacityVO[]>('/resource-capacities', { params: { module } }),
  create: (data: Record<string, unknown>) =>
    http.post<ResourceCapacityVO>('/resource-capacities', data),
  update: (id: string, data: Record<string, unknown>) =>
    http.patch<ResourceCapacityVO>(`/resource-capacities/${id}`, data),
  remove: (id: string) => http.delete(`/resource-capacities/${id}`),
}

export const leadApi = {
  list: (params: LeadListParams) => http.get<PaginatedResult<LeadVO>>('/leads', { params }),
  import: (rows: Record<string, unknown>[]) =>
    http.post<{ success: number; failed: number; errors: string[] }>('/leads/import', { rows }),
  exportCsv: (params: LeadListParams) =>
    http.get<Blob>('/leads/export', { params, responseType: 'blob' }),
  create: (data: Record<string, unknown>) => http.post<LeadVO>('/leads', data),
  update: (id: string, data: Record<string, unknown>) => http.patch<LeadVO>(`/leads/${id}`, data),
  remove: (id: string) => http.delete(`/leads/${id}`),
  toPool: (id: string, poolId?: string) => http.post(`/leads/${id}/to-pool`, { poolId }),
  claim: (id: string) => http.post(`/leads/${id}/claim`),
  assign: (id: string, ownerId: string) => http.post(`/leads/${id}/assign`, { ownerId }),
  ownerHistory: (id: string) => http.get<OwnerHistoryVO[]>(`/leads/${id}/owner-history`),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue?: unknown }) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/leads/batch/update', data),
  batchDelete: (ids: string[]) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/leads/batch/delete', { ids }),
  poolBatchUpdate: (data: { poolId: string; ids: string[]; fieldId: string; fieldValue?: unknown }) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/leads/pool/batch/update', data),
  poolBatchDelete: (poolId: string, ids: string[]) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/leads/pool/batch/delete', {
      poolId,
      ids,
    }),
  markInvalid: (id: string) => http.post(`/leads/${id}/invalid`),
  convert: (id: string, data: { createContact?: boolean; opportunity?: { name: string; amount?: number } }) =>
    http.post<{ customerId: string; opportunityId: string | null }>(`/leads/${id}/convert`, data),
}

// ===== 跟进 =====

export const followUpApi = {
  list: (targetType: string, targetId: string) =>
    http.get<FollowUpVO[]>('/follow-ups', { params: { targetType, targetId } }),
  create: (data: {
    targetType: string
    targetId: string
    type: string
    content: string
    nextFollowAt?: string
  }) => http.post<FollowUpVO>('/follow-ups', data),
}

// ===== 商机 =====

export interface OpportunityListParams extends PageQuery {
  stageId?: string
  customerId?: string
  filters?: string
}

export const opportunityApi = {
  list: (params: OpportunityListParams) =>
    http.get<PaginatedResult<OpportunityVO>>('/opportunities', { params }),
  get: (id: string) => http.get<OpportunityVO>(`/opportunities/${id}`),
  kanban: () =>
    http.get<{ stages: OpportunityStageVO[]; items: Record<string, OpportunityVO[]> }>(
      '/opportunities/kanban',
    ),
  create: (data: Record<string, unknown>) => http.post<OpportunityVO>('/opportunities', data),
  update: (id: string, data: Record<string, unknown>) =>
    http.patch<OpportunityVO>(`/opportunities/${id}`, data),
  remove: (id: string) => http.delete(`/opportunities/${id}`),
  changeStage: (id: string, stageId: string, lostReason?: string) =>
    http.post(`/opportunities/${id}/stage`, { stageId, lostReason }),
  stageLogs: (id: string) => http.get<StageLogVO[]>(`/opportunities/${id}/stage-logs`),
  stages: () => http.get<OpportunityStageVO[]>('/opportunities/stages'),
  createStage: (data: { name: string; probability: number }) =>
    http.post<OpportunityStageVO>('/opportunities/stages', data),
  updateStage: (id: string, data: { name?: string; probability?: number }) =>
    http.patch<OpportunityStageVO>(`/opportunities/stages/${id}`, data),
  removeStage: (id: string) => http.delete(`/opportunities/stages/${id}`),
}

// ===== 联系人 =====

export interface ContactVO {
  id: string
  customerId: string
  ownerId: string | null
  deptId: string | null
  name: string
  position: string | null
  phone: string | null
  email: string | null
}

export const contactApi = {
  list: (customerId: string) => http.get<ContactVO[]>('/contacts', { params: { customerId } }),
  create: (data: Partial<ContactVO> & { customerId: string; name: string }) =>
    http.post<ContactVO>('/contacts', data),
  update: (id: string, data: Partial<ContactVO>) => http.patch<ContactVO>(`/contacts/${id}`, data),
  remove: (id: string) => http.delete(`/contacts/${id}`),
}

// ===== 客户公海/团队 =====

export const customerExtraApi = {
  toSea: (id: string, poolId?: string) => http.post(`/customers/${id}/to-sea`, { poolId }),
  claim: (id: string) => http.post(`/customers/${id}/claim`),
  assign: (id: string, ownerId: string) => http.post(`/customers/${id}/assign`, { ownerId }),
  ownerHistory: (id: string) => http.get<OwnerHistoryVO[]>(`/customers/${id}/owner-history`),
  teamList: (id: string) => http.get<TeamMemberVO[]>(`/customers/${id}/team`),
  teamAdd: (id: string, userId: string, role?: string) =>
    http.post(`/customers/${id}/team`, { userId, role }),
  teamRemove: (id: string, memberId: string) => http.delete(`/customers/${id}/team/${memberId}`),
}

// ===== 公海规则 =====

export const poolRuleApi = {
  list: () => http.get<PoolRuleVO[]>('/pool-rules'),
  update: (data: PoolRuleVO) => http.put('/pool-rules', data),
  runNow: () =>
    http.post<{ recycledLeads: number; recycledCustomers: number }>('/pool-rules/run-now'),
}
