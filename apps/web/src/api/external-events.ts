import type { ExternalEventTemplateInput, ExternalEventTemplateVO } from '@micromatrix/shared'
import { http } from '@/api/http'

export interface ExternalEventPreviewVO {
  dryRun: true
  resolvedType: 'CUSTOMER' | 'LEAD'
  resolvedId: string
  action: string
  customerOwnerId: string | null
  fieldUpdates: Record<string, unknown>
  note: string
}

export const externalEventTemplateApi = {
  list: () => http.get<ExternalEventTemplateVO[]>('/external-event-templates'),
  create: (input: ExternalEventTemplateInput) =>
    http.post<ExternalEventTemplateVO>('/external-event-templates', input),
  update: (id: string, input: Partial<ExternalEventTemplateInput>) =>
    http.patch<ExternalEventTemplateVO>(`/external-event-templates/${id}`, input),
  remove: (id: string) => http.delete(`/external-event-templates/${id}`),
  preview: (id: string, data: Record<string, unknown>) =>
    http.post<ExternalEventPreviewVO>(`/external-event-templates/${id}/preview`, { data }),
}
