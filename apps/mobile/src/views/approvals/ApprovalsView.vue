<script setup lang="ts">
import {
  APPROVAL_INSTANCE_STATUS_LABELS,
  APPROVAL_MODULE_LABELS,
  type AttachmentVO,
  type ApprovalInstanceVO,
  type ApprovalResourceFieldVO,
} from '@micromatrix/shared'
import { showFailToast, showSuccessToast } from 'vant'
import { computed, ref } from 'vue'
import ApprovalActionAttachments from '@/components/ApprovalActionAttachments.vue'
import { attachmentApi } from '@/api/attachments'
import {
  approveTask,
  getApprovalInstanceDetail,
  myHandledApprovals,
  myApplications,
  myPendingApprovals,
  rejectTask,
  revokeApprovalTask,
  returnBackTask,
  signTask,
  updateApprovalTaskFields,
} from '@/api/mobile'
import { extractErrorMessage } from '@/api/http'
import { memberApi, type MemberOption } from '@/api/system'

const activeTab = ref<'pending' | 'handled' | 'mine'>('pending')
const items = ref<ApprovalInstanceVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)

const detailShow = ref(false)
const current = ref<ApprovalInstanceVO | null>(null)
const comment = ref('')
const fieldSaving = ref(false)
const fieldDraft = ref<Record<string, unknown>>({})
const actionAttachments = ref<AttachmentVO[]>([])
const addSignShow = ref(false)
const addSignLoading = ref(false)
const addSignAttachments = ref<AttachmentVO[]>([])
const returnBackShow = ref(false)
const returnBackLoading = ref(false)
const returnBackAttachments = ref<AttachmentVO[]>([])
const returnBackNodeId = ref('')
const returnBackComment = ref('')
const memberPickerShow = ref(false)
const memberOptions = ref<MemberOption[]>([])
const addSignType = ref<'BEFORE' | 'AFTER'>('BEFORE')
const addSignApprover = ref('')
const addSignApproverName = ref('')
const addSignComment = ref('')
const memberColumns = computed(() =>
  memberOptions.value.map((member) => ({ text: member.name, value: member.id })),
)

