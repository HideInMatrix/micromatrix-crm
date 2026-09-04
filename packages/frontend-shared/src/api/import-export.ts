import type { ExportTaskVO, ImportResultVO } from '@micromatrix/shared'
import { http } from '../http'

export type ImportType = 'ADD' | 'UPDATE'

export interface ExportCreatePayload {
  fileName: string
  headList: string[]
  ids?: string[]
}

export function createImportForm(file: File, importType: ImportType, poolId?: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('importType', importType)
  if (poolId) form.append('poolId', poolId)
  return form
}

export const exportTasksApi = {
  list: () => http.get<ExportTaskVO[]>('/export-tasks'),
  download: (id: string) =>
    http.get<Blob>(`/export-tasks/${id}/download`, { responseType: 'blob' }),
  remove: (id: string) => http.delete(`/export-tasks/${id}`),
}

export type ImportResult = ImportResultVO
