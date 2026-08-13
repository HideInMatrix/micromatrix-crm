import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/utils/token-storage'

export const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

http.interceptors.request.use((config) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

let refreshing: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    // 用原生 axios 避免走本实例的拦截器
    const { data } = await axios.post<{ accessToken: string; refreshToken: string }>(
      '/api/auth/refresh',
      { refreshToken },
    )
    setTokens(data.accessToken, data.refreshToken)
    return true
  } catch {
    return false
  }
}

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
    const is401 = error.response?.status === 401
    const isAuthApi = config?.url?.includes('/auth/')

    if (is401 && config && !config._retried && !isAuthApi) {
      // 并发 401 只触发一次刷新
      refreshing ??= tryRefreshToken().finally(() => {
        refreshing = null
      })
      const refreshed = await refreshing
      if (refreshed) {
        config._retried = true
        return http(config)
      }
      clearTokens()
      if (!location.pathname.startsWith('/login')) location.assign('/login')
    }
    return Promise.reject(error)
  },
)

/** 从后端错误响应中提取可展示的提示文案 */
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message
    if (Array.isArray(message)) return message[0] ?? '请求失败'
    if (message) return message
  }
  return '网络异常，请稍后重试'
}
