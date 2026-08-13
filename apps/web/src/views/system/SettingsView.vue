<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage, http } from '@/api/http'
import { settingApi } from '@/api/system'

const loading = ref(false)
const saving = ref(false)
const form = reactive({
  companyName: '',
  companyWebsite: '',
  contactEmail: '',
  announcement: '',
})

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
  <el-card v-loading="loading" shadow="never" class="max-w-2xl">
    <el-form :model="form" label-width="100px">
      <el-form-item label="企业名称">
        <el-input v-model="form.companyName" placeholder="显示在系统标题" />
      </el-form-item>
      <el-form-item label="企业官网">
        <el-input v-model="form.companyWebsite" />
      </el-form-item>
      <el-form-item label="联系邮箱">
        <el-input v-model="form.contactEmail" />
      </el-form-item>
      <el-form-item label="系统公告">
        <el-input
          v-model="form.announcement"
          type="textarea"
          :rows="3"
          placeholder="展示在工作台顶部"
        />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </el-form-item>

      <el-divider content-position="left">开放 API</el-divider>
      <el-form-item label="API 令牌">
        <div class="w-full">
          <el-button :loading="issuing" @click="issueApiToken">生成 365 天令牌</el-button>
          <div v-if="apiToken" class="mt-2 flex gap-2 items-start">
            <el-input :model-value="apiToken" type="textarea" :rows="3" readonly />
            <el-button @click="copyToken">复制</el-button>
          </div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            调用方式：请求头携带 Authorization: Bearer &lt;令牌&gt;，接口文档见
            <a href="/api/docs" target="_blank" class="text-[var(--el-color-primary)]">/api/docs</a>
          </div>
        </div>
      </el-form-item>
    </el-form>
  </el-card>
</template>
