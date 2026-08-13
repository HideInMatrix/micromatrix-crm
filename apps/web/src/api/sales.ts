import type {
  FollowUpVO,
  LeadVO,
  OpportunityStageVO,
  OpportunityVO,
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
  status?: string
  filters?: string
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
  toPool: (id: string) => http.post(`/leads/${id}/to-pool`),
  claim: (id: string) => http.post(`/leads/${id}/claim`),
  assign: (id: string, ownerId: string) => http.post(`/leads/${id}/assign`, { ownerId }),
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
  toSea: (id: string) => http.post(`/customers/${id}/to-sea`),
  claim: (id: string) => http.post(`/customers/${id}/claim`),
  assign: (id: string, ownerId: string) => http.post(`/customers/${id}/assign`, { ownerId }),
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
