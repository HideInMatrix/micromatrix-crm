import type {
  ExternalEventTemplateCreateInput,
  ExternalEventTemplateInput,
  ExternalEventTemplateVO,
} from '@micromatrix/shared'
import { http } from '@/api/http'

export interface ExternalEventPreviewVO {
  dryRun: true
  resolvedType: 'CUSTOMER' | 'LEAD' | null
  releasedFromPool?: boolean
  resolvedId: string
  action: string
  customerOwnerId?: string | null
  leadPoolId?: string | null
  /** Base Clue columns written by the lead-create action. */
  systemFieldUpdates?: { contact?: string; phone?: string }
  fieldUpdates: Record<string, unknown>
  note: string
}

export const externalEventTemplateApi = {
  list: () => http.get<ExternalEventTemplateVO[]>('/external-event-templates'),
  create: (input: ExternalEventTemplateCreateInput) =>
    http.post<ExternalEventTemplateVO>('/external-event-templates', input),
  update: (id: string, input: Partial<ExternalEventTemplateInput>) =>
    http.patch<ExternalEventTemplateVO>(`/external-event-templates/${id}`, input),
  remove: (id: string) => http.delete(`/external-event-templates/${id}`),
  preview: (id: string, data: Record<string, unknown>) =>
    http.post<ExternalEventPreviewVO>(`/external-event-templates/${id}/preview`, { data }),
}
