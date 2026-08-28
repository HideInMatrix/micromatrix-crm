import type { FilterCondition, FilterOp } from '@micromatrix/shared'
import { http } from './http'

export type UserViewModule =
  | 'lead'
  | 'lead_pool'
  | 'customer'
  | 'contact'
  | 'customer_pool'
  | 'opportunity'

export interface UserViewConditionVO {
  name: string
  operator: FilterOp
  value?: unknown
  valueType?: string | null
  type?: string | null
  multipleValue?: boolean
  containChildIds?: string[]
}

export interface UserViewVO {
  id: string
  userId?: string
  name: string
  fixed: boolean
  enable: boolean
  resourceType?: string
  organizationId?: string
  pos?: number
  searchMode?: 'AND' | 'OR'
  conditions?: UserViewConditionVO[]
  optionMap?: Record<string, unknown[]>
}

export interface UserViewPayload {
  name: string
  searchMode: 'AND' | 'OR'
  conditions: UserViewConditionVO[]
}

const RESOURCE_PATHS: Record<UserViewModule, string> = {
  lead: '/lead/view',
  lead_pool: '/pool/lead/view',
  customer: '/account/view',
  contact: '/account/contact/view',
  customer_pool: '/pool/account/view',
  opportunity: '/opportunity/view',
}

function resourcePath(module: string) {
  const path = RESOURCE_PATHS[module as UserViewModule]
  if (!path) throw new Error(`未配置用户视图资源: ${module}`)
  return path
}

export const userViewApi = {
  list: (module: string) => http.get<UserViewVO[]>(`${resourcePath(module)}/list`),
  detail: (module: string, id: string) =>
    http.get<UserViewVO>(`${resourcePath(module)}/detail/${id}`),
  create: (module: string, data: UserViewPayload) =>
    http.post<UserViewVO>(`${resourcePath(module)}/add`, data),
  update: (module: string, id: string, data: UserViewPayload) =>
    http.post<UserViewVO>(`${resourcePath(module)}/update`, { ...data, id }),
  remove: (module: string, id: string) => http.get(`${resourcePath(module)}/delete/${id}`),
  toggleFixed: (module: string, id: string) => http.get(`${resourcePath(module)}/fixed/${id}`),
  toggleEnabled: (module: string, id: string) => http.get(`${resourcePath(module)}/enable/${id}`),
  editPos: (
    module: string,
    data: { orgId: string; moveId: string; targetId: string; moveMode: 'BEFORE' | 'AFTER' },
  ) => http.post(`${resourcePath(module)}/edit/pos`, data),
}

export function userViewConditionsToFilters(
  conditions: UserViewConditionVO[] = [],
): FilterCondition[] {
  return conditions.map((condition) => ({
    key: condition.name,
    op: condition.operator,
    value: condition.value,
  }))
}
