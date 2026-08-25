<script setup lang="ts">
import { CircleAlert, LoaderCircle } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { startWeComWorkbenchLogin } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const errorMessage = ref('')

function returnPath(): string {
  const value = typeof route.query.redirect === 'string' ? route.query.redirect : '/'
  return value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

async function authorize() {
  loading.value = true
  errorMessage.value = ''
  try {
    const tenantSlug =
      typeof route.query.tenant === 'string' ? route.query.tenant.trim() || undefined : undefined
    const { data } = await startWeComWorkbenchLogin({ tenantSlug, returnPath: returnPath() })
    window.location.replace(data.authorizationUrl)
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
    loading.value = false
  }
}

function usePasswordLogin() {
  router.replace({ name: 'login', query: { ...route.query, manual: '1' } })
}

onMounted(authorize)
</script>

<template>
  <div class="h-full flex-center bg-[var(--el-bg-color-page)] px-4">
    <el-card class="w-96 max-w-full text-center" shadow="hover">
      <LoaderCircle v-if="loading" class="mx-auto animate-spin text-[var(--el-color-primary)]" />
      <CircleAlert v-else class="mx-auto text-[var(--el-color-danger)]" />
      <h1 class="mt-4 text-lg font-medium">
        {{ loading ? '正在进入企业微信工作台' : '企业微信登录失败' }}
      </h1>
      <p class="mt-2 text-sm text-[var(--el-text-color-secondary)]">
        {{ loading ? '正在跳转到企业微信身份授权，请稍候。' : errorMessage }}
      </p>
      <div v-if="!loading" class="mt-5 flex justify-center gap-3">
        <el-button @click="usePasswordLogin">账号密码登录</el-button>
        <el-button type="primary" @click="authorize">重新授权</el-button>
      </div>
    </el-card>
  </div>
</template>
