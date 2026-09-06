<script setup lang="ts">
import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  isFollowUpPlanSystemFieldKey,
  type FieldVO,
  type FollowUpPlanStatus,
  type FollowUpPlanTargetType,
  type FollowUpPlanVO,
} from '@micromatrix/shared'
import { CalendarClock, Plus } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { contactApi, followUpPlanApi, leadApi, opportunityApi } from '@/api/sales'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import MobileFollowCommentSheet from '@/components/MobileFollowCommentSheet.vue'
import MobileFollowRecordFormSheet from '@/components/MobileFollowRecordFormSheet.vue'
import MobileFollowUpPlanSystemField from '@/components/MobileFollowUpPlanSystemField.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

interface TargetOption {
  id: string
  name: string
  customerId?: string
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

const auth = useAuthStore()
const items = ref<FollowUpPlanVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const status = ref<FollowUpPlanStatus | ''>('')
const mine = ref(!props.targetId)
const formShow = ref(false)
const actionShow = ref(false)
const commentShow = ref(false)
const recordFormShow = ref(false)
const saving = ref(false)
const resetting = ref(false)
const editing = ref<FollowUpPlanVO | null>(null)
const current = ref<FollowUpPlanVO | null>(null)
const convertingPlan = ref<FollowUpPlanVO | null>(null)
const targets = ref<TargetOption[]>([])
const contacts = ref<{ id: string; name: string }[]>([])
const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const formModel = ref<Record<string, unknown>>({})
const metaLoaded = ref(false)

const targetLocked = computed(() => Boolean(props.targetType && props.targetId))
const currentTargetType = computed<FollowUpPlanTargetType>(() => {
  const value = formModel.value.targetType
  return value === 'lead' || value === 'opportunity' || value === 'customer' ? value : 'customer'
})
const currentTargetId = computed(() => stringValue('targetId'))
const writableDynamicFields = computed(() =>
  fields.value.filter((field) => !field.system && field.type !== 'formula'),
)
const visibleFormFields = computed(() =>
  fields.value.filter(
    (field) =>
      !field.hidden &&
      field.type !== 'formula' &&
      field.mobile !== false &&
      fieldFilter(field),
  ),
)

function stringValue(key: string) {
  const value = formModel.value[key]
  return typeof value === 'string' ? value : ''
}

function fieldFilter(field: FieldVO) {
  if (field.key === 'contactId' && currentTargetType.value === 'lead') return false
  return true
}

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
  void loadMore()
}

