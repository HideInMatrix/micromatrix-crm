import { hasPermission, type CurrentUser, type LoginResult } from '@micromatrix/shared'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import * as authApi from '@/api/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import { clearTokens, getAccessToken, setTokens } from '@/utils/token-storage'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<CurrentUser | null>(null)
  const hasToken = ref(Boolean(getAccessToken()))

  const isAuthenticated = computed(() => hasToken.value)

  async function login(payload: authApi.LoginPayload) {
    const { data } = await authApi.login(payload)
    acceptLoginResult(data)
  }

  function acceptLoginResult(data: LoginResult) {
    useModuleConfigStore().reset()
    setTokens(data.accessToken, data.refreshToken)
    hasToken.value = true
    user.value = data.user
  }

  /** 刷新页面后恢复用户信息（令牌还在但内存状态丢失时） */
  async function fetchMe(force = false) {
    if (!hasToken.value || (user.value && !force)) return
    const { data } = await authApi.fetchMe()
    user.value = data
  }

  function hasPerm(code?: string): boolean {
    if (!code) return true
    return hasPermission(user.value?.permissions ?? [], code)
  }

  function logout() {
    clearTokens()
    useModuleConfigStore().reset()
    hasToken.value = false
    user.value = null
  }

  return { user, isAuthenticated, login, acceptLoginResult, fetchMe, hasPerm, logout }
})
