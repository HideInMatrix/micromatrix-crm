<script setup lang="ts">
import { CircleAlert, LoaderCircle } from 'lucide-vue-next'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callbackWeCom, callbackWeComWorkbench } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const loading = ref(true)
const errorMessage = ref('')

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  if (!code || !state) {
    errorMessage.value = '企业微信回调参数不完整'
    loading.value = false
    return
  }
  try {
    const callback = state.startsWith('wecom.')
      ? callbackWeComWorkbench
      : state.startsWith('qr-wecom.')
        ? callbackWeCom
        : null
    if (!callback) throw new Error('企业微信登录状态类型无效')
    const { data } = await callback({ code, state })
    auth.acceptLoginResult(data)
    await router.replace(data.returnPath || '/')
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="h-full flex-center bg-[var(--el-bg-color-page)]">
    <el-card class="w-96 text-center" shadow="hover">
      <LoaderCircle v-if="loading" class="mx-auto animate-spin text-[var(--el-color-primary)]" />
      <CircleAlert v-else-if="errorMessage" class="mx-auto text-[var(--el-color-danger)]" />
      <h1 class="mt-4 text-lg font-medium">
        {{ loading ? '正在验证企业微信身份' : errorMessage ? '企业微信登录失败' : '登录成功' }}
      </h1>
      <p class="mt-2 text-sm text-[var(--el-text-color-secondary)]">
        {{ loading ? '请稍候，不要重复刷新页面。' : errorMessage }}
      </p>
      <el-button v-if="errorMessage" class="mt-5" type="primary" @click="router.replace('/login')">
        返回密码登录
      </el-button>
    </el-card>
  </div>
</template>
