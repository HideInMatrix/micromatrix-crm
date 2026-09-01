<script setup lang="ts">
import {
  APPROVAL_FORM_TYPE_LABELS,
  DUPLICATE_APPROVER_RULE_LABELS,
  type ApprovalFlowDetail,
  type ApprovalFlowNodeInput,
  type ApprovalFlowWriteInput,
  type ApprovalFormType,
} from '@micromatrix/shared'
import { Check, GitBranch, Info, Settings2 } from 'lucide-vue-next'
import { computed, reactive, ref, watch } from 'vue'
import { approvalApi } from '@/api/approvals'
import { extractErrorMessage } from '@/api/http'
import { memberApi, roleApi, type MemberOption, type RoleOption } from '@/api/system'
import ApprovalFlowCanvas from './ApprovalFlowCanvas.vue'

type DrawerMode = 'create' | 'edit' | 'detail'
type DrawerStep = 'basic' | 'flow' | 'settings'

const props = defineProps<{
  mode: DrawerMode
  flowId?: string | null
}>()

const emit = defineEmits<{ saved: [] }>()
const visible = defineModel<boolean>({ required: true })
const activeStep = ref<DrawerStep>('basic')
const loading = ref(false)
const saving = ref(false)
const members = ref<MemberOption[]>([])
const roles = ref<RoleOption[]>([])
const detail = ref<ApprovalFlowDetail | null>(null)
const initialSnapshot = ref('')

const form = reactive<ApprovalFlowWriteInput>(createDefaultForm())

function createDefaultForm(): ApprovalFlowWriteInput {
  return {
    formType: 'contract',
    name: '',
    description: null,
    enabled: false,
    createExecute: true,
    updateExecute: false,
    deleteExecute: false,
    submitterCanRevoke: true,
    allowBatchProcess: false,
    allowWithdraw: false,
    allowAddSign: false,
    duplicateApproverRule: 'FIRST_ONLY',
    requireComment: false,
    condition: null,
    createNodes: [],
  }
}

function replaceForm(value: ApprovalFlowWriteInput) {
  Object.assign(form, createDefaultForm(), value)
  form.createNodes = value.createNodes.map((node) => ({
    ...node,
    approverIds: [...node.approverIds],
    ccUserIds: [...(node.ccUserIds ?? [])],
  }))
}

function serializeForm() {
  return JSON.stringify({
    ...form,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    createNodes: form.createNodes.map(({ clientId: _clientId, ...node }) => ({
      ...node,
      name: node.name.trim(),
      approverIds: [...node.approverIds].sort(),
      ccUserIds: [...(node.ccUserIds ?? [])].sort(),
    })),
  })
}

const readonly = computed(() => props.mode === 'detail')
const dirty = computed(() => !readonly.value && initialSnapshot.value !== serializeForm())
const drawerTitle = computed(() => {
  if (props.mode === 'create') return '新建流程'
  if (props.mode === 'edit') return `编辑流程${detail.value ? ` · ${detail.value.number}` : ''}`
  return `流程详情${detail.value ? ` · ${detail.value.number}` : ''}`
})
const supportsExtendedTiming = computed(() => form.formType !== 'order')
const amountGte = computed<number | undefined>({
  get: () => form.condition?.amountGte,
  set: (value) => {
    form.condition = value === undefined || value === null ? null : { amountGte: value }
  },
})

function toWriteInput(source: ApprovalFlowDetail): ApprovalFlowWriteInput {
  const nodes: ApprovalFlowNodeInput[] = source.createNodes
    .filter((node) => node.nodeType === 'APPROVER' && node.approverType && node.mode)
    .map((node) => ({
      clientId: node.id,
      name: node.name,
      approverType: node.approverType!,
      approverIds: [...(node.approverIds ?? [])],
      ccUserIds: [...(node.ccUserIds ?? [])],
      mode: node.mode!,
    }))
  return {
    formType: source.formType,
    name: source.name,
    description: source.description,
    enabled: source.enabled,
    createExecute: source.createExecute,
    updateExecute: source.updateExecute,
    deleteExecute: source.deleteExecute,
    submitterCanRevoke: source.submitterCanRevoke,
    allowBatchProcess: source.allowBatchProcess,
    allowWithdraw: source.allowWithdraw,
    allowAddSign: source.allowAddSign,
    duplicateApproverRule: source.duplicateApproverRule,
    requireComment: source.requireComment,
    condition: source.condition,
    createNodes: nodes,
  }
}

