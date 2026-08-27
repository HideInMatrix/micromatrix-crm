<script setup lang="ts">
import { computed, ref } from 'vue'
import { http, extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import WeComIntegrationCard from './WeComIntegrationCard.vue'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const apiToken = ref('')
const issuing = ref(false)

async function issueApiToken() {
  const confirmed = await ElMessageBox.confirm(
    '生成一个 365 天有效的 API 令牌。令牌只显示一次，请立即保存。',
    '生成 API 令牌',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  issuing.value = true
  try {
    const { data } = await http.post<{ token: string }>('/auth/api-token')
    apiToken.value = data.token
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    issuing.value = false
  }
}

async function copyToken() {
  if (!apiToken.value) return
  await navigator.clipboard.writeText(apiToken.value)
  ElMessage.success('API 令牌已复制')
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <WeComIntegrationCard />

    <el-card shadow="never" class="rounded-1.5">
      <template #header>
        <div>
          <strong>开放 API</strong>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            用于脚本或第三方系统调用 MicroMatrix CRM 开放接口。
          </div>
        </div>
      </template>
      <div class="flex items-center">
        <el-button v-if="canUpdate" type="primary" plain :loading="issuing" @click="issueApiToken">
          生成 365 天令牌
        </el-button>
        <span v-else class="mt-1 text-xs text-[var(--el-text-color-secondary)]"
          >当前账号没有企业设置修改权限。</span
        >
      </div>
      <div v-if="apiToken" class="mt-4 max-w-190 flex flex-col gap-3">
        <el-alert
          title="该令牌只会显示这一次，请妥善保存。"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-input :model-value="apiToken" type="textarea" :rows="4" readonly />
        <el-button class="self-start" @click="copyToken">复制令牌</el-button>
      </div>
      <div class="mt-4 text-xs text-[var(--el-text-color-secondary)]">
        调用时使用请求头 <code>Authorization: Bearer &lt;token&gt;</code>，接口文档见
        <a class="text-[var(--el-color-primary)]" href="/api/docs" target="_blank">/api/docs</a>。
      </div>
    </el-card>
  </div>
</template>
