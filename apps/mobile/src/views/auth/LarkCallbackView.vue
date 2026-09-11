<script setup lang="ts">
import { showFailToast, showSuccessToast } from 'vant'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callbackLarkMobile } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const errorMessage = ref('')

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  if (!code || !state || !state.startsWith('lark-mobile.')) {
    errorMessage.value = '飞书授权回调参数不完整'
    showFailToast(errorMessage.value)
    return
  }
  try {
    const { data } = await callbackLarkMobile({ code, state })
    auth.acceptLoginResult(data)
    showSuccessToast('飞书登录成功')
    await router.replace(
      data.returnPath?.startsWith('/mobile/') ? data.returnPath.slice(7) : '/home',
    )
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
    showFailToast(errorMessage.value)
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center px-6 text-center">
    <template v-if="errorMessage">
      <div class="mb-4 text-base font-medium">飞书登录失败</div>
      <div class="mb-6 text-sm text-gray-500">{{ errorMessage }}</div>
      <van-button type="primary" round @click="router.replace('/login?manual=1')"
        >返回登录</van-button
      >
    </template>
    <template v-else>
      <van-loading size="28px" />
      <div class="mt-4 text-sm text-gray-500">正在完成飞书登录…</div>
    </template>
  </div>
</template>
