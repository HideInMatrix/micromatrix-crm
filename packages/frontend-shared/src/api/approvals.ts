import type {
  ApprovalFlowDetail,
  ApprovalFlowListItem,
  ApprovalFlowWriteInput,
  ApprovalFormType,
  ApprovalInstanceVO,
  ApprovalWebhookConfig,
  PageQuery,
  PaginatedResult,
} from '@micromatrix/shared'
import { http } from '../http'

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
  testWebhook: (data: ApprovalWebhookConfig) =>
    http.post<{ ok: boolean; httpStatus: number; responseBytes: number; durationMs: number }>(
      '/approvals/flows/webhook/test',
      data,
    ),

  submit: (module: string, targetId: string) =>
    http.post('/approvals/submit', { module, targetId }),
  approve: (taskId: string, comment?: string, attachmentIds?: string[]) =>
    http.post(`/approvals/tasks/${taskId}/approve`, { comment, attachmentIds }),
  reject: (taskId: string, comment?: string, attachmentIds?: string[]) =>
    http.post(`/approvals/tasks/${taskId}/reject`, { comment, attachmentIds }),
  updateTaskFields: (taskId: string, fields: Array<{ fieldId: string; value: unknown }>) =>
    http.patch<{ id: string; count: number }>(`/approvals/tasks/${taskId}/fields`, { fields }),
  sign: (
    taskId: string,
    data: {
      type: 'BEFORE' | 'AFTER'
      signApprover: string
      comment?: string
      attachmentIds?: string[]
    },
  ) => http.post(`/approvals/tasks/${taskId}/sign`, data),
  back: (
    taskId: string,
    data: { returnToNodeId: string; comment?: string; attachmentIds?: string[] },
  ) => http.post(`/approvals/tasks/${taskId}/back`, data),
  revokeTask: (taskId: string) => http.post(`/approvals/tasks/${taskId}/revoke`),
  cancel: (instanceId: string) => http.post(`/approvals/${instanceId}/cancel`),

  myPending: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-pending', { params }),
  myHandled: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-handled', { params }),
  myApplications: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-applications', { params }),
  myCopied: (params: PageQuery) =>
    http.get<PaginatedResult<ApprovalInstanceVO>>('/approvals/my-copied', { params }),
  instanceDetail: (id: string) => http.get<ApprovalInstanceVO>(`/approvals/instances/${id}`),
  instanceForTarget: (module: string, targetId: string) =>
    http.get<ApprovalInstanceVO | null>('/approvals/instance', { params: { module, targetId } }),
}
