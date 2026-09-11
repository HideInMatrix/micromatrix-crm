<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { startLarkOauthLogin } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'

const route = useRoute()
const errorMessage = ref('')

function returnPath() {
  return typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
    ? route.query.redirect
    : '/'
}

function useOtherLogin() {
  window.location.replace('/login?manual=1')
}

onMounted(async () => {
  try {
    const tenantSlug =
      typeof route.query.tenant === 'string' ? route.query.tenant.trim() || undefined : undefined
    const { data } = await startLarkOauthLogin({ tenantSlug, returnPath: returnPath() })
    window.location.replace(data.authorizationUrl)
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
  }
})
</script>

<template>
  <div class="h-full flex-center bg-[var(--el-bg-color-page)]">
    <el-result v-if="errorMessage" icon="error" title="飞书登录不可用" :sub-title="errorMessage">
      <template #extra>
        <el-button type="primary" @click="useOtherLogin">使用其他方式登录</el-button>
      </template>
    </el-result>
    <div v-else class="text-[var(--el-text-color-secondary)]">正在跳转飞书授权…</div>
  </div>
</template>