async function initialize() {
  activeStep.value = 'basic'
  loading.value = true
  detail.value = null
  replaceForm(createDefaultForm())
  try {
    const optionPromise = Promise.all([memberApi.options(), roleApi.options()])
    const detailPromise = props.flowId ? approvalApi.flowDetail(props.flowId) : null
    const [[memberResponse, roleResponse], detailResponse] = await Promise.all([
      optionPromise,
      detailPromise,
    ])
    members.value = memberResponse.data
    roles.value = roleResponse.data
    if (detailResponse) {
      detail.value = detailResponse.data
      replaceForm(toWriteInput(detailResponse.data))
    }
    initialSnapshot.value = serializeForm()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    visible.value = false
  } finally {
    loading.value = false
  }
}

watch(visible, (value) => value && initialize())

function setFormType(value: ApprovalFormType) {
  form.formType = value
  if (!form.name) form.name = `${APPROVAL_FORM_TYPE_LABELS[value]}审批流程`
  if (value === 'order') {
    form.updateExecute = false
    form.deleteExecute = false
  }
}

function validate() {
  if (!form.name.trim()) {
    activeStep.value = 'basic'
    ElMessage.warning('请填写流程名称')
    return false
  }
  if (form.enabled && form.createNodes.length === 0) {
    activeStep.value = 'flow'
    ElMessage.warning('启用的流程至少需要一个审批节点')
    return false
  }
  for (const node of form.createNodes) {
    if (!node.name.trim()) {
      activeStep.value = 'flow'
      ElMessage.warning('审批节点名称不能为空')
      return false
    }
    if (
      (node.approverType === 'USER' || node.approverType === 'ROLE') &&
      node.approverIds.length === 0
    ) {
      activeStep.value = 'flow'
      ElMessage.warning(`节点「${node.name}」尚未选择审批对象`)
      return false
    }
  }
  return true
}

