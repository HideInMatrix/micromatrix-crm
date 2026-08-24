<script setup lang="ts">
import type { EnterpriseIntegrationVO, SaveWeComIntegrationInput } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { MessagesSquare, Settings2, ShieldCheck } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { enterpriseIntegrationApi, roleApi, type RoleOption } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const secretLoading = ref(false)
const syncSaving = ref(false)
const syncDialogVisible = ref(false)
const selectedDefaultRoleId = ref('')
const roles = ref<RoleOption[]>([])
const drawerVisible = ref(false)
const formRef = ref<FormInstance>()

const emptyIntegration = (): EnterpriseIntegrationVO => ({
  id: null,
  provider: 'WECOM',
  configured: false,
  corpId: '',
  agentId: '',
  secretConfigured: false,
  credentialVersion: 0,
  syncEnabled: false,
  syncDefaultRoleId: null,
  lastTestSucceeded: null,
  lastTestMessage: null,
  lastTestedAt: null,
  lastSyncStatus: null,
  lastSyncMessage: null,
  lastSyncedAt: null,
  createdAt: null,
  updatedAt: null,
})

const integration = ref<EnterpriseIntegrationVO>(emptyIntegration())
const form = reactive<SaveWeComIntegrationInput>({ corpId: '', agentId: '', appSecret: '' })

const rules: FormRules<SaveWeComIntegrationInput> = {
  corpId: [
    { required: true, message: '请输入企业 ID', trigger: 'blur' },
    { max: 128, message: '企业 ID 不能超过 128 个字符', trigger: 'blur' },
  ],
  agentId: [
    { required: true, message: '请输入应用 ID', trigger: 'blur' },
    { pattern: /^\d+$/, message: '应用 ID 必须为数字', trigger: 'blur' },
  ],
  appSecret: [{ required: true, message: '请输入应用 Secret', trigger: 'blur' }],
}

const status = computed(() => {
  if (!integration.value.configured) return { label: '未配置', type: 'info' as const }
  if (integration.value.lastTestSucceeded === true)
    return { label: '连接正常', type: 'success' as const }
  if (integration.value.lastTestSucceeded === false)
    return { label: '验证失败', type: 'danger' as const }
  return { label: '待验证', type: 'warning' as const }
})

