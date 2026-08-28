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
  editable?: boolean
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
  createTime?: number
  updateTime?: number
  createUserName?: string | null
  updateUserName?: string | null
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
  capacity: number | null
  filters: Record<string, unknown>[] | null
}

export interface CluePoolApiVO {
  id: string
  name: string
  editable?: boolean
  scopeIds: string[]
  ownerIds: string[]
  enable: boolean
  auto: boolean
  hiddenFieldIds: string[]
  pickRule?: {
    limitOnNumber: boolean
    pickNumber: number | null
    limitPreOwner: boolean
    pickIntervalDays: number | null
    limitNew: boolean
    newPickInterval: number | null
  } | null
  recycleRule?: {
    operator: 'AND' | 'OR'
    conditions: ResourcePoolRecycleCondition[] | null
  } | null
  createTime?: number
  updateTime?: number
  createUserName?: string | null
  updateUserName?: string | null
}

interface ClueCapacityApiVO {
  id: string
  scopeIds: string[]
  capacity: number | null
}

function normalizeCluePool(pool: CluePoolApiVO): ResourcePoolVO {
  return {
    id: pool.id,
    module: 'lead',
    name: pool.name,
    editable: pool.editable ?? false,
    scopeIds: pool.scopeIds,
    managerIds: pool.ownerIds,
    enabled: pool.enable,
    autoRecycle: pool.auto,
    hiddenFieldIds: pool.hiddenFieldIds,
    pickRule: pool.pickRule
      ? {
          limitDailyPick: pool.pickRule.limitOnNumber,
          dailyPickLimit: pool.pickRule.pickNumber,
          limitPreviousOwner: pool.pickRule.limitPreOwner,
          previousOwnerCooldownDays: pool.pickRule.pickIntervalDays,
          limitNewData: pool.pickRule.limitNew,
          newDataCooldownDays: pool.pickRule.newPickInterval,
        }
      : null,
    recycleRule: pool.recycleRule ?? null,
    createTime: pool.createTime,
    updateTime: pool.updateTime,
    createUserName: pool.createUserName,
    updateUserName: pool.updateUserName,
  }
}

function normalizeCustomerPool(pool: CluePoolApiVO): ResourcePoolVO {
  return { ...normalizeCluePool(pool), module: 'customer' }
}

function cluePoolPayload(data: Record<string, unknown>) {
  const input = data as Partial<ResourcePoolVO>
  return {
    name: input.name ?? '',
    scopeIds: input.scopeIds ?? [],
    ownerIds: input.managerIds ?? [],
    enable: input.enabled ?? true,
    auto: input.autoRecycle ?? false,
    hiddenFieldIds: input.hiddenFieldIds ?? [],
    pickRule: {
      limitOnNumber: input.pickRule?.limitDailyPick ?? false,
      pickNumber: input.pickRule?.limitDailyPick ? (input.pickRule.dailyPickLimit ?? null) : null,
      limitPreOwner: input.pickRule?.limitPreviousOwner ?? false,
      pickIntervalDays: input.pickRule?.limitPreviousOwner
        ? (input.pickRule.previousOwnerCooldownDays ?? null)
        : null,
      limitNew: input.pickRule?.limitNewData ?? false,
      newPickInterval: input.pickRule?.limitNewData
        ? (input.pickRule.newDataCooldownDays ?? null)
        : null,
    },
    recycleRule: {
      operator: input.recycleRule?.operator ?? 'AND',
      conditions: input.recycleRule?.conditions ?? [],
    },
  }
}