async function loadMore() {
  loading.value = true
  try {
    const api =
      activeTab.value === 'pending'
        ? myPendingApprovals
        : activeTab.value === 'handled'
          ? myHandledApprovals
          : myApplications
    const { data } = await api({ page: page.value, pageSize: 20 })
    if (refreshing.value) {
      items.value = []
      refreshing.value = false
    }
    items.value.push(...data.items)
    finished.value = items.value.length >= data.total
    page.value += 1
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    finished.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  items.value = []
  finished.value = false
  loadMore()
}

function resetFieldDraft() {
  const next: Record<string, unknown> = {}
  for (const field of current.value?.resourceFields ?? []) {
    if (field.permissionType !== 'EDIT') continue
    if ((field.type === 'date' || field.type === 'datetime') && field.value != null) {
      const date = new Date(Number(field.value))
      if (!Number.isNaN(date.getTime())) {
        next[field.fieldId] =
          field.type === 'date' ? date.toISOString().slice(0, 10) : date.toISOString().slice(0, 16)
        continue
      }
    }
    next[field.fieldId] = field.value
  }
  fieldDraft.value = next
}

async function refreshDetail(instanceId: string) {
  const { data } = await getApprovalInstanceDetail(instanceId)
  current.value = data
  resetFieldDraft()
}

async function openDetail(item: ApprovalInstanceVO) {
  current.value = item
  comment.value = ''
  actionAttachments.value = []
  detailShow.value = true
  try {
    await refreshDetail(item.id)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function mobileInputType(field: ApprovalResourceFieldVO) {
  if (field.type === 'textarea') return 'textarea'
  if (field.type === 'number' || field.type === 'currency' || field.type === 'percent')
    return 'number'
  if (field.type === 'date') return 'date'
  if (field.type === 'datetime') return 'datetime-local'
  return 'text'
}

function setFieldDraft(fieldId: string, value: unknown) {
  fieldDraft.value[fieldId] = value
}

function singleSelectDraft(fieldId: string) {
  const value = fieldDraft.value[fieldId]
  return value === undefined || value === null ? '' : String(value)
}

function multiSelectDraft(fieldId: string) {
  const value = fieldDraft.value[fieldId]
  return Array.isArray(value) ? value.map(String) : []
}

function formatResourceField(field: ApprovalResourceFieldVO) {
  const value = field.value
  if (value === undefined || value === null || value === '') return '-'
  if (field.options?.length) {
    const labels = new Map(field.options.map((option) => [option.value, option.label]))
    if (Array.isArray(value))
      return value.map((item) => labels.get(String(item)) ?? String(item)).join('、')
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

function hasEditableResourceFields() {
  return Boolean(
    current.value?.myPendingTaskId &&
    current.value.resourceFields.some((field) => field.permissionType === 'EDIT'),
  )
}

async function saveResourceFields() {
  if (!current.value?.myPendingTaskId) return
  const fields = current.value.resourceFields
    .filter((field) => field.permissionType === 'EDIT')
    .map((field) => ({ fieldId: field.fieldId, value: fieldDraft.value[field.fieldId] }))
  if (!fields.length) return
  fieldSaving.value = true
  try {
    await updateApprovalTaskFields(current.value.myPendingTaskId, fields)
    await refreshDetail(current.value.id)
    showSuccessToast('审批字段已保存')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    fieldSaving.value = false
  }
}

function taskAttachments(taskId: string): AttachmentVO[] {
  if (!current.value) return []
  const elementIds = new Set<string>()
  current.value.records.forEach((record) => {
    if (record.taskId === taskId) elementIds.add(record.id)
  })
  current.value.returnBackRecords.forEach((record) => {
    if (record.taskId === taskId) elementIds.add(record.id)
  })
  current.value.addSignTasks.forEach((relation) => {
    if (relation.signTaskId === taskId) elementIds.add(relation.id)
  })
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
    showFailToast('当前审批流要求填写审批意见')
    return
  }
  try {
    await approveTask(
      current.value.myPendingTaskId,
      comment.value.trim() || undefined,
      actionAttachments.value.map((file) => file.id),
    )
    actionAttachments.value = []
    showSuccessToast('已同意')
    detailShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function handleReject() {
  if (!current.value?.myPendingTaskId) return
  if (current.value.requireComment && !comment.value.trim()) {
    showFailToast('当前审批流要求填写审批意见')
    return
  }
  try {
    await rejectTask(
      current.value.myPendingTaskId,
      comment.value.trim() || undefined,
      actionAttachments.value.map((file) => file.id),
    )
    actionAttachments.value = []
    showSuccessToast('已驳回')
    detailShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function openAddSign() {
  if (!current.value?.myPendingTaskId || !current.value.canAddSign) return
  addSignType.value = 'BEFORE'
  addSignApprover.value = ''
  addSignApproverName.value = ''
  addSignComment.value = ''
  addSignAttachments.value = []
  try {
    const { data } = await memberApi.options()
    memberOptions.value = data
    addSignShow.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function selectAddSignMember({ selectedValues }: { selectedValues: string[] }) {
  const userId = selectedValues[0]
  const member = memberOptions.value.find((item) => item.id === userId)
  if (!userId || !member) return
  addSignApprover.value = userId
  addSignApproverName.value = member.name
  memberPickerShow.value = false
}

async function handleAddSign() {
  if (!current.value?.myPendingTaskId || !current.value.canAddSign) return
  if (!addSignApprover.value) {
    showFailToast('请选择加签审批人')
    return
  }
  addSignLoading.value = true
  try {
    await signTask(current.value.myPendingTaskId, {
      type: addSignType.value,
      signApprover: addSignApprover.value,
      comment: addSignComment.value.trim() || undefined,
      attachmentIds: addSignAttachments.value.map((file) => file.id),
    })
    addSignAttachments.value = []
    showSuccessToast(addSignType.value === 'BEFORE' ? '前置加签已发起' : '后置加签已发起')
    addSignShow.value = false
    detailShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    addSignLoading.value = false
  }
}

function openReturnBack() {
  if (!current.value?.myPendingTaskId || !current.value.canReturnBack) return
  returnBackNodeId.value = current.value.returnBackTargets.at(-1)?.nodeId ?? ''
  returnBackComment.value = ''
  returnBackAttachments.value = []
  returnBackShow.value = true
}

async function handleReturnBack() {
  if (!current.value?.myPendingTaskId || !current.value.canReturnBack) return
  if (!returnBackNodeId.value) {
    showFailToast('请选择退回节点')
    return
  }
  returnBackLoading.value = true
  try {
    await returnBackTask(current.value.myPendingTaskId, {
      returnToNodeId: returnBackNodeId.value,
      comment: returnBackComment.value.trim() || undefined,
      attachmentIds: returnBackAttachments.value.map((file) => file.id),
    })
    returnBackAttachments.value = []
    showSuccessToast('已退回到历史审批节点')
    returnBackShow.value = false
    detailShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    returnBackLoading.value = false
  }
}

async function handleWithdraw() {
  if (!current.value?.canWithdraw || !current.value.myWithdrawTaskId) return
  try {
    await revokeApprovalTask(current.value.myWithdrawTaskId)
    showSuccessToast('审批任务已撤回')
    detailShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
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
</script>

<template>
  <div class="crm-mobile-page min-h-full">
    <van-nav-bar title="审批" fixed placeholder />

    <van-tabs v-model:active="activeTab" @change="reload">
      <van-tab title="待我审批" name="pending" />
      <van-tab title="我已审批" name="handled" />
      <van-tab title="我发起的" name="mine" />
    </van-tabs>

    <van-pull-refresh v-model="refreshing" @refresh="reload">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="没有更多了"
        @load="loadMore"
      >
        <van-cell-group v-for="item in items" :key="item.id" inset class="crm-mobile-list-card">
          <van-cell :title="item.targetName" is-link @click="openDetail(item)">
            <template #label>
              <div class="text-xs">
                {{ APPROVAL_MODULE_LABELS[item.module] }} · {{ item.submitterName }} ·
                {{ item.summary ?? '' }}
              </div>
            </template>
            <template #value>
              <van-tag
                :type="
                  item.status === 'APPROVED'
                    ? 'success'
                    : item.status === 'REJECTED'
                      ? 'danger'
                      : 'primary'
                "
                size="medium"
              >
                {{ APPROVAL_INSTANCE_STATUS_LABELS[item.status] }}
              </van-tag>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <van-popup
      v-model:show="detailShow"
      position="bottom"
      round
      :style="{ height: '75%' }"
      @closed="cleanupActionAttachments"
    >
      <div v-if="current" class="p-4 flex flex-col h-full">
        <div class="text-center font-medium mb-3">{{ current.targetName }}</div>
        <div class="text-xs text-gray-500 mb-3">
          {{ APPROVAL_MODULE_LABELS[current.module] }} · {{ current.submitterName }} 发起 ·
          {{ new Date(current.createdAt).toLocaleString() }}
        </div>

        <div v-if="current.resourceFields.length" class="mb-3 overflow-y-auto max-h-[38%]">
          <div class="flex items-center justify-between px-1 mb-2">
            <span class="text-sm font-medium">业务字段</span>
            <van-button
              v-if="hasEditableResourceFields()"
              size="mini"
              type="primary"
              plain
              :loading="fieldSaving"
              @click="saveResourceFields"
            >
              保存字段
            </van-button>
          </div>
          <van-cell-group inset class="!mx-0">
            <template v-for="field in current.resourceFields" :key="field.fieldId">
              <template v-if="field.permissionType === 'EDIT' && current.myPendingTaskId">
                <div
                  v-if="field.type === 'select'"
                  class="px-4 py-3 border-b border-[var(--van-border-color)]"
                >
                  <div class="text-sm mb-2">{{ field.label }}</div>
                  <van-radio-group
                    :model-value="singleSelectDraft(field.fieldId)"
                    direction="horizontal"
                    @update:model-value="setFieldDraft(field.fieldId, $event)"
                  >
                    <van-radio
                      v-for="option in field.options ?? []"
                      :key="option.value"
                      :name="option.value"
                    >
                      {{ option.label }}
                    </van-radio>
                  </van-radio-group>
                </div>
                <div
                  v-else-if="field.type === 'multiselect'"
                  class="px-4 py-3 border-b border-[var(--van-border-color)]"
                >
                  <div class="text-sm mb-2">{{ field.label }}</div>
                  <van-checkbox-group
                    :model-value="multiSelectDraft(field.fieldId)"
                    direction="horizontal"
                    @update:model-value="setFieldDraft(field.fieldId, $event)"
                  >
                    <van-checkbox
                      v-for="option in field.options ?? []"
                      :key="option.value"
                      :name="option.value"
                    >
                      {{ option.label }}
                    </van-checkbox>
                  </van-checkbox-group>
                </div>
                <van-field
                  v-else
                  :label="field.label"
                  :type="mobileInputType(field)"
                  :model-value="String(fieldDraft[field.fieldId] ?? '')"
                  :required="field.required"
                  @update:model-value="setFieldDraft(field.fieldId, $event)"
                />
              </template>
              <van-cell v-else :title="field.label" :value="formatResourceField(field)" />
            </template>
          </van-cell-group>
        </div>

        <van-steps
          direction="vertical"
          :active="current.tasks.length"
          class="flex-1 overflow-y-auto"
        >
          <van-step v-for="task in current.tasks" :key="task.id">
            <div class="text-sm">
              {{ task.nodeName }} · {{ task.approverName ?? '-' }} ·
              {{ taskStatusLabel(task.status, task.action) }}
            </div>
            <div v-if="task.comment" class="text-xs text-gray-500 mt-1">
              意见：{{ task.comment }}
            </div>
            <div v-if="task.handledAt" class="text-xs text-gray-400 mt-0.5">
              {{ new Date(task.handledAt).toLocaleString() }}
            </div>
            <ApprovalActionAttachments
              v-if="taskAttachments(task.id).length"
              :model-value="taskAttachments(task.id)"
              readonly
              class="mt-2"
            />
          </van-step>
        </van-steps>

        <template v-if="current.myPendingTaskId && current.status === 'PENDING'">
          <van-field
            v-model="comment"
            type="textarea"
            rows="2"
            :required="current.requireComment"
            :placeholder="current.requireComment ? '审批意见（必填）' : '审批意见（选填）'"
            class="!bg-[var(--text-n9)] rounded-[var(--border-radius-small)] mb-3"
          />
          <ApprovalActionAttachments v-model="actionAttachments" class="mb-3" />
          <div class="flex gap-3 pb-2">
            <van-button v-if="current.canAddSign" block plain @click="openAddSign">加签</van-button>
            <van-button v-if="current.canReturnBack" block plain @click="openReturnBack">
              退回
            </van-button>
            <van-button type="danger" block plain @click="handleReject">驳回</van-button>
            <van-button type="primary" block @click="handleApprove">同意</van-button>
          </div>
        </template>
        <div v-else-if="current.canWithdraw && current.myWithdrawTaskId" class="pb-2">
          <van-button type="warning" block @click="handleWithdraw">撤回审批</van-button>
        </div>
      </div>
    </van-popup>

    <van-popup
      v-model:show="addSignShow"
      position="bottom"
      round
      @closed="cleanupAddSignAttachments"
    >
      <div class="p-4">
        <div class="text-center font-medium mb-4">加签</div>
        <van-radio-group v-model="addSignType" direction="horizontal" class="mb-3">
          <van-radio name="BEFORE">我之前</van-radio>
          <van-radio name="AFTER">我之后</van-radio>
        </van-radio-group>
        <van-field
          v-model="addSignApproverName"
          readonly
          is-link
          label="审批人"
          placeholder="选择成员"
          @click="memberPickerShow = true"
        />
        <van-field
          v-model="addSignComment"
          type="textarea"
          rows="2"
          maxlength="500"
          show-word-limit
          label="说明"
          placeholder="可填写加签说明"
        />
        <ApprovalActionAttachments v-model="addSignAttachments" class="mt-3" />
        <div class="pt-4">
          <van-button type="primary" block :loading="addSignLoading" @click="handleAddSign">
            确认加签
          </van-button>
        </div>
      </div>
    </van-popup>

    <van-popup v-model:show="memberPickerShow" position="bottom" round>
      <van-picker
        :columns="memberColumns"
        @confirm="selectAddSignMember"
        @cancel="memberPickerShow = false"
      />
    </van-popup>

    <van-popup
      v-model:show="returnBackShow"
      position="bottom"
      round
      @closed="cleanupReturnBackAttachments"
    >
      <div class="p-4">
        <div class="text-center font-medium mb-4">退回节点</div>
        <van-radio-group v-model="returnBackNodeId">
          <van-cell-group inset>
            <van-cell
              v-for="target in current?.returnBackTargets ?? []"
              :key="target.nodeId"
              clickable
              :title="target.nodeName"
              :label="`重新进入第 ${target.nextRound} 轮`"
              @click="returnBackNodeId = target.nodeId"
            >
              <template #right-icon>
                <van-radio :name="target.nodeId" />
              </template>
            </van-cell>
          </van-cell-group>
        </van-radio-group>
        <van-field
          v-model="returnBackComment"
          type="textarea"
          rows="2"
          maxlength="500"
          show-word-limit
          label="原因"
          placeholder="可填写退回原因"
        />
        <ApprovalActionAttachments v-model="returnBackAttachments" class="mt-3" />
        <div class="pt-4">
          <van-button type="primary" block :loading="returnBackLoading" @click="handleReturnBack">
            确认退回
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
