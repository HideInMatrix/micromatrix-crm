import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token-storage'

export interface FrontendHttpOptions {
  baseURL?: string
  timeout?: number
  loginPath: string | (() => string)
}

export function createFrontendHttp(options: FrontendHttpOptions): AxiosInstance {
  const http = axios.create({
    baseURL: options.baseURL ?? '/api',
    timeout: options.timeout ?? 15000,
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
      const config = error.config as
        (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined
      const is401 = error.response?.status === 401
      const isAuthApi = config?.url?.includes('/auth/')

      if (is401 && config && !config._retried && !isAuthApi) {
        refreshing ??= tryRefreshToken().finally(() => {
          refreshing = null
        })
        const refreshed = await refreshing
        if (refreshed) {
          config._retried = true
          return http(config)
        }
        clearTokens()
        const loginPath =
          typeof options.loginPath === 'function' ? options.loginPath() : options.loginPath
        if (!location.pathname.startsWith(loginPath)) location.assign(loginPath)
      }
      return Promise.reject(error)
    },
  )

  return http
}

function resolveLoginPath(): string {
  if (typeof location !== 'undefined' && location.pathname.startsWith('/mobile')) {
    return '/mobile/login'
  }
  return '/login'
}

export const http = createFrontendHttp({ loginPath: resolveLoginPath })

export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message
    if (Array.isArray(message)) return message[0] ?? '请求失败'
    if (message) return message
  }
  return '网络异常，请稍后重试'
}
