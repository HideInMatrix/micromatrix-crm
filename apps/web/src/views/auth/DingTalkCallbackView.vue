<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callbackDingTalk, callbackDingTalkWorkbench } from '@/api/auth'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const errorMessage = ref('')

onMounted(async () => {
  const code = typeof route.query.code === 'string' ? route.query.code : ''
  const state = typeof route.query.state === 'string' ? route.query.state : ''
  if (!code || !state) {
    errorMessage.value = '钉钉授权回调参数不完整'
    return
  }
  try {
    const callback = state.startsWith('dingtalk.')
      ? callbackDingTalkWorkbench
      : state.startsWith('qr-dingtalk.')
        ? callbackDingTalk
        : null
    if (!callback) throw new Error('钉钉登录状态类型无效')
    const { data } = await callback({ code, state })
    auth.acceptLoginResult(data)
    ElMessage.success('钉钉登录成功')
    if (data.returnPath?.startsWith('/mobile/')) {
      window.location.replace(data.returnPath)
      return
    }
    await router.replace(data.returnPath || '/')
  } catch (error) {
    errorMessage.value = extractErrorMessage(error)
  }
})
</script>

<template>
  <div class="h-full flex-center bg-[var(--el-bg-color-page)]">
    <el-card class="w-120" shadow="never">
      <el-result v-if="errorMessage" icon="error" title="钉钉登录失败" :sub-title="errorMessage">
        <template #extra>
          <el-button type="primary" @click="router.replace('/login?manual=1')">返回登录</el-button>
        </template>
      </el-result>
      <div v-else class="py-12 text-center text-[var(--el-text-color-secondary)]">
        正在完成钉钉登录…
      </div>
    </el-card>
  </div>
</template>
