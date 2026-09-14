<script setup lang="ts">
import type { EnterpriseIntegrationVO, SaveWeComIntegrationInput } from '@micromatrix/shared'
import type { FormInstance, FormRules } from 'element-plus'
import { MessagesSquare } from 'lucide-vue-next'
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
const form = reactive<SaveWeComIntegrationInput>({
  corpId: '',
  agentId: '',
  appSecret: '',
  redirectUrl: '/',
})

function resolveWorkbenchTarget(value?: string): URL | null {
  const target = value?.trim()
  if (!target) return null
  try {
    const url = target.startsWith('/') ? new URL(target, window.location.origin) : new URL(target)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== window.location.origin) {
      return null
    }
    return url
  } catch {
    return null
  }
}

const workbenchHomeUrl = computed(() => {
  const target = resolveWorkbenchTarget(form.redirectUrl)
  if (!target) return ''
  const url = new URL('/api/auth/wecom/workbench/entry', window.location.origin)
  const tenantSlug = auth.user?.tenantSlug
  if (tenantSlug) url.searchParams.set('tenant', tenantSlug)
  url.searchParams.set('target', target.toString())
  return url.toString()
})

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
  redirectUrl: [
    { required: true, message: '请输入工作台回跳页面', trigger: 'blur' },
    {
      validator: (_rule, value, callback) => {
        if (resolveWorkbenchTarget(String(value ?? ''))) callback()
        else callback(new Error('回跳页面必须是当前 CRM 域名下的 http(s) 地址或 / 开头的站内路径'))
      },
      trigger: 'blur',
    },
  ],
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
  form.redirectUrl = integration.value.redirectUrl || '/'
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
    redirectUrl: form.redirectUrl?.trim(),
    ...(appSecret ? { appSecret } : {}),
  }
}

async function copyWorkbenchHomeUrl() {
  if (!workbenchHomeUrl.value) {
    ElMessage.warning('请先填写有效的工作台回跳页面')
    return
  }
  try {
    await navigator.clipboard.writeText(workbenchHomeUrl.value)
    ElMessage.success('应用主页地址已复制')
  } catch {
    ElMessage.error('复制失败，请手动复制应用主页地址')
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
  <EnterpriseIntegrationCardShell
    title="企业微信"
    description="为企业打造的专业办公管理工具"
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
    data-testid="wecom-integration-card"
    @configure="openDrawer"
    @test="testSaved"
    @sync-change="requestSyncChange"
  >
    <template #icon>
      <MessagesSquare :size="24" />
    </template>
  </EnterpriseIntegrationCardShell>
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
        <div
          class="mt-1.5 flex flex-col items-start gap-1 text-[13px] text-[var(--el-text-color-secondary)]"
        >
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
      <el-form-item label="工作台回跳页面" prop="redirectUrl">
        <el-input
          v-model="form.redirectUrl"
          placeholder="例如：/dashboard 或 https://crm.example.com/dashboard"
        />
        <div class="mt-1.5 text-[13px] leading-5 text-[var(--el-text-color-secondary)]">
          企业微信 OAuth2 静默登录成功后进入的页面。仅允许当前 CRM 同域地址，推荐填写
          <code>/dashboard</code> 这类站内路径。
        </div>
      </el-form-item>
      <el-form-item label="企业微信应用主页地址">
        <el-input
          :model-value="workbenchHomeUrl"
          readonly
          placeholder="请先填写有效的工作台回跳页面"
        >
          <template #append>
            <el-button :disabled="!workbenchHomeUrl" @click="copyWorkbenchHomeUrl">复制</el-button>
          </template>
        </el-input>
        <div
          class="mt-1.5 flex flex-col items-start gap-1 text-[13px] leading-5 text-[var(--el-text-color-secondary)]"
        >
          <span>
            将此完整地址配置到企业微信自建应用的“应用主页”。成员从企业微信工作台打开后，后端会先 302
            到企业微信网页授权，完成静默身份识别后自动进入上方回跳页面。
          </span>
          <el-link
            href="https://developer.work.weixin.qq.com/document/path/91335"
            target="_blank"
            type="primary"
            underline="never"
          >
            查看企业微信网页授权文档
          </el-link>
        </div>
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
