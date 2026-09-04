import type { FieldConfig, FieldOption, FieldType, FieldVO } from '@micromatrix/shared'
import { http } from '../http'

export interface FieldForm {
  label: string
  type: FieldType
  required?: boolean
  options?: FieldOption[]
  config?: FieldConfig
  span?: number
  showInList?: boolean
  listWidth?: number
  hidden?: boolean
}

export const metadataApi = {
  fields: (module: string) => http.get<FieldVO[]>(`/metadata/${module}/fields`),
  createField: (module: string, data: FieldForm) =>
    http.post<FieldVO>(`/metadata/${module}/fields`, data),
  updateField: (id: string, data: Partial<FieldForm>) =>
    http.patch<FieldVO>(`/metadata/fields/${id}`, data),
  deleteField: (id: string) => http.delete(`/metadata/fields/${id}`),
  reorder: (module: string, orderedIds: string[]) =>
    http.post(`/metadata/${module}/fields/reorder`, { orderedIds }),
}
