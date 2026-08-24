<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage, http } from '@/api/http'
import { settingApi } from '@/api/system'
import { useAuthStore } from '@/stores/auth'
import WeComIntegrationCard from './WeComIntegrationCard.vue'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const activeTab = ref('profile')
const loading = ref(false)
const saving = ref(false)
const form = reactive({ companyName: '', companyWebsite: '', contactEmail: '', announcement: '' })

async function loadData() {
  loading.value = true
  try {
    const { data } = await settingApi.get()
    form.companyName = (data.companyName as string) ?? ''
    form.companyWebsite = (data.companyWebsite as string) ?? ''
    form.contactEmail = (data.contactEmail as string) ?? ''
    form.announcement = (data.announcement as string) ?? ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    await settingApi.update({ ...form })
    ElMessage.success('设置已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

const apiToken = ref('')
const issuing = ref(false)

async function issueApiToken() {
  const confirmed = await ElMessageBox.confirm(
    '生成一个 365 天有效的 API 令牌，用于脚本/第三方系统调用开放 API（文档见 /api/docs）。令牌只显示一次，请妥善保存。',
    '生成 API 令牌',
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
  await navigator.clipboard.writeText(apiToken.value)
  ElMessage.success('已复制')
}

onMounted(loadData)
</script>

<template>
  <div class="settings-page">
    <el-tabs v-model="activeTab" class="settings-tabs">
      <el-tab-pane label="企业信息" name="profile">
        <el-card v-loading="loading" shadow="never" class="settings-card">
          <el-form :model="form" label-width="100px">
            <el-form-item label="企业名称">
              <el-input
                v-model="form.companyName"
                :disabled="!canUpdate"
                placeholder="显示在系统标题"
              />
            </el-form-item>
            <el-form-item label="企业官网">
              <el-input v-model="form.companyWebsite" :disabled="!canUpdate" />
            </el-form-item>
            <el-form-item label="联系邮箱">
              <el-input v-model="form.contactEmail" :disabled="!canUpdate" />
            </el-form-item>
            <el-form-item label="系统公告">
              <el-input
                v-model="form.announcement"
                type="textarea"
                :rows="3"
                :disabled="!canUpdate"
                placeholder="展示在工作台顶部"
              />
            </el-form-item>
            <el-form-item v-if="canUpdate">
              <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>

      <el-tab-pane label="企业集成" name="integrations">
        <WeComIntegrationCard />
      </el-tab-pane>

      <el-tab-pane label="开放 API" name="api">
        <el-card shadow="never" class="settings-card">
          <el-form label-width="100px">
            <el-form-item label="API 令牌">
              <div class="token-field">
                <el-button v-if="canUpdate" :loading="issuing" @click="issueApiToken"
                  >生成 365 天令牌</el-button
                >
                <div v-if="apiToken" class="token-result">
                  <el-input :model-value="apiToken" type="textarea" :rows="3" readonly />
                  <el-button @click="copyToken">复制</el-button>
                </div>
                <div class="token-tip">
                  调用方式：请求头携带 Authorization: Bearer &lt;令牌&gt;，接口文档见
                  <a href="/api/docs" target="_blank">/api/docs</a>
                </div>
              </div>
            </el-form-item>
          </el-form>
        </el-card>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<style scoped>
.settings-page {
  min-height: 100%;
}
.settings-tabs :deep(.el-tabs__header) {
  margin-bottom: 18px;
  padding: 0 18px;
  background: var(--el-bg-color);
  border: 1px solid var(--el-border-color-light);
  border-radius: 6px;
}
.settings-card {
  max-width: 860px;
}
.token-field {
  width: 100%;
}
.token-result {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 10px;
}
.token-tip {
  margin-top: 8px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.token-tip a {
  color: var(--el-color-primary);
}
</style>
