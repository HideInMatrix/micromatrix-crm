import type {
  ContactVO,
  FollowUpPlanStatus,
  FollowUpPlanTargetType,
  FollowUpPlanVO,
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
import type { AxiosResponse } from 'axios'
import { http } from './http'
import {
  createImportForm,
  type ExportCreatePayload,
  type ImportResult,
  type ImportType,
} from './import-export'

export type { ContactVO } from '@micromatrix/shared'

// ===== 线索 =====

export interface LeadListParams extends PageQuery {
  scope?: 'mine' | 'pool'
  poolId?: string
  status?: string
  filters?: string
  viewId?: string
  homeFilter?: string
}

interface CordysPager<T> {
  list: T[]
  total: number
  pageSize: number
  current: number
  optionMap?: Record<string, unknown>
}

function parseLeadFilters(raw?: string) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function cluePageBody(params: LeadListParams) {
  const filters = parseLeadFilters(params.filters)
  if (params.status) filters.push({ key: 'stage', op: 'eq', value: params.status })
  return {
    current: params.page ?? 1,
    pageSize: params.pageSize ?? 10,
    keyword: params.keyword,
    viewId: params.viewId,
    homeFilter: params.homeFilter,
    filters,
  }
}

async function clueListRequest(params: LeadListParams): Promise<AxiosResponse<PaginatedResult<LeadVO>>> {
  const poolMode = params.scope === 'pool'
  const response = await http.post<CordysPager<LeadVO>>(
    poolMode ? '/pool/lead/page' : '/lead/page',
    poolMode ? { ...cluePageBody(params), poolId: params.poolId } : cluePageBody(params),
  )
  return {
    ...response,
    data: {
      items: response.data.list,
      total: response.data.total,
      page: response.data.current,
      pageSize: response.data.pageSize,
    },
  }
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
  list: (params: LeadListParams) => clueListRequest(params),
  poolOptions: () => http.get<ResourcePoolVO[]>('/pool/lead/options'),
  importTemplate: (importType: ImportType, poolId?: string) =>
    http.get<Blob>(poolId ? '/pool/lead/template/download' : '/lead/template/download', {
      params: { importType, poolId },
      responseType: 'blob',
    }),
  importPrecheck: (file: File, importType: ImportType, poolId?: string) =>
    http.post<ImportResult>(
      poolId ? '/pool/lead/import/pre-check' : '/lead/import/pre-check',
      createImportForm(file, importType, poolId),
    ),
  importXlsx: (file: File, importType: ImportType, poolId?: string) =>
    http.post<ImportResult>(
      poolId ? '/pool/lead/import' : '/lead/import',
      createImportForm(file, importType, poolId),
    ),
  exportAll: (params: LeadListParams, data: ExportCreatePayload, poolId?: string) =>
    http.post(
      poolId ? '/pool/lead/export-all' : '/lead/export',
      { ...cluePageBody(params), ...data },
      { params: poolId ? { poolId } : undefined },
    ),
  exportSelected: (
    _params: LeadListParams,
    data: ExportCreatePayload & { ids: string[] },
    poolId?: string,
  ) =>
    http.post(poolId ? '/pool/lead/export-select' : '/lead/export-select', data, {
      params: poolId ? { poolId } : undefined,
    }),
  create: (data: Record<string, unknown>) => http.post<LeadVO>('/lead/add', data),
  update: (id: string, data: Record<string, unknown>) =>
    http.post<LeadVO>('/lead/update', { id, ...data }),
  remove: (id: string) => http.get(`/lead/delete/${id}`),
  toPool: (id: string, poolId?: string, reasonId?: string) =>
    http.post('/lead/to-pool', { id, poolId, reasonId }),
  claim: (id: string, poolId: string) =>
    http.post('/pool/lead/pick', { clueId: id, poolId }),
  transfer: (id: string, owner: string) =>
    http.post('/lead/batch/transfer', { ids: [id], owner }),
  poolAssign: (id: string, assignUserId: string) =>
    http.post('/pool/lead/assign', { clueId: id, assignUserId }),
  ownerHistory: (id: string) =>
    http.get<OwnerHistoryVO[]>(`/lead/owner/history/list/${id}`),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue?: unknown }) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/lead/batch/update', data),
  batchTransfer: (ids: string[], owner: string) =>
    http.post<{ count: number }>('/lead/batch/transfer', { ids, owner }),
  batchDelete: (ids: string[]) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/lead/batch/delete', ids),
  poolBatchUpdate: (data: {
    poolId: string
    ids: string[]
    fieldId: string
    fieldValue?: unknown
  }) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>(
      '/pool/lead/batch-update',
      data,
    ),
  poolBatchDelete: (poolId: string, ids: string[]) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/lead/batch-delete', {
      poolId,
      ids,
    }),
  markFailed: (id: string) => http.post('/lead/status/update', { id, stage: 'FAIL' }),
  transform: (data: { clueId: string; oppCreated?: boolean; oppName?: string }) =>
    http.post<{
      clueId: string
      customerId: string
      contactId: string | null
      opportunityId: string | null
    }>('/lead/transform', data),
  transitionCustomer: (data: Record<string, unknown> & { clueId: string }) =>
    http.post<{ clueId: string; customerId: string; contactId: string | null }>(
      '/lead/transition/account',
      data,
    ),
  retransitionCustomer: (data: { clueIds: string[]; customerId: string }) =>
    http.post<{ customerId: string; success: number; skippedIds: string[]; contactIds: string[] }>(
      '/lead/re-transition/account',
      data,
    ),
  transitionCustomerList: (data: {
    page: number
    pageSize: number
    keyword?: string
    filters?: string
  }) =>
    http.post<{
      items: Array<{
        id: string
        name: string
        industry: string | null
        phone: string | null
        email: string | null
        remark: string | null
        ownerId: string | null
        ownerName: string | null
        deptId: string | null
        inSea: boolean
        poolId: string | null
        lastFollowedAt: string | null
        customData: Record<string, unknown>
        createdAt: string
        updatedAt: string
        collaborationType: 'READ_ONLY' | 'COLLABORATION' | null
        selectable: boolean
      }>
      total: number
      page: number
      pageSize: number
    }>('/lead/transition/account/page', {
      current: data.page,
      pageSize: data.pageSize,
      keyword: data.keyword,
      filters: parseLeadFilters(data.filters),
    }),
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