async function loadTargets() {
  if (props.targetId) {
    targets.value = [{ id: props.targetId, name: props.targetName ?? '当前对象' }]
    return
  }
  try {
    if (currentTargetType.value === 'lead') {
      const { data } = await leadApi.list({ page: 1, pageSize: 100, scope: 'mine' })
      targets.value = data.items.map((item) => ({ id: item.id, name: item.name }))
    } else if (currentTargetType.value === 'customer') {
      const { data } = await listCustomerOptions()
      targets.value = data
    } else {
      const { data } = await opportunityApi.list({ page: 1, pageSize: 100 })
      targets.value = data.items.map((item) => ({
        id: item.id,
        name: item.name,
        customerId: item.customerId,
      }))
    }
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function resolveOpportunityCustomerId() {
  const fromOptions = targets.value.find((item) => item.id === currentTargetId.value)?.customerId
  if (fromOptions) return fromOptions
  if (!currentTargetId.value) return ''
  try {
    return (await opportunityApi.get(currentTargetId.value)).data.customerId
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    return ''
  }
}

async function loadContacts() {
  contacts.value = []
  if (currentTargetType.value === 'lead') return
  const customerId =
    currentTargetType.value === 'customer'
      ? currentTargetId.value
      : await resolveOpportunityCustomerId()
  if (!customerId) return
  try {
    const { data } = await contactApi.list(customerId)
    contacts.value = data.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function defaultFieldModel() {
  return Object.fromEntries(fields.value.map((field) => [field.key, field.config?.defaultValue]))
}

function dynamicValues(plan?: FollowUpPlanVO | null) {
  const byId = new Map((plan?.moduleFields ?? []).map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(writableDynamicFields.value.map((field) => [field.key, byId.get(field.id)]))
}

function moduleFieldsPayload() {
  return writableDynamicFields.value.map((field) => ({
    fieldId: field.id,
    fieldValue: formModel.value[field.key],
  }))
}

function isEmpty(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function hasMissingRequiredField() {
  return visibleFormFields.value.some((field) => field.required && isEmpty(formModel.value[field.key]))
}

async function loadMeta() {
  if (metaLoaded.value) return
  const [{ data }] = await Promise.all([followUpPlanApi.moduleForm(), fieldRefs.load()])
  fields.value = data.fields.filter(
    (field) => !field.system || isFollowUpPlanSystemFieldKey(field.key),
  )
  metaLoaded.value = true
}

async function openCreate(plan?: FollowUpPlanVO) {
  try {
    await loadMeta()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    return
  }

  resetting.value = true
  try {
    editing.value = plan ?? null
    const targetType = props.targetType ?? plan?.targetType ?? 'customer'
    const targetId = props.targetId ?? plan?.targetId ?? ''
    formModel.value = {
      ...defaultFieldModel(),
      ...dynamicValues(plan),
      targetType,
      targetId,
      contactId: plan?.contactId ?? '',
      method: plan?.method ?? '电话',
      estimatedAt: plan?.estimatedAt ?? '',
      content: plan?.content ?? '',
      ownerId: plan?.ownerId ?? auth.user?.id ?? '',
      status: plan?.status ?? 'PREPARED',
    }
    await loadTargets()
    await loadContacts()
    formShow.value = true
  } finally {
    resetting.value = false
  }
}

async function save() {
  if (hasMissingRequiredField()) {
    showFailToast('请填写所有必填字段')
    return
  }
  const targetId = currentTargetId.value
  const content = stringValue('content').trim()
  if (!targetId || !content) {
    showFailToast('请选择计划对象并填写内容')
    return
  }

  saving.value = true
  try {
    const payload = {
      targetType: currentTargetType.value,
      targetId,
      contactId: stringValue('contactId') || undefined,
      method: stringValue('method') || undefined,
      estimatedAt: stringValue('estimatedAt') || undefined,
      content,
      ownerId: stringValue('ownerId') || undefined,
      moduleFields: moduleFieldsPayload(),
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
  current.value = plan
  actionShow.value = true
}

function openComments() {
  if (!current.value) return
  actionShow.value = false
  commentShow.value = true
}

function handleCommentCount(count: number) {
  if (!current.value) return
  current.value.commentCount = count
  const item = items.value.find((plan) => plan.id === current.value?.id)
  if (item) item.commentCount = count
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

function convert() {
  if (!current.value) return
  convertingPlan.value = current.value
  actionShow.value = false
  recordFormShow.value = true
}

async function remove() {
  if (!current.value) return
  const confirmed = await showConfirmDialog({
    title: '删除计划',
    message: '确认删除该跟进计划？',
    confirmButtonColor: 'var(--error-red)',
  })
    .then(() => true)
    .catch(() => false)
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
  void openCreate(current.value)
}

watch(
  () => formModel.value.targetType,
  async () => {
    if (!formShow.value || targetLocked.value || resetting.value) return
    formModel.value.targetId = ''
    formModel.value.contactId = ''
    await loadTargets()
  },
)
watch(
  () => formModel.value.targetId,
  async () => {
    if (!formShow.value || resetting.value) return
    formModel.value.contactId = ''
    await loadContacts()
  },
)
onMounted(reload)
</script>

<template>
  <div class="min-h-full">
    <div class="px-3 py-2 bg-white flex gap-2 items-center">
      <select
        v-model="status"
        class="h-9 flex-1 rounded border border-[var(--text-n8)] bg-[var(--text-n10)] px-2"
        @change="reload"
      >
        <option value="">全部状态</option>
        <option v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS" :key="key" :value="key">
          {{ label }}
        </option>
      </select>
      <van-checkbox v-if="!targetId" v-model="mine" shape="square" @change="reload">我的</van-checkbox>
      <van-button v-if="canWrite !== false" type="primary" size="small" @click="openCreate()">
        <span class="inline-flex items-center gap-1"><Plus :size="15" />新建</span>
      </van-button>
    </div>

    <van-pull-refresh v-model="refreshing" @refresh="reload">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="没有更多了"
        @load="loadMore"
      >
        <van-empty v-if="finished && items.length === 0" description="暂无跟进计划" />
        <van-cell-group v-for="plan in items" :key="plan.id" inset class="!mt-3">
          <van-cell :title="plan.targetName" :label="plan.content" is-link @click="openActions(plan)">
            <template #value>
              <van-tag
                :type="
                  plan.status === 'COMPLETED'
                    ? 'success'
                    : plan.status === 'CANCELLED'
                      ? 'warning'
                      : 'primary'
                "
              >
                {{ FOLLOW_UP_PLAN_STATUS_LABELS[plan.status] }}
              </van-tag>
            </template>
          </van-cell>
          <van-cell>
            <template #title>
              <span class="inline-flex items-center gap-1 text-xs text-gray-500">
                <CalendarClock :size="14" />{{
                  plan.estimatedAt ? new Date(plan.estimatedAt).toLocaleString() : '未设置时间'
                }}
              </span>
            </template>
            <template #value>
              {{ plan.ownerName }}<span v-if="plan.converted"> · 已转记录</span
              ><span v-if="plan.commentCount"> · 评论 {{ plan.commentCount }}</span>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <van-popup
      v-model:show="formShow"
      position="bottom"
      round
      :style="{ height: '82%' }"
      data-testid="mobile-follow-plan-form"
    >
      <div class="h-full flex flex-col">
        <div class="p-4 text-center font-medium">
          {{ editing ? '编辑跟进计划' : '新建跟进计划' }}
        </div>
        <div class="flex-1 overflow-auto py-2" data-testid="mobile-follow-plan-dynamic-fields">
          <MobileDynamicForm
            v-model="formModel"
            :fields="fields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
            :field-filter="fieldFilter"
          >
            <template #system-field="{ field, value, setValue }">
              <MobileFollowUpPlanSystemField
                :field="field"
                :model-value="value"
                :target-locked="targetLocked"
                :targets="targets"
                :contacts="contacts"
                :members="fieldRefs.members.value"
                @update:model-value="setValue"
              />
            </template>
          </MobileDynamicForm>
        </div>
        <div class="p-4">
          <van-button
            data-testid="mobile-follow-plan-save"
            type="primary"
            block
            :loading="saving"
            @click="save"
          >
            保存
          </van-button>
        </div>
      </div>
    </van-popup>

    <van-action-sheet v-model:show="actionShow" title="计划操作">
      <div v-if="current" class="p-4 space-y-3">
        <van-button block plain data-testid="mobile-follow-plan-comments" @click="openComments">
          评论{{ current.commentCount ? ` ${current.commentCount}` : '' }}
        </van-button>
        <div v-if="current.canManage" class="grid grid-cols-2 gap-2">
          <van-button
            v-for="(label, key) in FOLLOW_UP_PLAN_STATUS_LABELS"
            :key="key"
            plain
            size="small"
            :disabled="current.status === 'COMPLETED' && current.converted"
            @click="changeStatus(key as FollowUpPlanStatus)"
          >
            {{ label }}
          </van-button>
        </div>
        <van-button
          v-if="current.canManage && current.status === 'COMPLETED' && !current.converted"
          type="success"
          block
          @click="convert"
        >
          转跟进记录
        </van-button>
        <van-button v-if="current.canManage" block @click="editCurrent">编辑</van-button>
        <van-button v-if="current.canManage" type="danger" plain block @click="remove">删除</van-button>
      </div>
    </van-action-sheet>

    <MobileFollowCommentSheet
      v-if="current"
      v-model="commentShow"
      resource-type="plan"
      :resource-id="current.id"
      @count-changed="handleCommentCount"
    />

    <MobileFollowRecordFormSheet v-model="recordFormShow" :plan="convertingPlan" @saved="reload" />
  </div>
</template>
