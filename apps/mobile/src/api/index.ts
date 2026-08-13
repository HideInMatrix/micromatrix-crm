import type {
  ApprovalInstanceVO,
  CurrentUser,
  CustomerVO,
  FieldVO,
  FollowUpVO,
  LeadVO,
  LoginResult,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from './http'

export function login(payload: { email: string; password: string }) {
  return http.post<LoginResult>('/auth/login', payload)
}

export function fetchMe() {
  return http.get<CurrentUser>('/auth/me')
}

export function fetchFields(module: string) {
  return http.get<FieldVO[]>(`/metadata/${module}/fields`)
}

// ===== 客户 =====

export function listCustomers(params: PageQuery & { scope?: string }) {
  return http.get<PaginatedResult<CustomerVO>>('/customers', { params })
}

export function createCustomer(data: Record<string, unknown>) {
  return http.post<CustomerVO>('/customers', data)
}

// ===== 线索 =====

export function listLeads(params: PageQuery & { scope?: string; status?: string }) {
  return http.get<PaginatedResult<LeadVO>>('/leads', { params })
}

export function claimLead(id: string) {
  return http.post(`/leads/${id}/claim`)
}

export function createLead(data: Record<string, unknown>) {
  return http.post<LeadVO>('/leads', data)
}

// ===== 跟进 =====

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

// ===== 审批 =====

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

// ===== 工作台 =====

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
