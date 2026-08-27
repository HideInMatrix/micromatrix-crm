<script setup lang="ts">
import {
  APPROVAL_INSTANCE_STATUS_LABELS,
  APPROVAL_MODULE_LABELS,
  type ApprovalInstanceVO,
} from '@micromatrix/shared'
import { showFailToast, showSuccessToast } from 'vant'
import { ref } from 'vue'
import { approveTask, myApplications, myPendingApprovals, rejectTask } from '@/api/mobile'
import { extractErrorMessage } from '@/api/http'

const activeTab = ref<'pending' | 'mine'>('pending')
const items = ref<ApprovalInstanceVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)

const detailShow = ref(false)
const current = ref<ApprovalInstanceVO | null>(null)
const comment = ref('')

async function loadMore() {
  loading.value = true
  try {
    const api = activeTab.value === 'pending' ? myPendingApprovals : myApplications
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

function taskStatusLabel(status: string) {
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
              {{ taskStatusLabel(task.status) }}
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
            <van-button type="danger" block plain @click="handleReject">驳回</van-button>
            <van-button type="primary" block @click="handleApprove">同意</van-button>
          </div>
        </template>
      </div>
    </van-popup>
  </div>
</template>
