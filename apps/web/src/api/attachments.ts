import type { AttachmentVO } from '@micromatrix/shared'
import { http } from './http'

export const attachmentApi = {
  list: (targetType: string, targetId: string) =>
    http.get<AttachmentVO[]>('/attachments', { params: { targetType, targetId } }),

  upload: (file: File, targetType?: string, targetId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (targetType) form.append('targetType', targetType)
    if (targetId) form.append('targetId', targetId)
    return http.post<AttachmentVO>('/attachments/upload', form, { timeout: 60_000 })
  },

  download: async (id: string, name: string) => {
    const { data } = await http.get<Blob>(`/attachments/${id}/download`, {
      responseType: 'blob',
      timeout: 60_000,
    })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  },

  remove: (id: string) => http.delete(`/attachments/${id}`),
}
