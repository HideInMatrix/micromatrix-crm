import { hasPermission, type CurrentUser } from '@micromatrix/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '@/api/auth'
import { clearTokens, getAccessToken, setTokens } from '@/utils/token-storage'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null)
  const hasToken = ref(Boolean(getAccessToken()))

  const isAuthenticated = computed(() => hasToken.value)

  async function login(payload: authApi.LoginPayload) {
    const { data } = await authApi.login(payload)
    setTokens(data.accessToken, data.refreshToken)
    hasToken.value = true
    user.value = data.user
  }

  /** 刷新页面后恢复用户信息（令牌还在但内存状态丢失时） */
  async function fetchMe() {
    if (!hasToken.value || user.value) return
    const { data } = await authApi.fetchMe()
    user.value = data
  }

  function hasPerm(code?: string): boolean {
    if (!code) return true
    return hasPermission(user.value?.permissions ?? [], code)
  }

  function logout() {
    clearTokens()
    hasToken.value = false
    user.value = null
  }

  return { user, isAuthenticated, login, fetchMe, hasPerm, logout }
})
