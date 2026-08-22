<script setup lang="ts">
import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  type FollowUpPlanStatus,
  type FollowUpPlanTargetType,
  type FollowUpPlanVO,
} from '@micromatrix/shared'
import { CalendarClock, Plus } from 'lucide-vue-next'
import { onMounted, reactive, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { followUpPlanApi, leadApi, opportunityApi } from '@/api/sales'

interface TargetOption {
  id: string
  name: string
}

const props = withDefaults(
  defineProps<{
    targetType?: FollowUpPlanTargetType
    targetId?: string
    targetName?: string
    canWrite?: boolean
  }>(),
  { targetType: undefined, targetId: undefined, targetName: undefined, canWrite: true },
)

const items = ref<FollowUpPlanVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const status = ref<FollowUpPlanStatus | ''>('')
const mine = ref(!props.targetId)
const formShow = ref(false)
const actionShow = ref(false)
const saving = ref(false)
const editing = ref<FollowUpPlanVO | null>(null)
const current = ref<FollowUpPlanVO | null>(null)
const targets = ref<TargetOption[]>([])
const form = reactive({
  targetType: (props.targetType ?? 'customer') as FollowUpPlanTargetType,
  targetId: props.targetId ?? '',
  method: '电话',
  estimatedAt: '',
  content: '',
})

async function loadMore() {
  loading.value = true
  try {
    const { data } = await followUpPlanApi.list({
      page: page.value,
      pageSize: 20,
      targetType: props.targetType,
      targetId: props.targetId,
      status: status.value || undefined,
      mine: mine.value || undefined,
    })
    if (refreshing.value) refreshing.value = false
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

async function loadTargets() {
  if (props.targetId) {
    targets.value = [{ id: props.targetId, name: props.targetName ?? '当前对象' }]
    return
  }
  try {
    if (form.targetType === 'lead') {
      const { data } = await leadApi.list({ page: 1, pageSize: 100, scope: 'mine' })
      targets.value = data.items.map((item) => ({ id: item.id, name: item.name }))
    } else if (form.targetType === 'customer') {
      const { data } = await listCustomerOptions()
      targets.value = data
    } else {
      const { data } = await opportunityApi.list({ page: 1, pageSize: 100 })
      targets.value = data.items.map((item) => ({ id: item.id, name: item.name }))
    }
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function openCreate(plan?: FollowUpPlanVO) {
  editing.value = plan ?? null
  form.targetType = props.targetType ?? plan?.targetType ?? 'customer'
  form.targetId = props.targetId ?? plan?.targetId ?? ''
  form.method = plan?.method ?? '电话'
  form.estimatedAt = plan?.estimatedAt ? plan.estimatedAt.slice(0, 16) : ''
  form.content = plan?.content ?? ''
  await loadTargets()
  formShow.value = true
}

async function save() {
  if (!form.targetId || !form.content.trim()) {
    showFailToast('请选择计划对象并填写内容')
    return
  }
  saving.value = true
  try {
    const payload = {
      targetType: form.targetType,
      targetId: form.targetId,
      method: form.method || undefined,
      estimatedAt: form.estimatedAt ? new Date(form.estimatedAt).toISOString() : undefined,
      content: form.content.trim(),
    }
    if (editing.value) await followUpPlanApi.update(editing.value.id, payload)
    else await followUpPlanApi.create(payload)
    showSuccessToast(editing.value ? '计划已更新' : '计划已创建')
    formShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function openActions(plan: FollowUpPlanVO) {
  if (!plan.canManage) return
  current.value = plan
  actionShow.value = true
}

async function changeStatus(next: FollowUpPlanStatus) {
  if (!current.value) return
  try {
    await followUpPlanApi.updateStatus(current.value.id, next)
    showSuccessToast('状态已更新')
    actionShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function convert() {
  if (!current.value) return
  try {
    await followUpPlanApi.convert(current.value.id)
    showSuccessToast('已转为跟进记录')
    actionShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function remove() {
  if (!current.value) return
  const confirmed = await showConfirmDialog({
    title: '删除计划',
    message: '确认删除该跟进计划？',
    confirmButtonColor: '#ee0a24',
  }).then(() => true).catch(() => false)
  if (!confirmed) return
  try {
    await followUpPlanApi.remove(current.value.id)
    showSuccessToast('计划已删除')
    actionShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function editCurrent() {
  if (!current.value) return
  actionShow.value = false
  openCreate(current.value)
}

watch(() => form.targetType, () => {
  if (!props.targetId && formShow.value) {
    form.targetId = ''
    loadTargets()
  }
})
onMounted(reload)
</script>

<template>
  <div class="min-h-full">
    <div class="px-3 py-2 bg-white flex gap-2 items-center">
      <select v-model="status" class="h-9 flex-1 rounded border border-[#ebedf0] bg-white px-2" @change="reload">
        <option value="">全部状态</option>
        <option v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS" :key="key" :value="key">{{ label }}</option>
      </select>
      <van-checkbox v-if="!targetId" v-model="mine" shape="square" @change="reload">我的</van-checkbox>
      <van-button v-if="canWrite !== false" type="primary" size="small" @click="openCreate()">
        <span class="inline-flex items-center gap-1"><Plus :size="15" />新建</span>
      </van-button>
    </div>

    <van-pull-refresh v-model="refreshing" @refresh="reload">
      <van-list v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="loadMore">
        <van-empty v-if="finished && items.length === 0" description="暂无跟进计划" />
        <van-cell-group v-for="plan in items" :key="plan.id" inset class="!mt-3">
          <van-cell :title="plan.targetName" :label="plan.content" :is-link="plan.canManage" @click="openActions(plan)">
            <template #value>
              <van-tag :type="plan.status === 'COMPLETED' ? 'success' : plan.status === 'CANCELLED' ? 'warning' : 'primary'">
                {{ FOLLOW_UP_PLAN_STATUS_LABELS[plan.status] }}
              </van-tag>
            </template>
          </van-cell>
          <van-cell>
            <template #title>
              <span class="inline-flex items-center gap-1 text-xs text-gray-500">
                <CalendarClock :size="14" />{{ plan.estimatedAt ? new Date(plan.estimatedAt).toLocaleString() : '未设置时间' }}
              </span>
            </template>
            <template #value>{{ plan.ownerName }}<span v-if="plan.converted"> · 已转记录</span></template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <van-popup v-model:show="formShow" position="bottom" round :style="{ height: '78%' }">
      <div class="h-full flex flex-col">
        <div class="p-4 text-center font-medium">{{ editing ? '编辑跟进计划' : '新建跟进计划' }}</div>
        <div class="flex-1 overflow-auto px-4 space-y-3">
          <template v-if="!targetId">
            <van-field label="对象类型">
              <template #input>
                <select v-model="form.targetType" class="w-full bg-transparent">
                  <option value="customer">客户</option><option value="lead">线索</option><option value="opportunity">商机</option>
                </select>
              </template>
            </van-field>
            <van-field label="计划对象">
              <template #input>
                <select v-model="form.targetId" class="w-full bg-transparent">
                  <option value="">请选择</option><option v-for="item in targets" :key="item.id" :value="item.id">{{ item.name }}</option>
                </select>
              </template>
            </van-field>
          </template>
          <van-field v-else label="计划对象" :model-value="targetName" readonly />
          <van-field label="跟进方式">
            <template #input>
              <select v-model="form.method" class="w-full bg-transparent">
                <option v-for="item in ['电话', '拜访', '微信', '邮件', '会议', '其他']" :key="item">{{ item }}</option>
              </select>
            </template>
          </van-field>
          <van-field label="计划时间">
            <template #input><input v-model="form.estimatedAt" type="datetime-local" class="w-full bg-transparent" /></template>
          </van-field>
          <van-field v-model="form.content" label="计划内容" type="textarea" rows="4" maxlength="3000" show-word-limit />
        </div>
        <div class="p-4"><van-button type="primary" block :loading="saving" @click="save">保存</van-button></div>
      </div>
    </van-popup>

    <van-action-sheet v-model:show="actionShow" title="计划操作">
      <div v-if="current" class="p-4 space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <van-button v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS" :key="key" plain size="small" :disabled="current.status === 'COMPLETED' && current.converted" @click="changeStatus(key as FollowUpPlanStatus)">
            {{ label }}
          </van-button>
        </div>
        <van-button v-if="current.status === 'COMPLETED' && !current.converted" type="success" block @click="convert">转跟进记录</van-button>
        <van-button block @click="editCurrent">编辑</van-button>
        <van-button type="danger" plain block @click="remove">删除</van-button>
      </div>
    </van-action-sheet>
  </div>
</template>
