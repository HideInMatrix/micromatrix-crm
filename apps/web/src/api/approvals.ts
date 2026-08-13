import type {
  ApprovalFlowVO,
  ApprovalInstanceVO,
  ApprovalNodeConfig,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from './http'

export const approvalApi = {
  flows: () => http.get<ApprovalFlowVO[]>('/approvals/flows'),
  saveFlow: (data: {
    module: string
    name: string
    enabled: boolean
    condition?: { amountGte?: number }
    nodes: ApprovalNodeConfig[]
  }) => http.put('/approvals/flows', data),

  submit: (module: string, targetId: string) =>
    http.post('/approvals/submit', { module, targetId }),
  approve: (taskId: string, comment?: string) =>
    http.post(`/approvals/tasks/${taskId}/approve`, { comment }),
  reject: (taskId: string, comment: string) =>
    http.post(`/approvals/tasks/${taskId}/reject`, { comment }),
  cancel: (instanceId: string) => http.post(`/approvals/${instanceId}/cancel`),

  myPending: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-pending', { params }),
  myHandled: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-handled', { params }),
  myApplications: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-applications', { params }),
  instanceForTarget: (module: string, targetId: string) =>
    http.get<ApprovalInstanceVO | null>('/approvals/instance', { params: { module, targetId } }),
}
