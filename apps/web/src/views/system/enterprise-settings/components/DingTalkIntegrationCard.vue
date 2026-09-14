<script setup lang="ts">
import type { EnterpriseIntegrationVO, SaveDingTalkIntegrationInput } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { MessageCircleMore } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { enterpriseIntegrationApi, roleApi, type RoleOption } from '@/api/system'
import { useAuthStore } from '@/stores/auth'
import EnterpriseIntegrationCardShell from './EnterpriseIntegrationCardShell.vue'

const auth = useAuthStore()
const canUpdate = computed(() => auth.hasPerm('system:setting:update'))
const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const secretLoading = ref(false)
const syncSaving = ref(false)
const syncDialogVisible = ref(false)
const drawerVisible = ref(false)
const formRef = ref<FormInstance>()
const roles = ref<RoleOption[]>([])
const selectedDefaultRoleId = ref('')

const emptyIntegration = (): EnterpriseIntegrationVO => ({
  id: null,
  provider: 'DINGTALK',
  configured: false,
  corpId: '',
  clientId: '',
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
const form = reactive<SaveDingTalkIntegrationInput>({
  corpId: '',
  clientId: '',
  agentId: '',
  appSecret: '',
})

const rules: FormRules<SaveDingTalkIntegrationInput> = {
  corpId: [{ required: true, message: '请输入企业 CorpId', trigger: 'blur' }],
  clientId: [{ required: true, message: '请输入应用 AppKey / ClientId', trigger: 'blur' }],
  agentId: [{ required: true, message: '请输入内部应用 AgentId', trigger: 'blur' }],
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

async function loadData() {
  loading.value = true
  try {
    const [{ data }, roleResponse] = await Promise.all([
      enterpriseIntegrationApi.getDingTalk(),
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
  form.clientId = integration.value.clientId ?? ''
  form.agentId = integration.value.agentId
  form.appSecret = ''
  drawerVisible.value = true
  if (!integration.value.secretConfigured) return
  secretLoading.value = true
  try {
    const { data } = await enterpriseIntegrationApi.getDingTalkSecret()
    form.appSecret = data.appSecret
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    secretLoading.value = false
  }
}

async function validateForm() {
  return Boolean(await formRef.value?.validate().catch(() => false))
}

function payload(): SaveDingTalkIntegrationInput {
  const appSecret = form.appSecret?.trim()
  return {
    corpId: form.corpId.trim(),
    clientId: form.clientId.trim(),
    agentId: form.agentId.trim(),
    ...(appSecret ? { appSecret } : {}),
  }
}

async function save() {
  if (!(await validateForm())) return
  saving.value = true
  try {
    const { data } = await enterpriseIntegrationApi.saveDingTalk(payload())
    integration.value = data
    drawerVisible.value = false
    ElMessage.success('钉钉配置已保存')
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
    const { data } = await enterpriseIntegrationApi.testDingTalk(payload())
    integration.value = data.integration
    ;(data.success ? ElMessage.success : ElMessage.error)(data.message)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    testing.value = false
  }
}

async function testSaved() {
  testing.value = true
  try {
    const { data } = await enterpriseIntegrationApi.testDingTalk({
      corpId: integration.value.corpId,
      clientId: integration.value.clientId ?? '',
      agentId: integration.value.agentId,
    })
    integration.value = data.integration
    ;(data.success ? ElMessage.success : ElMessage.error)(data.message)
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
    '关闭后不能生成新的钉钉组织同步预览，已有本地成员和映射不会删除。',
    '关闭钉钉组织同步',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  syncSaving.value = true
  try {
    const { data } = await enterpriseIntegrationApi.updateDingTalkSync({ enabled: false })
    integration.value = data
    ElMessage.success('已关闭钉钉组织同步')
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
    const { data } = await enterpriseIntegrationApi.updateDingTalkSync({
      enabled: true,
      defaultRoleId: selectedDefaultRoleId.value,
    })
    integration.value = data
    syncDialogVisible.value = false
    ElMessage.success('已开启钉钉组织同步')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    syncSaving.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <EnterpriseIntegrationCardShell
    title="钉钉"
    description="对接企业内部应用，用于组织同步、统一登录与工作通知"
    :status-label="status.label"
    :status-type="status.type"
    :loading="loading"
    :can-update="canUpdate"
    :configured="integration.configured"
    :testing="testing"
    :sync-enabled="integration.syncEnabled"
    :sync-disabled="!canUpdate || integration.lastTestSucceeded !== true"
    :sync-saving="syncSaving"
    sync-tip="请先保存配置并完成连接测试"
    data-testid="dingtalk-integration-card"
    @configure="openDrawer"
    @test="testSaved"
    @sync-change="requestSyncChange"
  >
    <template #icon>
      <MessageCircleMore :size="24" />
    </template>
  </EnterpriseIntegrationCardShell>
  <el-drawer v-model="drawerVisible" title="配置钉钉" size="520px" destroy-on-close>
    <el-alert
      title="AppSecret 在服务端加密保存；AppKey 用于 OAuth/token，AgentId 用于发送企业工作通知。"
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
      <el-form-item label="企业 CorpId" prop="corpId"
        ><el-input v-model="form.corpId"
      /></el-form-item>
      <el-form-item label="AppKey / ClientId" prop="clientId"
        ><el-input v-model="form.clientId"
      /></el-form-item>
      <el-form-item label="内部应用 AgentId" prop="agentId"
        ><el-input v-model="form.agentId"
      /></el-form-item>
      <el-form-item label="AppSecret" prop="appSecret">
        <el-input
          v-model="form.appSecret"
          type="password"
          show-password
          autocomplete="new-password"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <div class="flex items-center justify-end gap-2.5">
        <el-button @click="drawerVisible = false">取消</el-button>
        <el-button plain :loading="testing" @click="testDraft">测试连接</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </div>
    </template>
  </el-drawer>

  <el-dialog v-model="syncDialogVisible" title="开启钉钉组织同步" width="480px">
    <el-alert
      title="默认角色只分配给首次由钉钉同步创建的新成员；已有成员角色不会被覆盖。"
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
