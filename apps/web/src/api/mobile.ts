import type {
  ApprovalInstanceVO,
  ContactVO,
  CustomerVO,
  FieldVO,
  FollowUpVO,
  LeadVO,
  OpportunityVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from '@/api/http'
import { leadApi } from '@/api/sales'

export function fetchFields(module: string) {
  return http.get<FieldVO[]>(`/metadata/${module}/fields`)
}

export function listCustomers(params: PageQuery & { scope?: string }) {
  return http.get<PaginatedResult<CustomerVO>>('/customers', { params })
}

export function getCustomer(id: string) {
  return http.get<CustomerVO>(`/customers/${id}`)
}

export function listCustomerContacts(customerId: string) {
  return http.get<ContactVO[]>(`/contacts/list/${customerId}`)
}

export function createCustomer(data: Record<string, unknown>) {
  return http.post<CustomerVO>('/customers', data)
}

export function listLeads(params: PageQuery & { scope?: string; status?: string; poolId?: string }) {
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
  return http.get<OpportunityVO>(`/opportunities/${id}`)
}

export function listFollowUps(targetType: string, targetId: string) {
  return http.get<FollowUpVO[]>('/follow-ups', { params: { targetType, targetId } })
}

export function createFollowUp(data: {
  targetType: string
  targetId: string
  type: string
  content: string
}) {
  return http.post('/follow-ups', data)
}

export function myPendingApprovals(params: PageQuery) {
  return http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-pending', { params })
}

export function myApplications(params: PageQuery) {
  return http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-applications', { params })
}

export function approveTask(taskId: string, comment?: string) {
  return http.post(`/approvals/tasks/${taskId}/approve`, { comment })
}

export function rejectTask(taskId: string, comment: string) {
  return http.post(`/approvals/tasks/${taskId}/reject`, { comment })
}

export interface MobileSummary {
  newLeads: number
  newCustomers: number
  newOpportunities: number
  wonAmount: number
  receivedAmount: number
  pendingApprovals: number
  upcomingFollows: number
  overduePlans: number
}

export function dashboardSummary() {
  return http.get<MobileSummary>('/dashboard/summary')
}