async function save() {
  if (!validate()) return
  saving.value = true
  const payload: ApprovalFlowWriteInput = {
    ...form,
    name: form.name.trim(),
    description: form.description?.trim() || null,
    createNodes: form.createNodes.map(({ clientId, ...node }) => ({ ...node, clientId })),
  }
  try {
    if (props.mode === 'create') {
      await approvalApi.createFlow(payload)
    } else if (props.flowId) {
      const { formType: _formType, ...updatePayload } = payload
      await approvalApi.updateFlow(props.flowId, updatePayload)
    }
    ElMessage.success(props.mode === 'create' ? '流程已创建' : '流程已保存')
    initialSnapshot.value = serializeForm()
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function beforeClose(done: () => void) {
  if (!dirty.value) {
    done()
    return
  }
  ElMessageBox.confirm('当前修改尚未保存，确定关闭吗？', '放弃修改', { type: 'warning' })
    .then(done)
    .catch(() => undefined)
}

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}
</script>

<template>
  <el-drawer
    v-model="visible"
    :title="drawerTitle"
    size="1080px"
    :before-close="beforeClose"
    destroy-on-close
    class="approval-flow-drawer"
  >
    <div v-loading="loading" class="drawer-layout">
      <nav class="step-nav">
        <button
          type="button"
          :class="{ active: activeStep === 'basic' }"
          @click="activeStep = 'basic'"
        >
          <Info :size="18" />
          <span><strong>基本信息</strong><small>表单与执行时机</small></span>
        </button>
        <button
          type="button"
          :class="{ active: activeStep === 'flow' }"
          @click="activeStep = 'flow'"
        >
          <GitBranch :size="18" />
          <span><strong>流程设计</strong><small>审批节点与顺序</small></span>
        </button>
        <button
          type="button"
          :class="{ active: activeStep === 'settings' }"
          @click="activeStep = 'settings'"
        >
          <Settings2 :size="18" />
          <span><strong>审批设置</strong><small>撤回与重复审批</small></span>
        </button>
      </nav>

      <main class="step-content">
        <section v-show="activeStep === 'basic'">
          <div class="section-title">基本信息</div>
          <el-form label-position="top" class="content-form">
            <div class="form-grid">
              <el-form-item label="表单类型" required>
                <el-select
                  :model-value="form.formType"
                  :disabled="readonly || mode !== 'create'"
                  class="w-full"
                  @change="setFormType"
                >
                  <el-option
                    v-for="(label, value) in APPROVAL_FORM_TYPE_LABELS"
                    :key="value"
                    :label="label"
                    :value="value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="流程名称" required>
                <el-input
                  v-model="form.name"
                  :disabled="readonly"
                  maxlength="255"
                  show-word-limit
                />
              </el-form-item>
            </div>
            <el-form-item label="流程说明">
              <el-input
                v-model="form.description"
                :disabled="readonly"
                type="textarea"
                :rows="3"
                maxlength="1000"
                show-word-limit
              />
            </el-form-item>

            <el-form-item label="简化入口条件">
              <div class="flex items-center gap-3">
                <span class="text-sm">单据金额 ≥</span>
                <el-input-number
                  v-model="amountGte"
                  :disabled="readonly"
                  :min="0"
                  :precision="2"
                  controls-position="right"
                  placeholder="留空则全部"
                />
                <span class="text-xs text-[var(--el-text-color-secondary)]">
                  暂沿用现有金额门槛；图形条件节点后续接入。
                </span>
              </div>
            </el-form-item>

            <div class="subsection-title">执行时机</div>
            <div class="timing-list">
              <div class="timing-item">
                <div><strong>新建时执行</strong><small>单据提交确认时触发审批</small></div>
                <el-switch v-model="form.createExecute" :disabled="readonly" />
              </div>
              <div class="timing-item" :class="{ 'is-disabled': !supportsExtendedTiming }">
                <div>
                  <strong>编辑时执行</strong><small>编辑保存后进入审批，驳回或撤回时恢复编辑前快照</small>
                </div>
                <el-switch v-model="form.updateExecute" :disabled="readonly || !supportsExtendedTiming" />
              </div>
              <div class="timing-item" :class="{ 'is-disabled': !supportsExtendedTiming }">
                <div>
                  <strong>删除时执行</strong><small>命中流程时先进入审批，通过后才真正删除</small>
                </div>
                <el-switch v-model="form.deleteExecute" :disabled="readonly || !supportsExtendedTiming" />
              </div>
            </div>

            <div class="mt-6 flex items-center gap-3">
              <span class="font-medium">流程状态</span>
              <el-switch
                v-model="form.enabled"
                :disabled="readonly"
                active-text="启用"
                inactive-text="停用"
              />
            </div>
          </el-form>
        </section>

        <section v-if="activeStep === 'flow'">
          <ApprovalFlowCanvas
            v-model="form.createNodes"
            :readonly="readonly"
            :members="members"
            :roles="roles"
          />
        </section>

        <section v-show="activeStep === 'settings'">
          <div class="section-title">审批设置</div>
          <div class="settings-panel">
            <div class="setting-row">
              <div>
                <strong>允许发起人撤回</strong><small>审批完成前，发起人可撤回自己提交的流程</small>
              </div>
              <el-switch v-model="form.submitterCanRevoke" :disabled="readonly" />
            </div>
            <div class="setting-row is-disabled">
              <div>
                <strong>允许批量审批</strong><small>待任务中心批量处理能力接入后开放</small>
              </div>
              <el-switch v-model="form.allowBatchProcess" disabled />
            </div>
            <div class="setting-row">
              <div>
                <strong>允许审批人撤回</strong><small>开启后，审批人可撤回自己仍处于可逆路径的已通过任务</small>
              </div>
              <el-switch v-model="form.allowWithdraw" :disabled="readonly" />
            </div>
            <div class="setting-row">
              <div>
                <strong>允许审批人加签</strong><small>开启后，当前待办审批人可执行前置或后置加签</small>
              </div>
              <el-switch v-model="form.allowAddSign" :disabled="readonly" />
            </div>
            <div class="setting-row is-disabled">
              <div><strong>审批意见必填</strong><small>运行时尚未统一强制校验</small></div>
              <el-switch v-model="form.requireComment" disabled />
            </div>
            <div class="setting-row setting-row--select is-disabled">
              <div>
                <strong>同一审批人重复出现</strong
                ><small>当前运行时固定为只处理首次出现的节点</small>
              </div>
              <el-select v-model="form.duplicateApproverRule" disabled class="!w-56">
                <el-option
                  v-for="(label, value) in DUPLICATE_APPROVER_RULE_LABELS"
                  :key="value"
                  :label="label"
                  :value="value"
                />
              </el-select>
            </div>
          </div>

          <el-descriptions v-if="detail" class="mt-6" :column="2" border>
            <el-descriptions-item label="当前版本"
              >V{{ detail.currentVersion }}</el-descriptions-item
            >
            <el-descriptions-item label="运行时状态">
              <el-tag :type="detail.runtimeReady ? 'success' : 'warning'">
                {{ detail.runtimeReady ? '已接入' : '仅配置底座' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="创建人">{{
              detail.createdByName || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="创建时间">{{
              formatDate(detail.createdAt)
            }}</el-descriptions-item>
            <el-descriptions-item label="最后修改人">{{
              detail.updatedByName || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="修改时间">{{
              formatDate(detail.updatedAt)
            }}</el-descriptions-item>
          </el-descriptions>
        </section>
      </main>
    </div>

    <template #footer>
      <div class="flex justify-between">
        <span class="text-xs text-[var(--el-text-color-secondary)]">
          {{
            readonly
              ? '详情模式不会修改流程'
              : '节点定义变化会自动生成新版本，历史审批仍使用原版本快照'
          }}
        </span>
        <div>
          <el-button @click="visible = false">{{ readonly ? '关闭' : '取消' }}</el-button>
          <el-button v-if="!readonly" type="primary" :icon="Check" :loading="saving" @click="save">
            保存
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.drawer-layout {
  display: grid;
  min-height: calc(100vh - 170px);
  grid-template-columns: 190px minmax(0, 1fr);
}

.step-nav {
  padding: 6px 16px 0 0;
  border-right: 1px solid var(--el-border-color-lighter);
}

.step-nav button {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 6px;
  padding: 12px;
  color: var(--el-text-color-regular);
  text-align: left;
  border: 0;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
}

.step-nav button.active {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.step-nav strong,
.step-nav small {
  display: block;
}

.step-nav small {
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.step-content {
  min-width: 0;
  padding-left: 22px;
}

.section-title {
  margin-bottom: 20px;
  font-size: 18px;
  font-weight: 600;
}

.subsection-title {
  margin: 8px 0 12px;
  font-weight: 600;
}

.content-form {
  max-width: 780px;
}

.form-grid {
  display: grid;
  gap: 18px;
  grid-template-columns: 1fr 1fr;
}

.timing-list,
.settings-panel {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 9px;
}

.timing-item,
.setting-row {
  display: flex;
  min-height: 66px;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.timing-item:last-child,
.setting-row:last-child {
  border-bottom: 0;
}

.timing-item small,
.setting-row small {
  display: block;
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.is-disabled {
  background: var(--el-fill-color-extra-light);
}

.setting-row--select {
  min-height: 80px;
}

@media (max-width: 900px) {
  .drawer-layout {
    grid-template-columns: 1fr;
  }

  .step-nav {
    display: flex;
    gap: 6px;
    margin-bottom: 18px;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--el-border-color-lighter);
  }

  .step-content {
    padding-left: 0;
  }
}
</style>
