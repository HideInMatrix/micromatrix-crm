import type {
  FieldVO,
  FollowTargetType,
  FollowUpVO,
  LeadVO,
  OpportunityVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from '../http'
import {
  createCustomer as createAccount,
  getCustomer as getAccount,
  listCustomers as listAccounts,
} from './customers'
import { contactApi, leadApi } from './sales'

export function fetchFields(module: string) {
  return http.get<FieldVO[]>(`/metadata/${module}/fields`)
}

export function listCustomers(params: PageQuery & { scope?: string }) {
  return listAccounts({ ...params, scope: params.scope === 'sea' ? 'sea' : undefined })
}

export function getCustomer(id: string, pool = false) {
  return getAccount(id, pool)
}

export function listCustomerContacts(customerId: string) {
  return contactApi.list(customerId)
}

export function createCustomer(data: Record<string, unknown>) {
  return createAccount(data)
}

export function listLeads(
  params: PageQuery & { scope?: string; status?: string; poolId?: string },
) {
  return leadApi.list({
    ...params,
    scope: params.scope === 'pool' ? 'pool' : 'mine',
  })
}

export function getLead(id: string) {
  return http.get<LeadVO>(`/lead/get/${id}`)
}

export function claimLead(id: string, poolId: string) {
  return leadApi.claim(id, poolId)
}

export function createLead(data: Record<string, unknown>) {
  return http.post<LeadVO>('/lead/add', data)
}

export function transformLead(data: { clueId: string; oppCreated?: boolean; oppName?: string }) {
  return http.post<{
    clueId: string
    customerId: string
    contactId: string | null
    opportunityId: string | null
  }>('/lead/transform', data)
}

export function getOpportunity(id: string) {
  return http.get<OpportunityVO>(`/opportunity/get/${id}`)
}

export function pageFollowUps(targetType: FollowTargetType, targetId: string) {
  return http.post<PaginatedResult<FollowUpVO>>('/follow-ups/page', {
    page: 1,
    pageSize: 100,
    targetType,
    targetId,
  })
}

export function createFollowUp(data: {
  targetType: string
  targetId: string
  type: string
  content: string
}) {
  return http.post('/follow-ups', data)
}

export interface MobileSummary {
  newLeads: number
  newCustomers: number
  newOpportunities: number
  wonAmount: number
  receivedAmount: number
  upcomingFollows: number
  overduePlans: number
}

export function dashboardSummary() {
  return http.get<MobileSummary>('/home/overview/summary')
}
