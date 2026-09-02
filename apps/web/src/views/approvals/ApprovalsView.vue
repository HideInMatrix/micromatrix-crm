<script setup lang="ts">
import {
  APPROVAL_INSTANCE_STATUS_LABELS,
  APPROVAL_MODULE_LABELS,
  type AttachmentVO,
  type ApprovalInstanceVO,
  type ApprovalResourceFieldVO,
} from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ApprovalActionAttachments from '@/components/ApprovalActionAttachments.vue'
import { approvalApi } from '@/api/approvals'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'
import { memberApi, type MemberOption } from '@/api/system'

type ApprovalTab = 'pending' | 'handled' | 'mine' | 'copied'

const route = useRoute()
const router = useRouter()
const activeTab = ref<ApprovalTab>('pending')
const loading = ref(false)
const items = ref<ApprovalInstanceVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10 })

const detailVisible = ref(false)
const current = ref<ApprovalInstanceVO | null>(null)
const comment = ref('')
const fieldSaving = ref(false)
const fieldDraft = reactive<Record<string, unknown>>({})
const actionAttachments = ref<AttachmentVO[]>([])
const addSignVisible = ref(false)
const addSignLoading = ref(false)
const addSignAttachments = ref<AttachmentVO[]>([])
const returnBackVisible = ref(false)
const returnBackLoading = ref(false)
const returnBackAttachments = ref<AttachmentVO[]>([])
const memberOptions = ref<MemberOption[]>([])
const addSignForm = reactive({
  type: 'BEFORE' as 'BEFORE' | 'AFTER',
  signApprover: '',
  comment: '',
})
const returnBackForm = reactive({
  returnToNodeId: '',
  comment: '',
})

