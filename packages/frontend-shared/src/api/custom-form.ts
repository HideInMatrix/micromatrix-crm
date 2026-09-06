import type {
  CustomFormDataPageVO,
  CustomFormDataDetailVO,
  CustomFormDataVO,
  CustomFormDetailVO,
  CustomFormListVO,
  CustomFormRoleKey,
  CustomFormRoleVO,
  DataSourceOptionVO,
  DataSourcePageVO,
  ExportTaskVO,
  FieldVO,
  FilterCondition,
  ImportResultVO,
  SaveCustomFormDataInput,
  SaveCustomFormInput,
} from '@micromatrix/shared'
import { http } from '../http'
import { createImportForm, type ExportCreatePayload, type ImportType } from './import-export'
import type { FieldForm } from './metadata'

export const customFormApi = {
  list: () => http.get<CustomFormListVO[]>('/custom-form/list'),
  options: () => http.get<Array<{ id: string; name: string }>>('/custom-form/options'),
  detail: (id: string) => http.get<CustomFormDetailVO>(`/custom-form/${id}`),
  create: (data: SaveCustomFormInput) => http.post<CustomFormDetailVO>('/custom-form', data),
  update: (id: string, data: SaveCustomFormInput) =>
    http.put<CustomFormDetailVO>(`/custom-form/${id}`, data),
  status: (id: string, enable: boolean) =>
    http.patch<{ id: string; enable: boolean }>(`/custom-form/${id}/status`, { enable }),
  remove: (id: string) => http.delete<{ id: string }>(`/custom-form/${id}`),
  admins: (id: string) =>
    http.get<Array<{ id: string; name: string }>>(`/custom-form/${id}/admins`),
  setAdmins: (id: string, userIds: string[]) =>
    http.put<Array<{ id: string; name: string }>>(`/custom-form/${id}/admins`, { userIds }),
  roles: (id: string) => http.get<CustomFormRoleVO[]>(`/custom-form/${id}/roles`),
  setRoleUsers: (id: string, roleKey: CustomFormRoleKey, userIds: string[]) =>
    http.put<CustomFormRoleVO[]>(`/custom-form/${id}/roles/users`, { roleKey, userIds }),
  config: (id: string) =>
    http.get<{ formKey: string; formProp: Record<string, unknown>; fields: FieldVO[] }>(
      `/custom-form/${id}/form-config`,
    ),
  createField: (id: string, data: FieldForm) =>
    http.post<FieldVO>(`/custom-form/${id}/fields`, data),
  updateField: (id: string, fieldId: string, data: Partial<FieldForm>) =>
    http.put<FieldVO>(`/custom-form/${id}/fields/${fieldId}`, data),
  removeField: (id: string, fieldId: string) => http.delete(`/custom-form/${id}/fields/${fieldId}`),
  reorderFields: (id: string, orderedIds: string[]) =>
    http.put(`/custom-form/${id}/fields/reorder`, { orderedIds }),
  dataPage: (
    id: string,
    data?: {
      current?: number
      pageSize?: number
      keyword?: string
      filters?: FilterCondition[]
      viewId?: string
    },
  ) => http.post<CustomFormDataPageVO>(`/custom-form/${id}/data/page`, data ?? {}),
  dataSourcePage: (
    id: string,
    data?: {
      current?: number
      pageSize?: number
      keyword?: string
      filters?: FilterCondition[]
      filterMode?: 'AND' | 'OR'
    },
  ) => http.post<DataSourcePageVO>(`/custom-form/${id}/data/source-options`, data ?? {}),
  dataSourceResolve: (id: string, ids: string[]) =>
    http.post<DataSourceOptionVO[]>(`/custom-form/${id}/data/source-resolve`, { ids }),
  dataDetail: (id: string, dataId: string) =>
    http.get<CustomFormDataDetailVO>(`/custom-form/${id}/data/${dataId}`),
  createData: (id: string, data: SaveCustomFormDataInput) =>
    http.post<CustomFormDataVO>(`/custom-form/${id}/data`, data),
  updateData: (id: string, dataId: string, data: SaveCustomFormDataInput) =>
    http.put<CustomFormDataVO>(`/custom-form/${id}/data/${dataId}`, data),
  removeData: (id: string, dataId: string) =>
    http.delete<{ id: string }>(`/custom-form/${id}/data/${dataId}`),
  downloadDataAttachment: async (
    id: string,
    dataId: string,
    attachmentId: string,
    name: string,
  ) => {
    const { data } = await http.get<Blob>(
      `/custom-form/${id}/data/${dataId}/attachments/${attachmentId}`,
      { responseType: 'blob', timeout: 60_000 },
    )
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  },
  batchUpdateData: (id: string, data: { ids: string[]; fieldId: string; fieldValue?: unknown }) =>
    http.post<{ count: number }>(`/custom-form/${id}/data/batch/update`, data),
  batchDeleteData: (id: string, ids: string[]) =>
    http.post<{ count: number }>(`/custom-form/${id}/data/batch/delete`, { ids }),
  downloadTemplate: (id: string, importType: ImportType) =>
    http.get<Blob>(`/custom-form/${id}/data/template/download`, {
      params: { importType },
      responseType: 'blob',
    }),
  importPrecheck: (id: string, file: File, importType: ImportType) =>
    http.post<ImportResultVO>(
      `/custom-form/${id}/data/import/pre-check`,
      createImportForm(file, importType),
    ),
  importXlsx: (id: string, file: File, importType: ImportType) =>
    http.post<ImportResultVO>(`/custom-form/${id}/data/import`, createImportForm(file, importType)),
  exportAll: (id: string, data: ExportCreatePayload) =>
    http.post<ExportTaskVO>(`/custom-form/${id}/data/export-all`, data),
  exportSelected: (id: string, data: ExportCreatePayload & { ids: string[] }) =>
    http.post<ExportTaskVO>(`/custom-form/${id}/data/export-select`, data),
}
