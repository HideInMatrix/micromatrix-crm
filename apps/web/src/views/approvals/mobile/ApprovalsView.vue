<script setup lang="ts">
import {
  APPROVAL_INSTANCE_STATUS_LABELS,
  APPROVAL_MODULE_LABELS,
  type ApprovalInstanceVO,
} from '@micromatrix/shared'
import { showFailToast, showSuccessToast } from 'vant'
import { computed, ref } from 'vue'
import {
  approveTask,
  myHandledApprovals,
  myApplications,
  myPendingApprovals,
  rejectTask,
  revokeApprovalTask,
  returnBackTask,
  signTask,
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
const addSignShow = ref(false)
const addSignLoading = ref(false)
const returnBackShow = ref(false)
const returnBackLoading = ref(false)
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

function openDetail(item: ApprovalInstanceVO) {
  current.value = item
  comment.value = ''
  detailShow.value = true
}

async function handleApprove() {
  if (!current.value?.myPendingTaskId) return
  try {
    await approveTask(current.value.myPendingTaskId, comment.value || undefined)
    showSuccessToast('已同意')
    detailShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function handleReject() {
  if (!current.value?.myPendingTaskId) return
  if (!comment.value.trim()) {
    showFailToast('驳回需填写意见')
    return
  }
  try {
    await rejectTask(current.value.myPendingTaskId, comment.value)
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
    })
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
    })
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
  <div class="min-h-full">
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
        <van-cell-group v-for="item in items" :key="item.id" inset class="!mb-3">
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

    <van-popup v-model:show="detailShow" position="bottom" round :style="{ height: '75%' }">
      <div v-if="current" class="p-4 flex flex-col h-full">
        <div class="text-center font-medium mb-3">{{ current.targetName }}</div>
        <div class="text-xs text-gray-500 mb-3">
          {{ APPROVAL_MODULE_LABELS[current.module] }} · {{ current.submitterName }} 发起 ·
          {{ new Date(current.createdAt).toLocaleString() }}
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
          </van-step>
        </van-steps>

        <template v-if="current.myPendingTaskId && current.status === 'PENDING'">
          <van-field
            v-model="comment"
            type="textarea"
            rows="2"
            placeholder="审批意见（驳回时必填）"
            class="!bg-[#f7f8fa] rounded mb-3"
          />
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

    <van-popup v-model:show="addSignShow" position="bottom" round>
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

    <van-popup v-model:show="returnBackShow" position="bottom" round>
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
        <div class="pt-4">
          <van-button type="primary" block :loading="returnBackLoading" @click="handleReturnBack">
            确认退回
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