export const resourcePoolApi = {
  options: async (module: 'lead' | 'customer') => {
    if (module === 'customer') {
      const response = await http.get<CluePoolApiVO[]>('/pool/account/options')
      return { ...response, data: response.data.map(normalizeCustomerPool) }
    }
    const response = await http.get<CluePoolApiVO[]>('/pool/lead/options')
    return { ...response, data: response.data.map(normalizeCluePool) }
  },
  list: async (module: 'lead' | 'customer') => {
    if (module === 'customer') {
      const response = await http.post<CordysPager<CluePoolApiVO>>('/account-pool/page', {
        current: 1,
        pageSize: 200,
      })
      return { ...response, data: response.data.list.map(normalizeCustomerPool) }
    }
    const response = await http.post<CordysPager<CluePoolApiVO>>('/lead-pool/page', {
      current: 1,
      pageSize: 200,
    })
    return { ...response, data: response.data.list.map(normalizeCluePool) }
  },
  leadSettingsPage: async (params?: { current?: number; pageSize?: number; keyword?: string }) => {
    const response = await http.post<CordysPager<CluePoolApiVO>>('/lead-pool/page', {
      current: params?.current ?? 1,
      pageSize: params?.pageSize ?? 20,
      keyword: params?.keyword,
    })
    return {
      ...response,
      data: { ...response.data, list: response.data.list.map(normalizeCluePool) },
    }
  },
  customerSettingsPage: async (params?: { current?: number; pageSize?: number; keyword?: string }) => {
    const response = await http.post<CordysPager<CluePoolApiVO>>('/account-pool/page', {
      current: params?.current ?? 1,
      pageSize: params?.pageSize ?? 20,
      keyword: params?.keyword,
    })
    return {
      ...response,
      data: { ...response.data, list: response.data.list.map(normalizeCustomerPool) },
    }
  },
  create: (data: Record<string, unknown>) => {
    if (data.module === 'lead') return http.post('/lead-pool/add', cluePoolPayload(data))
    return http.post('/account-pool/add', cluePoolPayload(data))
  },
  update: (id: string, data: Record<string, unknown>) => {
    if (data.module === 'lead') {
      return http.post('/lead-pool/update', { id, ...cluePoolPayload(data) })
    }
    return http.post('/account-pool/update', { id, ...cluePoolPayload(data) })
  },
  quickUpdate: (id: string, data: Record<string, unknown>) =>
    http.post('/lead-pool/quick-update', {
      id,
      ...cluePoolPayload({ ...data, module: 'lead' }),
    }),
  toggle: (id: string, module: 'lead' | 'customer') =>
    module === 'lead'
      ? http.get(`/lead-pool/switch/${id}`)
      : http.get(`/account-pool/switch/${id}`),
  remove: (id: string, module: 'lead' | 'customer') =>
    module === 'lead' ? http.get(`/lead-pool/delete/${id}`) : http.get(`/account-pool/delete/${id}`),
  noPickLead: (id: string) => http.get<boolean>(`/lead-pool/no-pick/${id}`),
  noPickCustomer: (id: string) => http.get<boolean>(`/account-pool/no-pick/${id}`),
}

export const resourceCapacityApi = {
  list: async (module: 'lead' | 'customer') => {
    if (module === 'customer') {
      const response = await http.get<
        Array<{
          id: string
          scopeIds: string[]
          capacity: number | null
          filters: Record<string, unknown>[]
        }>
      >('/account-capacity/get')
      return {
        ...response,
        data: response.data.map((item) => ({ ...item, module: 'customer' as const })),
      }
    }
    const response = await http.get<ClueCapacityApiVO[]>('/lead-capacity/get')
    return {
      ...response,
      data: response.data.map((item) => ({ ...item, module: 'lead' as const, filters: null })),
    }
  },
  create: (data: Record<string, unknown>) => {
    if (data.module === 'lead') {
      return http.post('/lead-capacity/add', { scopeIds: data.scopeIds, capacity: data.capacity })
    }
    return http.post('/account-capacity/add', {
      scopeIds: data.scopeIds,
      capacity: data.capacity,
      filters: data.filters,
    })
  },
  update: (id: string, data: Record<string, unknown>) => {
    if (data.module === 'lead') {
      return http.post('/lead-capacity/update', {
        id,
        scopeIds: data.scopeIds,
        capacity: data.capacity,
      })
    }
    return http.post('/account-capacity/update', {
      id,
      scopeIds: data.scopeIds,
      capacity: data.capacity,
      filters: data.filters,
    })
  },
  remove: (id: string, module: 'lead' | 'customer') =>
    module === 'lead'
      ? http.get(`/lead-capacity/delete/${id}`)
      : http.get(`/account-capacity/delete/${id}`),
}

export const leadApi = {
  list: (params: LeadListParams) => clueListRequest(params),
  get: (id: string, pool = false) =>
    http.get<LeadVO>(pool ? `/pool/lead/get/${id}` : `/lead/get/${id}`),
  poolOptions: () => resourcePoolApi.options('lead'),
  importTemplate: (importType: ImportType, poolId?: string) =>
    http.get<Blob>(poolId ? '/pool/lead/template/download' : '/lead/template/download', {
      params: { importType },
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
      { ...cluePageBody(params), ...data, ...(poolId ? { poolId } : {}) },
    ),
  exportSelected: (
    _params: LeadListParams,
    data: ExportCreatePayload & { ids: string[] },
    poolId?: string,
  ) =>
    http.post(poolId ? '/pool/lead/export-select' : '/lead/export-select', {
      ...data,
      ...(poolId ? { poolId } : {}),
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
  batchToPool: (ids: string[], poolId?: string, reasonId?: string) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/lead/batch/to-pool', {
      ids,
      poolId,
      reasonId,
    }),
  poolBatchPick: (poolId: string, batchIds: string[]) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/lead/batch-pick', {
      poolId,
      batchIds,
    }),
  poolBatchAssign: (poolId: string, batchIds: string[], assignUserId: string) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>('/pool/lead/batch-assign', {
      poolId,
      batchIds,
      assignUserId,
    }),
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

