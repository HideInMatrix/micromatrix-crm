<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'
import type { EnterpriseMailSettingVO, SaveEnterpriseMailSettingInput } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { enterpriseMailSettingApi } from '@/api/enterprise-settings'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const drawerVisible = ref(false)
const formRef = ref<FormInstance>()
const setting = ref<EnterpriseMailSettingVO | null>(null)

const form = reactive<SaveEnterpriseMailSettingInput>({
  host: '',
  port: 465,
  account: '',
  password: '',
  from: '',
  recipient: '',
  ssl: true,
  tls: false,
})

const rules: FormRules = {
  host: [{ required: true, message: '请输入 SMTP Host', trigger: 'blur' }],
  port: [{ required: true, message: '请输入 SMTP Port', trigger: 'blur' }],
  account: [{ required: true, message: '请输入 SMTP Account', trigger: 'blur' }],
  from: [{ type: 'email', message: 'From 必须是有效邮箱', trigger: 'blur' }],
  recipient: [{ type: 'email', message: 'Recipient 必须是有效邮箱', trigger: 'blur' }],
}

function fillForm(data: EnterpriseMailSettingVO) {
  Object.assign(form, {
    host: data.host,
    port: data.port,
    account: data.account,
    password: '',
    from: data.from,
    recipient: data.recipient,
    ssl: data.ssl,
    tls: data.tls,
  })
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await enterpriseMailSettingApi.get()
    setting.value = data
    fillForm(data)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function openEdit() {
  if (setting.value) fillForm(setting.value)
  drawerVisible.value = true
}

function normalizeTransport(kind: 'ssl' | 'tls') {
  if (kind === 'ssl' && form.ssl) form.tls = false
  if (kind === 'tls' && form.tls) form.ssl = false
}

async function validateForm() {
  await formRef.value?.validate()
}

async function testConnection(useDraft = false) {
  testing.value = true
  try {
    if (useDraft) await validateForm()
    const payload: SaveEnterpriseMailSettingInput = useDraft
      ? { ...form, password: form.password || undefined }
      : {
          host: setting.value?.host ?? '',
          port: setting.value?.port ?? 465,
          account: setting.value?.account ?? '',
          from: setting.value?.from ?? '',
          recipient: setting.value?.recipient ?? '',
          ssl: setting.value?.ssl ?? true,
          tls: setting.value?.tls ?? false,
        }
    const { data } = await enterpriseMailSettingApi.test(payload)
    ElMessage.success(data.message)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    testing.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await validateForm()
    await enterpriseMailSettingApi.update({ ...form, password: form.password || undefined })
    ElMessage.success('邮件设置已更新')
    drawerVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <el-card v-loading="loading" shadow="never" class="mail-panel">
    <template #header>
      <div class="header-row">
        <div>
          <strong>邮件设置</strong>
          <div class="tip">SMTP 密码使用 AES-256-GCM 加密保存，读取接口不会返回明文密码。</div>
        </div>
        <div class="header-actions">
          <el-button
            :loading="testing"
            :disabled="!setting?.configured"
            @click="testConnection(false)"
            >测试连接</el-button
          >
          <el-button v-if="canUpdate" type="primary" @click="openEdit">编辑</el-button>
        </div>
      </div>
    </template>

    <el-descriptions :column="2" border>
      <el-descriptions-item label="SMTP Host">{{ setting?.host || '-' }}</el-descriptions-item>
      <el-descriptions-item label="SMTP Port">{{ setting?.port || '-' }}</el-descriptions-item>
      <el-descriptions-item label="SMTP Account">{{
        setting?.account || '-'
      }}</el-descriptions-item>
      <el-descriptions-item label="SMTP Password">
        <el-tag :type="setting?.passwordConfigured ? 'success' : 'info'">
          {{ setting?.passwordConfigured ? '已配置' : '未配置' }}
        </el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="From">{{ setting?.from || '-' }}</el-descriptions-item>
      <el-descriptions-item label="Recipient">{{ setting?.recipient || '-' }}</el-descriptions-item>
      <el-descriptions-item label="SSL">{{ setting?.ssl ? '开启' : '关闭' }}</el-descriptions-item>
      <el-descriptions-item label="STARTTLS">{{
        setting?.tls ? '开启' : '关闭'
      }}</el-descriptions-item>
      <el-descriptions-item label="最近测试">
        <span v-if="setting?.lastTestedAt">
          {{ new Date(setting.lastTestedAt).toLocaleString() }} ·
          {{ setting.lastTestSucceeded ? '成功' : '失败' }}
        </span>
        <span v-else>-</span>
      </el-descriptions-item>
      <el-descriptions-item label="测试信息">{{
        setting?.lastTestMessage || '-'
      }}</el-descriptions-item>
    </el-descriptions>

    <el-drawer v-model="drawerVisible" title="更新邮件设置" size="560px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item label="SMTP Host" prop="host"><el-input v-model="form.host" /></el-form-item>
        <el-form-item label="SMTP Port" prop="port">
          <el-input-number v-model="form.port" :min="1" :max="65535" controls-position="right" />
        </el-form-item>
        <el-form-item label="SMTP Account" prop="account"
          ><el-input v-model="form.account"
        /></el-form-item>
        <el-form-item label="SMTP Password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            autocomplete="new-password"
          />
          <div class="tip">编辑时留空表示保留当前密码。</div>
        </el-form-item>
        <el-form-item label="From" prop="from"><el-input v-model="form.from" /></el-form-item>
        <el-form-item label="Recipient" prop="recipient"
          ><el-input v-model="form.recipient"
        /></el-form-item>
        <el-form-item label="传输安全">
          <div class="switch-list">
            <el-switch v-model="form.ssl" active-text="SSL" @change="normalizeTransport('ssl')" />
            <el-switch
              v-model="form.tls"
              active-text="STARTTLS"
              @change="normalizeTransport('tls')"
            />
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="drawer-footer">
          <el-button :loading="testing" @click="testConnection(true)">测试连接</el-button>
          <el-button @click="drawerVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="save">更新</el-button>
        </div>
      </template>
    </el-drawer>
  </el-card>
</template>

<style scoped>
.mail-panel {
  border-radius: 6px;
}
.header-row,
.header-actions,
.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.tip {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.switch-list {
  display: flex;
  gap: 28px;
}
.drawer-footer {
  justify-content: flex-end;
}
</style>
