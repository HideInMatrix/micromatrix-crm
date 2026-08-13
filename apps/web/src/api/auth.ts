import type { CurrentUser, LoginResult } from '@micromatrix/shared'
import { http } from './http'

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