function parseContactFilters(raw?: string) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function contactPageBody(params: ContactListParams) {
  return {
    current: params.page ?? 1,
    pageSize: params.pageSize ?? 10,
    keyword: params.keyword,
    viewId: params.viewId,
    scopeView: params.scopeView,
    filters: parseContactFilters(params.filters),
  }
}

function toContactPayload(data: Partial<ContactVO> & { name?: string }) {
  const customData = data.customData ?? {}
  return {
    customerId: data.customerId || undefined,
    owner: data.ownerId || undefined,
    name: data.name,
    phone: data.phone ?? undefined,
    moduleFields: Object.entries(customData).map(([fieldId, fieldValue]) => ({
      fieldId,
      fieldValue,
    })),
  }
}

export const contactApi = {
  list: async (customerId: string): Promise<AxiosResponse<ContactVO[]>> => {
    const response = await http.get<{ list: ContactVO[] }>(`/account/contact/list/${customerId}`)
    return { ...response, data: response.data.list }
  },
  page: async (params: ContactListParams): Promise<AxiosResponse<PaginatedResult<ContactVO>>> => {
    const response = await http.post<CordysPager<ContactVO>>(
      '/account/contact/page',
      contactPageBody(params),
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
  },
  get: (id: string) => http.get<ContactVO>(`/account/contact/get/${id}`),
  create: (data: Partial<ContactVO> & { name: string; customerId?: string }) =>
    http.post<ContactVO>('/account/contact/add', toContactPayload(data)),
  update: (id: string, data: Partial<ContactVO>) =>
    http.post<ContactVO>('/account/contact/update', { id, ...toContactPayload(data) }),
  remove: (id: string) => http.get(`/account/contact/delete/${id}`),
  enable: (id: string) => http.get<ContactVO>(`/account/contact/enable/${id}`),
  disable: (id: string, reason: string) =>
    http.post<ContactVO>(`/account/contact/disable/${id}`, { reason }),
  checkOpportunity: (id: string) =>
    http.get<boolean>(`/account/contact/opportunity/check/${id}`),
  tab: () => http.get<{ all: boolean; dept: boolean }>('/account/contact/tab'),
  batchUpdate: (data: { ids: string[]; fieldId: string; fieldValue: unknown }) =>
    http.post<{ success: number; fail: number; failedIds: string[] }>(
      '/account/contact/batch/update',
      data,
    ),
  importTemplate: (_importType: ImportType) =>
    http.get<Blob>('/account/contact/template/download', { responseType: 'blob' }),
  importPrecheck: (file: File, importType: ImportType) =>
    http.post<ImportResult>('/account/contact/import/pre-check', createImportForm(file, importType)),
  importXlsx: (file: File, importType: ImportType) =>
    http.post<ImportResult>('/account/contact/import', createImportForm(file, importType)),
  exportAll: (params: ContactListParams, data: ExportCreatePayload) =>
    http.post('/account/contact/export-all', { ...contactPageBody(params), ...data }),
  exportSelected: (_params: ContactListParams, data: ExportCreatePayload & { ids: string[] }) =>
    http.post('/account/contact/export-select', data),
}

// ===== 客户公海/团队 =====

export const customerExtraApi = {
  toSea: (id: string, poolId?: string, reasonId?: string) =>
    http.post('/account/to-pool', { id, poolId, reasonId }),
  claim: (id: string, poolId: string) =>
    http.post('/pool/account/pick', { customerId: id, poolId }),
  assign: (id: string, ownerId: string, pool = false) =>
    pool
      ? http.post('/pool/account/assign', { customerId: id, assignUserId: ownerId })
      : http.post('/account/batch/transfer', { ids: [id], owner: ownerId }),
  ownerHistory: (id: string) =>
    http.get<OwnerHistoryVO[]>(`/account/owner/history/list/${id}`),
  teamList: (id: string) =>
    http.get<TeamMemberVO[]>(`/account/collaboration/list/${id}`),
  teamAdd: (
    id: string,
    userId: string,
    role?: string,
    collaborationType?: 'READ_ONLY' | 'COLLABORATION',
  ) =>
    http.post('/account/collaboration/add', {
      customerId: id,
      userId,
      role,
      collaborationType: collaborationType ?? 'COLLABORATION',
    }),
  teamUpdate: (_id: string, memberId: string, collaborationType: 'READ_ONLY' | 'COLLABORATION') =>
    http.post('/account/collaboration/update', { id: memberId, collaborationType }),
  teamRemove: (_id: string, memberId: string) =>
    http.get(`/account/collaboration/delete/${memberId}`),
}

// ===== 公海规则 =====

export const poolRuleApi = {
  list: () => http.get<PoolRuleVO[]>('/pool-rules'),
  update: (data: PoolRuleVO) => http.put('/pool-rules', data),
  runNow: () =>
    http.post<{ recycledLeads: number; recycledCustomers: number }>('/pool-rules/run-now'),
}
