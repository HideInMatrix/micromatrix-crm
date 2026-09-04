import type {
  CurrentUser,
  LoginResult,
  WeComLoginCallbackInput,
  WeComLoginDiscoveryVO,
  WeComLoginStartInput,
  WeComLoginStartVO,
} from '@micromatrix/shared'
import { http } from '../http'

export interface LoginPayload {
  email: string
  password: string
}

export function login(payload: LoginPayload) {
  return http.post<LoginResult>('/auth/login', payload)
}

export function fetchMe() {
  return http.get<CurrentUser>('/auth/me')
}

export function changePassword(payload: { oldPassword: string; newPassword: string }) {
  return http.post<{ success: boolean }>('/auth/change-password', payload)
}

export function discoverWeCom(tenantSlug?: string) {
  return http.get<WeComLoginDiscoveryVO>('/auth/wecom/discovery', {
    params: tenantSlug ? { tenant: tenantSlug } : undefined,
  })
}

export function startWeComLogin(payload: WeComLoginStartInput) {
  return http.post<WeComLoginStartVO>('/auth/wecom/start', payload)
}

export function startWeComWorkbenchLogin(payload: WeComLoginStartInput) {
  return http.post<WeComLoginStartVO>('/auth/wecom/workbench/start', payload)
}

export function callbackWeCom(payload: WeComLoginCallbackInput) {
  return http.post<LoginResult & { returnPath: string }>('/auth/wecom/callback', payload)
}

export function callbackWeComWorkbench(payload: WeComLoginCallbackInput) {
  return http.post<LoginResult & { returnPath: string }>('/auth/wecom/workbench/callback', payload)
}
