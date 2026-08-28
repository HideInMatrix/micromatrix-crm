import type { FollowUpPlanVO } from '@micromatrix/shared'
import { http } from './http'

export interface PersonalCenterVO {
  userId: string
  userName: string
  phone: string
  email: string
  departmentId: string | null
  departmentName: string
  avatarUrl: string | null
  passwordLoginEnabled: boolean
  roles: Array<{ id: string; name: string }>
}

export interface PersonalPlanPager {
  list: FollowUpPlanVO[]
  total: number
  current: number
  pageSize: number
  options: Record<string, unknown>
}

export interface PersonalApiKeyVO {
  id: string
  createUser: string
  accessKey: string
  secretKey: string
  createTime: number
  enable: boolean
  forever: boolean
  expireTime: number | null
  description: string
}

export function getPersonalInfo() {
  return http.get<PersonalCenterVO>('/personal/center/info')
}

export function updatePersonalInfo(payload: { phone: string; email: string }) {
  return http.post<PersonalCenterVO>('/personal/center/update', payload)
}

export function resetPersonalPassword(payload: { originPassword: string; password: string }) {
  return http.post<{ success: boolean }>('/personal/center/info/reset', payload)
}

export function listPersonalPlans(payload: {
  current?: number
  pageSize?: number
  keyword?: string
  status?: 'PREPARED' | 'UNDERWAY' | 'COMPLETED' | 'CANCELLED'
}) {
  return http.post<PersonalPlanPager>('/personal/center/follow/plan/list', payload)
}

export function listPersonalApiKeys() {
  return http.get<PersonalApiKeyVO[]>('/user/api/key/list')
}

export function addPersonalApiKey() {
  return http.get<void>('/user/api/key/add')
}

export function updatePersonalApiKey(payload: {
  id: string
  forever: boolean
  expireTime?: number
  description?: string
}) {
  return http.post<void>('/user/api/key/update', payload)
}

export function enablePersonalApiKey(id: string) {
  return http.get<void>(`/user/api/key/enable/${id}`)
}

export function disablePersonalApiKey(id: string) {
  return http.get<void>(`/user/api/key/disable/${id}`)
}

export function deletePersonalApiKey(id: string) {
  return http.get<void>(`/user/api/key/delete/${id}`)
}
