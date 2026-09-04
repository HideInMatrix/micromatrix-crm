import type {
  ApprovalInstanceVO,
  FieldVO,
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

export function myHandledApprovals(params: PageQuery) {
  return http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-handled', { params })
}

export function approveTask(taskId: string, comment?: string, attachmentIds?: string[]) {
  return http.post(`/approvals/tasks/${taskId}/approve`, { comment, attachmentIds })
}

export function updateApprovalTaskFields(
  taskId: string,
  fields: Array<{ fieldId: string; value: unknown }>,
) {
  return http.patch<{ id: string; count: number }>(`/approvals/tasks/${taskId}/fields`, { fields })
}

export function getApprovalInstanceDetail(instanceId: string) {
  return http.get<ApprovalInstanceVO>(`/approvals/instances/${instanceId}`)
}

export function rejectTask(taskId: string, comment?: string, attachmentIds?: string[]) {
  return http.post(`/approvals/tasks/${taskId}/reject`, { comment, attachmentIds })
}

export function signTask(
  taskId: string,
  data: {
    type: 'BEFORE' | 'AFTER'
    signApprover: string
    comment?: string
    attachmentIds?: string[]
  },
) {
  return http.post(`/approvals/tasks/${taskId}/sign`, data)
}

export function returnBackTask(
  taskId: string,
  data: { returnToNodeId: string; comment?: string; attachmentIds?: string[] },
) {
  return http.post(`/approvals/tasks/${taskId}/back`, data)
}

export function revokeApprovalTask(taskId: string) {
  return http.post(`/approvals/tasks/${taskId}/revoke`)
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
  return http.get<MobileSummary>('/home/overview/summary')
}