function formatTime(value: string | null) {
  if (!value) return '尚未测试'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

async function loadData() {
  loading.value = true
  try {
    const [{ data }, roleResponse] = await Promise.all([
      enterpriseIntegrationApi.getWeCom(),
      canUpdate.value ? roleApi.options() : Promise.resolve({ data: [] as RoleOption[] }),
    ])
    integration.value = data
    roles.value = roleResponse.data
    selectedDefaultRoleId.value = data.syncDefaultRoleId ?? ''
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function openDrawer() {
  form.corpId = integration.value.corpId
  form.agentId = integration.value.agentId
  form.appSecret = ''
  drawerVisible.value = true
  if (!integration.value.secretConfigured) return
  secretLoading.value = true
  try {
    const { data } = await enterpriseIntegrationApi.getWeComSecret()
    form.appSecret = data.appSecret
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    secretLoading.value = false
  }
}

async function validateForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  return Boolean(valid)
}

function payload(): SaveWeComIntegrationInput {
  const appSecret = form.appSecret?.trim()
  return {
    corpId: form.corpId.trim(),
    agentId: form.agentId.trim(),
    ...(appSecret ? { appSecret } : {}),
  }
}

async function save() {
  if (!(await validateForm())) return
  saving.value = true
  try {
    const { data } = await enterpriseIntegrationApi.saveWeCom(payload())
    integration.value = data
    drawerVisible.value = false
    ElMessage.success('企业微信配置已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function testDraft() {
  if (!(await validateForm())) return
  testing.value = true
  try {
    const { data } = await enterpriseIntegrationApi.testWeCom(payload())
    integration.value = data.integration
    if (data.success) ElMessage.success(data.message)
    else ElMessage.error(data.message)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    testing.value = false
  }
}

async function testSaved() {
  testing.value = true
  try {
    const { data } = await enterpriseIntegrationApi.testWeCom({
      corpId: integration.value.corpId,
      agentId: integration.value.agentId,
    })
    integration.value = data.integration
    if (data.success) ElMessage.success(data.message)
    else ElMessage.error(data.message)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    testing.value = false
  }
}

function requestSyncChange(enabled: boolean) {
  if (enabled) {
    selectedDefaultRoleId.value = integration.value.syncDefaultRoleId ?? ''
    syncDialogVisible.value = true
    return
  }
  void disableSync()
}

async function disableSync() {
  const confirmed = await ElMessageBox.confirm(
    '关闭后组织架构页面将不能从企业微信生成新的同步预览，已有部门和成员不会被删除。',
    '关闭同步组织架构',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  syncSaving.value = true
  try {
    const { data } = await enterpriseIntegrationApi.updateWeComSync({ enabled: false })
    integration.value = data
    ElMessage.success('已关闭同步组织架构')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    syncSaving.value = false
  }
}

async function enableSync() {
  if (!selectedDefaultRoleId.value) {
    ElMessage.warning('请选择新成员默认角色')
    return
  }
  syncSaving.value = true
  try {
    const { data } = await enterpriseIntegrationApi.updateWeComSync({
      enabled: true,
      defaultRoleId: selectedDefaultRoleId.value,
    })
    integration.value = data
    syncDialogVisible.value = false
    ElMessage.success('已开启同步组织架构')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    syncSaving.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <el-card
    v-loading="loading"
    shadow="never"
    class="integration-card"
    data-testid="wecom-integration-card"
  >
    <div class="integration-header">
      <div class="platform-summary">
        <div class="platform-icon"><MessagesSquare :size="24" /></div>
        <div>
          <div class="platform-title">
            <span>企业微信</span>
            <el-tag :type="status.type" size="small">{{ status.label }}</el-tag>
          </div>
          <p>连接企业微信自建应用，为组织同步、统一登录和消息通知提供公共配置。</p>
        </div>
      </div>
      <div v-if="canUpdate" class="platform-actions">
        <el-button :icon="Settings2" @click="openDrawer">配置</el-button>
        <el-button
          type="primary"
          plain
          :icon="ShieldCheck"
          :disabled="!integration.configured"
          :loading="testing"
          @click="testSaved"
        >
          测试连接
        </el-button>
      </div>
    </div>

    <el-divider />
    <el-descriptions :column="3" border>
      <el-descriptions-item label="企业 ID">{{
        integration.corpId || '未配置'
      }}</el-descriptions-item>
      <el-descriptions-item label="应用 ID">{{
        integration.agentId || '未配置'
      }}</el-descriptions-item>
      <el-descriptions-item label="应用 Secret">{{
        integration.secretConfigured ? '已安全配置' : '未配置'
      }}</el-descriptions-item>
      <el-descriptions-item label="最后测试">{{
        formatTime(integration.lastTestedAt)
      }}</el-descriptions-item>
      <el-descriptions-item label="测试结果" :span="2">{{
        integration.lastTestMessage || '尚未执行连接测试'
      }}</el-descriptions-item>
    </el-descriptions>

    <div class="sync-boundary">
      <div>
        <strong>同步组织架构</strong>
        <span>
          {{
            integration.syncEnabled
              ? '已开启，可在组织架构页面生成差异预览后应用。'
              : '开启后可从企业微信预览并同步部门和成员。'
          }}
        </span>
      </div>
      <el-tooltip
        :disabled="integration.lastTestSucceeded === true"
        content="请先保存配置并完成连接测试"
        placement="top"
      >
        <el-switch
          :model-value="integration.syncEnabled"
          :disabled="!canUpdate || integration.lastTestSucceeded !== true"
          :loading="syncSaving"
          @change="requestSyncChange(Boolean($event))"
        />
      </el-tooltip>
    </div>
    <el-descriptions v-if="integration.syncEnabled" :column="2" border class="mt-3">
      <el-descriptions-item label="新成员默认角色">
        {{ roles.find((role) => role.id === integration.syncDefaultRoleId)?.name || '未选择' }}
      </el-descriptions-item>
      <el-descriptions-item label="最近同步">
        {{ integration.lastSyncMessage || '尚未执行组织同步' }}
      </el-descriptions-item>
    </el-descriptions>
  </el-card>

  <el-drawer v-model="drawerVisible" title="配置企业微信" size="520px" destroy-on-close>
    <el-alert
      title="连接测试会按 Cordys 规则保存当前配置和测试结果；应用 Secret 在服务端加密保存，仅配置管理员可以查看。"
      type="info"
      :closable="false"
      show-icon
      class="mb-5"
    />
    <el-form
      ref="formRef"
      v-loading="secretLoading"
      :model="form"
      :rules="rules"
      label-position="top"
    >
      <el-form-item label="企业 ID" prop="corpId">
        <el-input v-model="form.corpId" placeholder="例如：wwxxxxxxxxxxxxxxxx" />
      </el-form-item>
      <el-form-item label="应用 ID" prop="agentId">
        <el-input v-model="form.agentId" placeholder="企业微信自建应用的 AgentId" />
      </el-form-item>
      <el-form-item label="应用 Secret" prop="appSecret">
        <el-input
          v-model="form.appSecret"
          type="password"
          show-password
          autocomplete="new-password"
          placeholder="请输入应用 Secret"
        />
        <div class="secret-tip">
          <span>
            获取方式：登录企业微信管理后台 → 应用管理 → 自建应用 → 选择对应应用，在应用详情中查看
            Secret。应用需处于启用状态；已有配置会安全加载到此处，点击输入框右侧眼睛按钮即可查看，无需重复填写。
          </span>
          <el-link
            href="https://developer.work.weixin.qq.com/document/path/90665#secret"
            target="_blank"
            type="primary"
            underline="never"
          >
            查看企业微信官方说明
          </el-link>
        </div>
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="drawer-actions">
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button plain :loading="testing" @click="testDraft">测试连接</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </template>
  </el-drawer>

  <el-dialog v-model="syncDialogVisible" title="开启同步组织架构" width="480px">
    <el-alert
      title="默认角色只分配给首次从企业微信创建的新成员；已存在成员的角色不会被覆盖。"
      type="info"
      :closable="false"
      show-icon
      class="mb-4"
    />
    <el-form label-position="top">
      <el-form-item label="新成员默认角色" required>
        <el-select
          v-model="selectedDefaultRoleId"
          class="w-full"
          placeholder="请选择角色"
          filterable
        >
          <el-option v-for="role in roles" :key="role.id" :label="role.name" :value="role.id" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="syncDialogVisible = false">取消</el-button>
      <el-button type="primary" :loading="syncSaving" @click="enableSync">确认开启</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.integration-card {
  max-width: 1080px;
}
.integration-header,
.platform-summary,
.platform-title,
.platform-actions,
.sync-boundary,
.drawer-actions {
  display: flex;
  align-items: center;
}
.integration-header,
.sync-boundary {
  justify-content: space-between;
  gap: 24px;
}
.platform-summary {
  gap: 14px;
}
.platform-icon {
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 8px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.platform-title {
  gap: 10px;
  font-size: 16px;
  font-weight: 600;
}
.platform-summary p,
.sync-boundary span,
.secret-tip {
  color: var(--el-text-color-secondary);
  font-size: 13px;
}
.platform-summary p {
  margin: 6px 0 0;
}
.platform-actions,
.drawer-actions {
  gap: 10px;
}
.sync-boundary {
  margin-top: 18px;
  padding: 14px 16px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}
.sync-boundary div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.secret-tip {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.drawer-actions {
  justify-content: flex-end;
}
@media (max-width: 900px) {
  .integration-header {
    align-items: flex-start;
    flex-direction: column;
  }
  .platform-actions {
    align-self: stretch;
    justify-content: flex-end;
  }
}
</style>
