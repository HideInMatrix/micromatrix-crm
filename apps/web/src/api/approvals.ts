import type {
  ApprovalFlowDetail,
  ApprovalFlowListItem,
  ApprovalFlowWriteInput,
  ApprovalFormType,
  ApprovalInstanceVO,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from './http'

export interface ApprovalFlowQuery extends PageQuery {
  formType?: ApprovalFormType
  enabled?: 'true' | 'false'
  sortBy?: 'number' | 'name' | 'formType' | 'enabled' | 'createdAt' | 'updatedAt'
  sortOrder?: 'asc' | 'desc'
}

export const approvalApi = {
  flows: (params: ApprovalFlowQuery) =>
    http.get<PaginatedResult<ApprovalFlowListItem>>('/approvals/flows', { params }),
  flowDetail: (id: string) => http.get<ApprovalFlowDetail>(`/approvals/flows/${id}`),
  createFlow: (data: ApprovalFlowWriteInput) =>
    http.post<ApprovalFlowDetail>('/approvals/flows', data),
  updateFlow: (id: string, data: Omit<ApprovalFlowWriteInput, 'formType'>) =>
    http.put<ApprovalFlowDetail>(`/approvals/flows/${id}`, data),
  updateFlowEnabled: (id: string, enabled: boolean) =>
    http.patch<{ id: string; name: string }>(`/approvals/flows/${id}/enabled`, { enabled }),
  removeFlow: (id: string) => http.delete<{ id: string; name: string }>(`/approvals/flows/${id}`),

  submit: (module: string, targetId: string) =>
    http.post('/approvals/submit', { module, targetId }),
  approve: (taskId: string, comment?: string) =>
    http.post(`/approvals/tasks/${taskId}/approve`, { comment }),
  reject: (taskId: string, comment: string) =>
    http.post(`/approvals/tasks/${taskId}/reject`, { comment }),
  sign: (
    taskId: string,
    data: { type: 'BEFORE' | 'AFTER'; signApprover: string; comment?: string },
  ) => http.post(`/approvals/tasks/${taskId}/sign`, data),
  cancel: (instanceId: string) => http.post(`/approvals/${instanceId}/cancel`),

  myPending: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-pending', { params }),
  myHandled: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-handled', { params }),
  myApplications: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-applications', { params }),
  myCopied: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-copied', { params }),
  instanceForTarget: (module: string, targetId: string) =>
    http.get<ApprovalInstanceVO | null>('/approvals/instance', { params: { module, targetId } }),
}