async function loadData() {
  loading.value = true
  try {
    const api =
      activeTab.value === 'pending'
        ? approvalApi.myPending
        : activeTab.value === 'handled'
          ? approvalApi.myHandled
          : activeTab.value === 'mine'
            ? approvalApi.myApplications
            : approvalApi.myCopied
    const { data } = await api({ page: query.page, pageSize: query.pageSize })
    items.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function resetFieldDraft() {
  Object.keys(fieldDraft).forEach((key) => delete fieldDraft[key])
  for (const field of current.value?.resourceFields ?? []) {
    if (field.permissionType !== 'EDIT') continue
    fieldDraft[field.fieldId] =
      (field.type === 'date' || field.type === 'datetime') && field.value != null
        ? new Date(Number(field.value))
        : field.value
  }
}

async function refreshDetail(instanceId: string) {
  const { data } = await approvalApi.instanceDetail(instanceId)
  current.value = data
  resetFieldDraft()
}

async function openDetail(row: ApprovalInstanceVO) {
  current.value = row
  comment.value = ''
  actionAttachments.value = []
  detailVisible.value = true
  try {
    await refreshDetail(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function hasEditableResourceFields() {
  return Boolean(
    current.value?.myPendingTaskId &&
      current.value.resourceFields.some((field) => field.permissionType === 'EDIT'),
  )
}

function setFieldDraft(fieldId: string, value: unknown) {
  fieldDraft[fieldId] = value
}

function numberDraft(fieldId: string) {
  const value = fieldDraft[fieldId]
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function dateDraft(fieldId: string) {
  const value = fieldDraft[fieldId]
  if (value instanceof Date) return value
  if (value === undefined || value === null || value === '') return null
  const date = new Date(typeof value === 'number' ? value : String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function selectDraft(fieldId: string, multiple: boolean) {
  const value = fieldDraft[fieldId]
  if (multiple) return Array.isArray(value) ? value.map(String) : []
  return value === undefined || value === null ? '' : String(value)
}

function formatResourceField(field: ApprovalResourceFieldVO) {
  const value = field.value
  if (value === undefined || value === null || value === '') return '-'
  if (field.options?.length) {
    const labels = new Map(field.options.map((option) => [option.value, option.label]))
    if (Array.isArray(value)) return value.map((item) => labels.get(String(item)) ?? String(item)).join('、')
    return labels.get(String(value)) ?? String(value)
  }
  if (field.type === 'date' || field.type === 'datetime') {
    const date = new Date(typeof value === 'number' ? value : Number(value) || String(value))
    if (!Number.isNaN(date.getTime())) {
      return field.type === 'date' ? date.toLocaleDateString() : date.toLocaleString()
    }
  }
  if (Array.isArray(value)) return value.join('、')
  return String(value)
}

async function saveResourceFields() {
  if (!current.value?.myPendingTaskId) return
  const fields = current.value.resourceFields
    .filter((field) => field.permissionType === 'EDIT')
    .map((field) => ({ fieldId: field.fieldId, value: fieldDraft[field.fieldId] }))
  if (!fields.length) return
  fieldSaving.value = true
  try {
    await approvalApi.updateTaskFields(current.value.myPendingTaskId, fields)
    await refreshDetail(current.value.id)
    ElMessage.success('审批字段已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    fieldSaving.value = false
  }
}

function taskAttachments(taskId: string): AttachmentVO[] {
  if (!current.value) return []
  const elementIds = new Set<string>()
  for (const record of current.value.records) {
    if (record.taskId === taskId) elementIds.add(record.id)
  }
  for (const record of current.value.returnBackRecords) {
    if (record.taskId === taskId) elementIds.add(record.id)
  }
  for (const relation of current.value.addSignTasks) {
    if (relation.signTaskId === taskId) elementIds.add(relation.id)
  }
  const unique = new Map<string, AttachmentVO>()
  current.value.approvalAttachments
    .filter((relation) => elementIds.has(relation.elementId))
    .forEach((relation) => unique.set(relation.attachment.id, relation.attachment))
  return [...unique.values()]
}

async function discardTempAttachments(files: AttachmentVO[]) {
  if (!files.length) return
  await Promise.allSettled(files.map((file) => attachmentApi.remove(file.id)))
}

async function cleanupActionAttachments() {
  const files = actionAttachments.value
  actionAttachments.value = []
  await discardTempAttachments(files)
}

async function cleanupAddSignAttachments() {
  const files = addSignAttachments.value
  addSignAttachments.value = []
  await discardTempAttachments(files)
}

async function cleanupReturnBackAttachments() {
  const files = returnBackAttachments.value
  returnBackAttachments.value = []
  await discardTempAttachments(files)
}

async function handleApprove() {
  if (!current.value?.myPendingTaskId) return
  if (current.value.requireComment && !comment.value.trim()) {
    ElMessage.warning('当前审批流要求填写审批意见')
    return
  }
  try {
    await approvalApi.approve(
      current.value.myPendingTaskId,
      comment.value.trim() || undefined,
      actionAttachments.value.map((file) => file.id),
    )
    actionAttachments.value = []
    ElMessage.success('已同意')
    detailVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleReject() {
  if (!current.value?.myPendingTaskId) return
  if (current.value.requireComment && !comment.value.trim()) {
    ElMessage.warning('当前审批流要求填写审批意见')
    return
  }
  try {
    await approvalApi.reject(
      current.value.myPendingTaskId,
      comment.value.trim() || undefined,
      actionAttachments.value.map((file) => file.id),
    )
    actionAttachments.value = []
    ElMessage.success('已驳回')
    detailVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function openAddSign() {
  if (!current.value?.myPendingTaskId || !current.value.canAddSign) return
  addSignForm.type = 'BEFORE'
  addSignForm.signApprover = ''
  addSignForm.comment = ''
  addSignAttachments.value = []
  try {
    const { data } = await memberApi.options()
    memberOptions.value = data
    addSignVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleAddSign() {
  if (!current.value?.myPendingTaskId || !current.value.canAddSign) return
  if (!addSignForm.signApprover) {
    ElMessage.warning('请选择加签审批人')
    return
  }
  addSignLoading.value = true
  try {
    await approvalApi.sign(current.value.myPendingTaskId, {
      type: addSignForm.type,
      signApprover: addSignForm.signApprover,
      comment: addSignForm.comment.trim() || undefined,
      attachmentIds: addSignAttachments.value.map((file) => file.id),
    })
    addSignAttachments.value = []
    ElMessage.success(addSignForm.type === 'BEFORE' ? '前置加签已发起' : '后置加签已发起')
    addSignVisible.value = false
    detailVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    addSignLoading.value = false
  }
}

function openReturnBack() {
  if (!current.value?.myPendingTaskId || !current.value.canReturnBack) return
  returnBackForm.returnToNodeId = current.value.returnBackTargets.at(-1)?.nodeId ?? ''
  returnBackForm.comment = ''
  returnBackAttachments.value = []
  returnBackVisible.value = true
}

async function handleReturnBack() {
  if (!current.value?.myPendingTaskId || !current.value.canReturnBack) return
  if (!returnBackForm.returnToNodeId) {
    ElMessage.warning('请选择退回节点')
    return
  }
  returnBackLoading.value = true
  try {
    await approvalApi.back(current.value.myPendingTaskId, {
      returnToNodeId: returnBackForm.returnToNodeId,
      comment: returnBackForm.comment.trim() || undefined,
      attachmentIds: returnBackAttachments.value.map((file) => file.id),
    })
    returnBackAttachments.value = []
    ElMessage.success('已退回到历史审批节点')
    returnBackVisible.value = false
    detailVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    returnBackLoading.value = false
  }
}

async function handleWithdraw() {
  if (!current.value?.canWithdraw || !current.value.myWithdrawTaskId) return
  const confirmed = await ElMessageBox.confirm('撤回这条已通过的审批任务并重新处理？', '确认撤回', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await approvalApi.revokeTask(current.value.myWithdrawTaskId)
    ElMessage.success('审批任务已撤回')
    detailVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleCancel(row: ApprovalInstanceVO) {
  const confirmed = await ElMessageBox.confirm(`撤回「${row.targetName}」的审批申请？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await approvalApi.cancel(row.id)
    ElMessage.success('已撤回')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function statusTagType(status: string) {
  return status === 'APPROVED'
    ? 'success'
    : status === 'REJECTED'
      ? 'danger'
      : status === 'CANCELED'
        ? 'info'
        : 'primary'
}

function taskStatusLabel(status: string, action?: string | null) {
  if (action === 'BACK') return '已退回'
  return status === 'APPROVED'
    ? '已同意'
    : status === 'REJECTED'
      ? '已驳回'
      : status === 'SKIPPED'
        ? '已跳过'
        : '待处理'
}

function handleTabChange() {
  query.page = 1
  void router.replace({ path: route.path, query: { ...route.query, tab: activeTab.value } })
  loadData()
}

onMounted(() => {
  const tab = typeof route.query.tab === 'string' ? route.query.tab : ''
  if (['pending', 'handled', 'mine', 'copied'].includes(tab)) activeTab.value = tab as ApprovalTab
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="待我审批" name="pending" />
      <el-tab-pane label="我已处理" name="handled" />
      <el-tab-pane label="我发起的" name="mine" />
      <el-tab-pane label="抄送我的" name="copied" />
    </el-tabs>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag size="small">
            {{ APPROVAL_MODULE_LABELS[row.module as keyof typeof APPROVAL_MODULE_LABELS] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="targetName" label="审批对象" min-width="220" show-overflow-tooltip />
      <el-table-column label="摘要" width="160">
        <template #default="{ row }">{{ row.summary ?? '-' }}</template>
      </el-table-column>
      <el-table-column prop="submitterName" label="发起人" width="100" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusTagType(row.status)" size="small">
            {{
              APPROVAL_INSTANCE_STATUS_LABELS[
                row.status as keyof typeof APPROVAL_INSTANCE_STATUS_LABELS
              ]
            }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="发起时间" width="165">
        <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row as ApprovalInstanceVO)">
            {{ row.myPendingTaskId && row.status === 'PENDING' ? '去审批' : '查看' }}
          </el-button>
          <el-button
            v-if="activeTab === 'mine' && row.status === 'PENDING'"
            link
            type="danger"
            @click="handleCancel(row as ApprovalInstanceVO)"
          >
            撤回
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        :total="total"
        :page-size="query.pageSize"
        layout="total, prev, pager, next"
        @current-change="loadData"
      />
    </div>

    <el-dialog
      v-model="detailVisible"
      :title="current?.targetName ?? '审批详情'"
      width="720px"
      @closed="cleanupActionAttachments"
    >
      <div v-if="current">
        <el-descriptions :column="2" border size="small" class="mb-4">
          <el-descriptions-item label="类型">
            {{ APPROVAL_MODULE_LABELS[current.module] }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ APPROVAL_INSTANCE_STATUS_LABELS[current.status] }}
          </el-descriptions-item>
          <el-descriptions-item label="发起人">{{ current.submitterName }}</el-descriptions-item>
          <el-descriptions-item label="摘要">{{ current.summary ?? '-' }}</el-descriptions-item>
        </el-descriptions>

        <div v-if="current.resourceFields.length" class="mb-5">
          <div class="mb-2 flex items-center justify-between">
            <span class="text-sm font-medium">业务字段</span>
            <el-button
              v-if="hasEditableResourceFields()"
              type="primary"
              plain
              size="small"
              :loading="fieldSaving"
              @click="saveResourceFields"
            >
              保存字段
            </el-button>
          </div>
          <el-form label-position="left" label-width="130px" class="rounded border p-3">
            <el-form-item
              v-for="field in current.resourceFields"
              :key="field.fieldId"
              :label="field.label"
              class="mb-3 last:mb-0"
            >
              <template v-if="field.permissionType === 'EDIT' && current.myPendingTaskId">
                <el-input
                  v-if="field.type === 'textarea'"
                  type="textarea"
                  :rows="2"
                  :model-value="String(fieldDraft[field.fieldId] ?? '')"
                  @update:model-value="setFieldDraft(field.fieldId, $event)"
                />
                <el-input-number
                  v-else-if="['number', 'currency', 'percent'].includes(field.type)"
                  :model-value="numberDraft(field.fieldId)"
                  :controls="false"
                  class="w-full"
                  @update:model-value="setFieldDraft(field.fieldId, $event)"
                />
                <el-select
                  v-else-if="field.type === 'select' || field.type === 'multiselect'"
                  :model-value="selectDraft(field.fieldId, field.type === 'multiselect')"
                  :multiple="field.type === 'multiselect'"
                  class="w-full"
                  @update:model-value="setFieldDraft(field.fieldId, $event)"
                >
                  <el-option
                    v-for="option in field.options ?? []"
                    :key="option.value"
                    :label="option.label"
                    :value="option.value"
                  />
                </el-select>
                <el-date-picker
                  v-else-if="field.type === 'date' || field.type === 'datetime'"
                  :model-value="dateDraft(field.fieldId)"
                  :type="field.type === 'datetime' ? 'datetime' : 'date'"
                  class="w-full"
                  @update:model-value="setFieldDraft(field.fieldId, $event)"
                />
                <el-input
                  v-else
                  :model-value="String(fieldDraft[field.fieldId] ?? '')"
                  @update:model-value="setFieldDraft(field.fieldId, $event)"
                />
              </template>
              <span v-else class="text-sm text-[var(--el-text-color-regular)]">
                {{ formatResourceField(field) }}
              </span>
            </el-form-item>
          </el-form>
        </div>

        <el-timeline>
          <el-timeline-item
            :timestamp="new Date(current.createdAt).toLocaleString()"
            type="primary"
            placement="top"
          >
            {{ current.submitterName }} 发起审批
          </el-timeline-item>
          <el-timeline-item
            v-for="task in current.tasks"
            :key="task.id"
            :type="
              task.status === 'APPROVED'
                ? 'success'
                : task.status === 'REJECTED'
                  ? 'danger'
                  : 'info'
            "
            :timestamp="task.handledAt ? new Date(task.handledAt).toLocaleString() : '待处理'"
            placement="top"
          >
            <div class="text-sm">
              {{ task.nodeName }} · {{ task.approverName ?? '-' }} ·
              <span
                :class="
                  task.status === 'APPROVED'
                    ? 'text-[var(--el-color-success)]'
                    : task.status === 'REJECTED'
                      ? 'text-[var(--el-color-danger)]'
                      : ''
                "
              >
                {{ taskStatusLabel(task.status, task.action) }}
              </span>
            </div>
            <div v-if="task.comment" class="text-xs text-[var(--el-text-color-secondary)] mt-1">
              意见：{{ task.comment }}
            </div>
            <ApprovalActionAttachments
              v-if="taskAttachments(task.id).length"
              :model-value="taskAttachments(task.id)"
              readonly
              class="mt-2"
            />
          </el-timeline-item>
        </el-timeline>

        <template v-if="current.myPendingTaskId && current.status === 'PENDING'">
          <div class="mt-2 mb-1 text-sm font-medium">
            审批意见
            <span v-if="current.requireComment" class="text-[var(--el-color-danger)]">*</span>
          </div>
          <el-input
            v-model="comment"
            type="textarea"
            :rows="2"
            :placeholder="current.requireComment ? '审批意见（必填）' : '审批意见（选填）'"
          />
          <ApprovalActionAttachments v-model="actionAttachments" class="mt-3" />
        </template>
      </div>
      <template #footer>
        <template v-if="current?.myPendingTaskId && current?.status === 'PENDING'">
          <el-button v-if="current.canAddSign" @click="openAddSign">加签</el-button>
          <el-button v-if="current.canReturnBack" @click="openReturnBack">退回节点</el-button>
          <el-button type="danger" @click="handleReject">驳回</el-button>
          <el-button type="primary" @click="handleApprove">同意</el-button>
        </template>
        <template v-else>
          <el-button
            v-if="current?.canWithdraw && current?.myWithdrawTaskId"
            type="warning"
            @click="handleWithdraw"
          >
            撤回审批
          </el-button>
          <el-button @click="detailVisible = false">关闭</el-button>
        </template>
      </template>
    </el-dialog>

    <el-dialog
      v-model="addSignVisible"
      title="加签"
      width="460px"
      append-to-body
      @closed="cleanupAddSignAttachments"
    >
      <el-form label-width="92px">
        <el-form-item label="加签方式">
          <el-radio-group v-model="addSignForm.type">
            <el-radio-button value="BEFORE">我之前</el-radio-button>
            <el-radio-button value="AFTER">我之后</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="加签审批人" required>
          <el-select
            v-model="addSignForm.signApprover"
            filterable
            placeholder="选择成员"
            class="w-full"
          >
            <el-option
              v-for="member in memberOptions"
              :key="member.id"
              :label="member.name"
              :value="member.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="addSignForm.comment"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="可填写加签说明"
          />
        </el-form-item>
        <el-form-item label="附件">
          <ApprovalActionAttachments v-model="addSignAttachments" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addSignVisible = false">取消</el-button>
        <el-button type="primary" :loading="addSignLoading" @click="handleAddSign">
          确认加签
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="returnBackVisible"
      title="退回节点"
      width="460px"
      append-to-body
      @closed="cleanupReturnBackAttachments"
    >
      <el-form label-width="92px">
        <el-form-item label="退回到" required>
          <el-select
            v-model="returnBackForm.returnToNodeId"
            class="w-full"
            placeholder="选择历史审批节点"
          >
            <el-option
              v-for="target in current?.returnBackTargets ?? []"
              :key="target.nodeId"
              :label="`${target.nodeName}（重新进入第 ${target.nextRound} 轮）`"
              :value="target.nodeId"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="退回原因">
          <el-input
            v-model="returnBackForm.comment"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            placeholder="可填写退回原因"
          />
        </el-form-item>
        <el-form-item label="附件">
          <ApprovalActionAttachments v-model="returnBackAttachments" class="w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="returnBackVisible = false">取消</el-button>
        <el-button type="primary" :loading="returnBackLoading" @click="handleReturnBack">
          确认退回
        </el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
