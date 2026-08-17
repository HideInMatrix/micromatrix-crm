import type {
  ApprovalInstanceVO,
  CustomerVO,
  FieldVO,
  FollowUpVO,
  LeadVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from '@/api/http'

export function fetchFields(module: string) {
  return http.get<FieldVO[]>(`/metadata/${module}/fields`)
}

export function listCustomers(params: PageQuery & { scope?: string }) {
  return http.get<PaginatedResult<CustomerVO>>('/customers', { params })
}

export function createCustomer(data: Record<string, unknown>) {
  return http.post<CustomerVO>('/customers', data)
}

export function listLeads(params: PageQuery & { scope?: string; status?: string }) {
  return http.get<PaginatedResult<LeadVO>>('/leads', { params })
}

export function claimLead(id: string) {
  return http.post(`/leads/${id}/claim`)
}

export function createLead(data: Record<string, unknown>) {
  return http.post<LeadVO>('/leads', data)
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
