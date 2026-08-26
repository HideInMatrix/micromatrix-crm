import type {
  EnterpriseAiModelOptionVO,
  EnterpriseAiModelVO,
  EnterpriseAiRouteStrategyVO,
  EnterpriseGlobalTaskExecutionVO,
  EnterpriseGlobalTaskVO,
  EnterpriseMailSettingVO,
  EnterpriseMailTestVO,
  EnterpriseTermCategoryVO,
  EnterpriseTermDiscoveryVO,
  EnterpriseTermVO,
  EnterpriseUiAssetSlot,
  EnterpriseUiSettingVO,
  SaveEnterpriseAiModelInput,
  SaveEnterpriseGlobalTaskInput,
  SaveEnterpriseMailSettingInput,
  SaveEnterpriseTermInput,
  UpdateEnterpriseUiSettingInput,
} from '@micromatrix/shared'
import { http } from './http'

export const enterpriseUiSettingApi = {
  get: () => http.get<EnterpriseUiSettingVO>('/enterprise-settings/ui'),
  update: (data: UpdateEnterpriseUiSettingInput) =>
    http.put<EnterpriseUiSettingVO>('/enterprise-settings/ui', data),
  replaceAsset: (slot: EnterpriseUiAssetSlot, file: File) => {
    const form = new FormData()
    form.append('file', file)
    return http.post<EnterpriseUiSettingVO>(`/enterprise-settings/ui/assets/${slot}`, form, {
      timeout: 60_000,
    })
  },
  clearAsset: (slot: EnterpriseUiAssetSlot) =>
    http.delete<EnterpriseUiSettingVO>(`/enterprise-settings/ui/assets/${slot}`),
}

export const enterpriseMailSettingApi = {
  get: () => http.get<EnterpriseMailSettingVO>('/enterprise-settings/mail'),
  update: (data: SaveEnterpriseMailSettingInput) =>
    http.put<EnterpriseMailSettingVO>('/enterprise-settings/mail', data),
  test: (data: SaveEnterpriseMailSettingInput) =>
    http.post<EnterpriseMailTestVO>('/enterprise-settings/mail/test', data, { timeout: 15_000 }),
}

export const enterpriseAiModelApi = {
  list: (keyword?: string) =>
    http.get<EnterpriseAiModelVO[]>('/enterprise-settings/models', { params: { keyword } }),
  options: () => http.get<EnterpriseAiModelOptionVO[]>('/enterprise-settings/models/options'),
  create: (data: SaveEnterpriseAiModelInput) =>
    http.post<EnterpriseAiModelVO>('/enterprise-settings/models', data),
  update: (id: string, data: SaveEnterpriseAiModelInput) =>
    http.put<EnterpriseAiModelVO>(`/enterprise-settings/models/${id}`, data),
  remove: (id: string) => http.delete(`/enterprise-settings/models/${id}`),
  setStatus: (id: string, enable: boolean) =>
    http.patch<EnterpriseAiModelVO>(`/enterprise-settings/models/${id}/status`, { enable }),
  routeStrategy: () =>
    http.get<EnterpriseAiRouteStrategyVO>('/enterprise-settings/models/route-strategy'),
  updateRouteStrategy: (modelIds: string[]) =>
    http.put<EnterpriseAiRouteStrategyVO>('/enterprise-settings/models/route-strategy', {
      modelIds,
    }),
}

export interface SaveEnterpriseTermCategoryInput {
  name: string
  sort?: number
}

export const enterpriseTermApi = {
  categories: () => http.get<EnterpriseTermCategoryVO[]>('/enterprise-settings/term-categories'),
  createCategory: (data: SaveEnterpriseTermCategoryInput) =>
    http.post<EnterpriseTermCategoryVO>('/enterprise-settings/term-categories', data),
  updateCategory: (id: string, data: SaveEnterpriseTermCategoryInput) =>
    http.put<EnterpriseTermCategoryVO>(`/enterprise-settings/term-categories/${id}`, data),
  removeCategory: (id: string) => http.delete(`/enterprise-settings/term-categories/${id}`),
  list: (params?: { categoryId?: string; keyword?: string }) =>
    http.get<EnterpriseTermVO[]>('/enterprise-settings/terms', { params }),
  create: (data: SaveEnterpriseTermInput) =>
    http.post<EnterpriseTermVO>('/enterprise-settings/terms', data),
  update: (id: string, data: SaveEnterpriseTermInput) =>
    http.put<EnterpriseTermVO>(`/enterprise-settings/terms/${id}`, data),
  remove: (id: string) => http.delete(`/enterprise-settings/terms/${id}`),
  setStatus: (id: string, enable: boolean) =>
    http.patch<EnterpriseTermVO>(`/enterprise-settings/terms/${id}/status`, { enable }),
  discoveries: () => http.get<EnterpriseTermDiscoveryVO[]>('/enterprise-settings/term-discoveries'),
  ignoreDiscovery: (id: string) =>
    http.patch<EnterpriseTermDiscoveryVO>(`/enterprise-settings/term-discoveries/${id}/ignore`),
  adoptDiscovery: (id: string, data: SaveEnterpriseTermInput) =>
    http.post<EnterpriseTermVO>(`/enterprise-settings/term-discoveries/${id}/adopt`, data),
}

export const enterpriseGlobalTaskApi = {
  list: (keyword?: string) =>
    http.get<EnterpriseGlobalTaskVO[]>('/enterprise-settings/global-tasks', {
      params: { keyword },
    }),
  get: (id: string) => http.get<EnterpriseGlobalTaskVO>(`/enterprise-settings/global-tasks/${id}`),
  create: (data: SaveEnterpriseGlobalTaskInput) =>
    http.post<EnterpriseGlobalTaskVO>('/enterprise-settings/global-tasks', data),
  update: (id: string, data: SaveEnterpriseGlobalTaskInput) =>
    http.put<EnterpriseGlobalTaskVO>(`/enterprise-settings/global-tasks/${id}`, data),
  remove: (id: string) => http.delete(`/enterprise-settings/global-tasks/${id}`),
  setStatus: (id: string, enable: boolean) =>
    http.patch<EnterpriseGlobalTaskVO>(`/enterprise-settings/global-tasks/${id}/status`, {
      enable,
    }),
  executions: (taskId?: string) =>
    http.get<EnterpriseGlobalTaskExecutionVO[]>('/enterprise-settings/global-tasks/executions', {
      params: { taskId },
    }),
  stopExecution: (id: string) =>
    http.patch<EnterpriseGlobalTaskExecutionVO>(
      `/enterprise-settings/global-tasks/executions/${id}/stop`,
    ),
  removeExecution: (id: string) =>
    http.delete(`/enterprise-settings/global-tasks/executions/${id}`),
}
