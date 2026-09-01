<script setup lang="ts">
import {
  APPROVAL_INSTANCE_STATUS_LABELS,
  APPROVAL_MODULE_LABELS,
  type ApprovalInstanceVO,
} from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { approvalApi } from '@/api/approvals'
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
const addSignVisible = ref(false)
const addSignLoading = ref(false)
const returnBackVisible = ref(false)
const returnBackLoading = ref(false)
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

function openDetail(row: ApprovalInstanceVO) {
  current.value = row
  comment.value = ''
  detailVisible.value = true
}

async function handleApprove() {
  if (!current.value?.myPendingTaskId) return
  try {
    await approvalApi.approve(current.value.myPendingTaskId, comment.value || undefined)
    ElMessage.success('已同意')
    detailVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleReject() {
  if (!current.value?.myPendingTaskId) return
  if (!comment.value.trim()) {
    ElMessage.warning('驳回需填写审批意见')
    return
  }
  try {
    await approvalApi.reject(current.value.myPendingTaskId, comment.value)
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
    })
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
    })
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

    <el-dialog v-model="detailVisible" :title="current?.targetName ?? '审批详情'" width="560px">
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
          </el-timeline-item>
        </el-timeline>

        <template v-if="current.myPendingTaskId && current.status === 'PENDING'">
          <el-input
            v-model="comment"
            type="textarea"
            :rows="2"
            placeholder="审批意见（驳回时必填）"
            class="mt-2"
          />
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

    <el-dialog v-model="addSignVisible" title="加签" width="460px" append-to-body>
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
      </el-form>
      <template #footer>
        <el-button @click="addSignVisible = false">取消</el-button>
        <el-button type="primary" :loading="addSignLoading" @click="handleAddSign">
          确认加签
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="returnBackVisible" title="退回节点" width="460px" append-to-body>
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
