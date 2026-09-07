import type {
  FieldConfig,
  FieldOption,
  FieldType,
  FieldVO,
  ModuleFormProp,
  SubTableFieldType,
} from '@micromatrix/shared'
import { http } from '../http'

export interface SubFieldForm {
  id?: string
  key?: string
  label: string
  type: SubTableFieldType
  required?: boolean
  options?: FieldOption[]
  config?: FieldConfig
}

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
  mobile?: boolean
  subFields?: SubFieldForm[]
}

export interface ModuleFormConfigVO {
  formKey: string
  formProp: ModuleFormProp
  fields: FieldVO[]
}

export const metadataApi = {
  formConfig: (module: string) => http.get<ModuleFormConfigVO>(`/metadata/${module}/form`),
  updateFormProp: (module: string, data: Pick<ModuleFormProp, 'labelPos' | 'viewSize'>) =>
    http.patch<ModuleFormConfigVO>(`/metadata/${module}/form-prop`, data),
  fields: (module: string) => http.get<FieldVO[]>(`/metadata/${module}/fields`),
  createField: (module: string, data: FieldForm) =>
    http.post<FieldVO>(`/metadata/${module}/fields`, data),
  updateField: (id: string, data: Partial<FieldForm>) =>
    http.patch<FieldVO>(`/metadata/fields/${id}`, data),
  deleteField: (id: string) => http.delete(`/metadata/fields/${id}`),
  reorder: (module: string, orderedIds: string[]) =>
    http.post(`/metadata/${module}/fields/reorder`, { orderedIds }),
}
