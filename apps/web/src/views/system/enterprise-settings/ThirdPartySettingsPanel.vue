<script setup lang="ts">
import { computed, ref } from 'vue'
import { http, extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import WeComIntegrationCard from '../WeComIntegrationCard.vue'

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
  <div class="third-party-panel">
    <WeComIntegrationCard />

    <el-card shadow="never" class="api-card">
      <template #header>
        <div>
          <strong>开放 API</strong>
          <div class="tip">用于脚本或第三方系统调用 MicroMatrix CRM 开放接口。</div>
        </div>
      </template>
      <div class="api-token-row">
        <el-button v-if="canUpdate" type="primary" plain :loading="issuing" @click="issueApiToken">
          生成 365 天令牌
        </el-button>
        <span v-else class="tip">当前账号没有企业设置修改权限。</span>
      </div>
      <div v-if="apiToken" class="token-result">
        <el-alert
          title="该令牌只会显示这一次，请妥善保存。"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-input :model-value="apiToken" type="textarea" :rows="4" readonly />
        <el-button @click="copyToken">复制令牌</el-button>
      </div>
      <div class="tip api-doc-tip">
        调用时使用请求头 <code>Authorization: Bearer &lt;token&gt;</code>，接口文档见
        <a href="/api/docs" target="_blank">/api/docs</a>。
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.third-party-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.api-card {
  border-radius: 6px;
}
.tip {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.api-token-row {
  display: flex;
  align-items: center;
}
.token-result {
  max-width: 760px;
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.token-result .el-button {
  align-self: flex-start;
}
.api-doc-tip {
  margin-top: 16px;
}
.api-doc-tip a {
  color: var(--el-color-primary);
}
</style>