export interface FollowUpPlanListParams extends PageQuery {
  targetType?: FollowUpPlanTargetType
  targetId?: string
  status?: FollowUpPlanStatus
  mine?: boolean
}

export interface FollowUpPlanPayload {
  targetType: FollowUpPlanTargetType
  targetId: string
  contactId?: string
  content: string
  method?: string
  estimatedAt?: string
  ownerId?: string
  customData?: Record<string, unknown>
}

export const followUpPlanApi = {
  list: (params: FollowUpPlanListParams) =>
    http.get<PaginatedResult<FollowUpPlanVO>>('/follow-up-plans', { params }),
  get: (id: string) => http.get<FollowUpPlanVO>(`/follow-up-plans/${id}`),
  create: (data: FollowUpPlanPayload) => http.post<FollowUpPlanVO>('/follow-up-plans', data),
  update: (id: string, data: Partial<FollowUpPlanPayload>) =>
    http.patch<FollowUpPlanVO>(`/follow-up-plans/${id}`, data),
  updateStatus: (id: string, status: FollowUpPlanStatus) =>
    http.post<FollowUpPlanVO>(`/follow-up-plans/${id}/status`, { status }),
  convert: (id: string) => http.post<FollowUpPlanVO>(`/follow-up-plans/${id}/convert`),
  remove: (id: string) => http.delete(`/follow-up-plans/${id}`),
}

// ===== 商机 =====

export interface OpportunityListParams extends PageQuery {
  stageId?: string
  customerId?: string
  filters?: string
  homeFilter?: string
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

export interface ContactListParams extends PageQuery {
  customerId?: string
  enable?: 'true' | 'false'
  filters?: string
  viewId?: string
  scopeView?: 'SELF' | 'DEPT' | 'ALL'
}

export const contactApi = {
  list: (customerId: string) => http.get<ContactVO[]>(`/contacts/list/${customerId}`),
  page: (params: ContactListParams) =>
    http.post<PaginatedResult<ContactVO>>('/contacts/page', params),
  get: (id: string) => http.get<ContactVO>(`/contacts/get/${id}`),
  create: (data: Partial<ContactVO> & { customerId: string; name: string }) =>
    http.post<ContactVO>('/contacts/add', data),
  update: (id: string, data: Partial<ContactVO>) =>
    http.post<ContactVO>('/contacts/update', { id, ...data }),
  remove: (id: string) => http.get(`/contacts/delete/${id}`),
  enable: (id: string) => http.get<ContactVO>(`/contacts/enable/${id}`),
  disable: (id: string, reason: string) =>
    http.post<ContactVO>(`/contacts/disable/${id}`, { reason }),
  checkOpportunity: (id: string) =>
    http.get<{ linked: boolean; count: number }>(`/contacts/opportunity/check/${id}`),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/contacts/tab'),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>(
      '/contacts/batch/update',
      data,
    ),
  importTemplate: (_importType: ImportType) =>
    http.get<Blob>('/contacts/template/download', { responseType: 'blob' }),
  importPrecheck: (file: File, importType: ImportType) =>
    http.post<ImportResult>('/contacts/import/pre-check', createImportForm(file, importType)),
  importXlsx: (file: File, importType: ImportType) =>
    http.post<ImportResult>('/contacts/import', createImportForm(file, importType)),
  exportAll: (params: ContactListParams, data: ExportCreatePayload) =>
    http.post('/contacts/export-all', { ...params, ...data }),
  exportSelected: (params: ContactListParams, data: ExportCreatePayload & { ids: string[] }) =>
    http.post('/contacts/export-select', { ...params, ...data }),
}

// ===== 客户公海/团队 =====

export const customerExtraApi = {
  toSea: (id: string, poolId?: string) => http.post(`/customers/${id}/to-sea`, { poolId }),
  claim: (id: string) => http.post(`/customers/${id}/claim`),
  assign: (id: string, ownerId: string) => http.post(`/customers/${id}/assign`, { ownerId }),
  ownerHistory: (id: string) => http.get<OwnerHistoryVO[]>(`/customers/${id}/owner-history`),
  teamList: (id: string) => http.get<TeamMemberVO[]>(`/customers/${id}/team`),
  teamAdd: (
    id: string,
    userId: string,
    role?: string,
    collaborationType?: 'READ_ONLY' | 'COLLABORATION',
  ) => http.post(`/customers/${id}/team`, { userId, role, collaborationType }),
  teamUpdate: (id: string, memberId: string, collaborationType: 'READ_ONLY' | 'COLLABORATION') =>
    http.patch(`/customers/${id}/team/${memberId}`, { collaborationType }),
  teamRemove: (id: string, memberId: string) => http.delete(`/customers/${id}/team/${memberId}`),
}

// ===== 公海规则 =====

export const poolRuleApi = {
  list: () => http.get<PoolRuleVO[]>('/pool-rules'),
  update: (data: PoolRuleVO) => http.put('/pool-rules', data),
  runNow: () =>
    http.post<{ recycledLeads: number; recycledCustomers: number }>('/pool-rules/run-now'),
}
