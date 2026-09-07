<script setup lang="ts">
import {
  isFollowUpPlanSystemFieldKey,
  type FieldVO,
  type FollowUpPlanTargetType,
  type FollowUpPlanVO,
  type ModuleFormProp,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { contactApi, followUpPlanApi, leadApi, opportunityApi } from '@/api/sales'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import FollowUpPlanSystemField from '@/components/follow-plans/FollowUpPlanSystemField.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

interface TargetOption {
  id: string
  name: string
  customerId?: string
}

const props = defineProps<{
  modelValue: boolean
  plan?: FollowUpPlanVO | null
  fixedTargetType?: FollowUpPlanTargetType
  fixedTargetId?: string
  fixedTargetName?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean]; saved: [] }>()

const auth = useAuthStore()
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const saving = ref(false)
const loadingOptions = ref(false)
const resetting = ref(false)
const targets = ref<TargetOption[]>([])
const contacts = ref<{ id: string; name: string }[]>([])
const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const formProp = ref<ModuleFormProp>({})
const formModel = ref<Record<string, unknown>>({})
const formRef = ref<InstanceType<typeof DynamicForm>>()
const metaLoadFailed = ref(false)

const title = computed(() => (props.plan ? '编辑跟进计划' : '新建跟进计划'))
const dialogWidth = computed(() => {
  switch (formProp.value.viewSize) {
    case 'large':
      return '1080px'
    case 'medium':
      return '840px'
    case 'small':
    default:
      return '640px'
  }
})
const targetLocked = computed(() => Boolean(props.fixedTargetType && props.fixedTargetId))
const readonly = computed(() => Boolean(props.plan && !props.plan.canManage))
const writableCustomFields = computed(() =>
  fields.value.filter((field) => !field.system && field.type !== 'formula'),
)
const currentTargetType = computed<FollowUpPlanTargetType>(() => {
  const value = formModel.value.targetType
  return value === 'lead' || value === 'opportunity' || value === 'customer' ? value : 'customer'
})
const currentTargetId = computed(() => stringValue('targetId'))

function stringValue(key: string) {
  const value = formModel.value[key]
  return typeof value === 'string' ? value : ''
}

function fieldFilter(field: FieldVO) {
  if (field.key === 'contactId' && currentTargetType.value === 'lead') return false
  return true
}

async function loadTargets() {
  if (targetLocked.value) {
    targets.value = [{ id: props.fixedTargetId!, name: props.fixedTargetName ?? '当前对象' }]
    return
  }
  loadingOptions.value = true
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
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loadingOptions.value = false
  }
}

async function loadContacts() {
  contacts.value = []
  if (currentTargetType.value === 'lead') return
  let customerId = currentTargetType.value === 'customer' ? currentTargetId.value : ''
  if (currentTargetType.value === 'opportunity') {
    customerId = targets.value.find((item) => item.id === currentTargetId.value)?.customerId ?? ''
    if (!customerId && currentTargetId.value) {
      try {
        customerId = (await opportunityApi.get(currentTargetId.value)).data.customerId
      } catch (error) {
        ElMessage.error(extractErrorMessage(error))
        return
      }
    }
  }
  if (!customerId) return
  try {
    const { data } = await contactApi.list(customerId)
    contacts.value = data.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function defaultFieldModel() {
  return Object.fromEntries(fields.value.map((field) => [field.key, field.config?.defaultValue]))
}

function customValues(plan?: FollowUpPlanVO | null) {
  const byId = new Map((plan?.moduleFields ?? []).map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(
    writableCustomFields.value.map((field) => [field.key, byId.get(field.id)]),
  )
}

function moduleFieldsPayload() {
  return writableCustomFields.value.map((field) => ({
    fieldId: field.id,
    fieldValue: formModel.value[field.key],
  }))
}

async function loadMeta() {
  try {
    const [configRes] = await Promise.all([followUpPlanApi.moduleForm(), fieldRefs.load()])
    formProp.value = configRes.data.formProp
    fields.value = configRes.data.fields.filter(
      (field) => !field.system || isFollowUpPlanSystemFieldKey(field.key),
    )
    metaLoadFailed.value = false
  } catch (error) {
    metaLoadFailed.value = true
    ElMessage.error(extractErrorMessage(error))
    throw error
  }
}

async function reset() {
  resetting.value = true
  try {
    await loadMeta()
    const plan = props.plan
    const targetType = props.fixedTargetType ?? plan?.targetType ?? 'customer'
    const targetId = props.fixedTargetId ?? plan?.targetId ?? ''
    formModel.value = {
      ...defaultFieldModel(),
      ...customValues(plan),
      targetType,
      targetId,
      contactId: plan?.contactId ?? '',
      estimatedAt: plan?.estimatedAt ?? '',
      content: plan?.content ?? '',
      method: plan?.method ?? '电话',
      ownerId: plan?.ownerId ?? auth.user?.id ?? '',
      status: plan?.status ?? 'PREPARED',
    }
    await loadTargets()
    await loadContacts()
  } finally {
    resetting.value = false
  }
}

async function save() {
  if (metaLoadFailed.value) {
    ElMessage.warning('跟进计划表单配置加载失败，请重新打开后再保存')
    return
  }
  if (!(await formRef.value?.validate())) return

  const content = stringValue('content').trim()
  const targetId = currentTargetId.value
  if (!targetId || !content) {
    ElMessage.warning('请选择业务对象并填写计划内容')
    return
  }

  saving.value = true
  try {
    const payload = {
      targetType: currentTargetType.value,
      targetId,
      contactId: stringValue('contactId') || undefined,
      content,
      method: stringValue('method') || undefined,
      estimatedAt: stringValue('estimatedAt') || undefined,
      ownerId: stringValue('ownerId') || undefined,
      moduleFields: moduleFieldsPayload(),
    }
    if (props.plan) await followUpPlanApi.update(props.plan.id, payload)
    else await followUpPlanApi.create(payload)
    ElMessage.success(props.plan ? '计划已更新' : '计划已创建')
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(
  () => props.modelValue,
  (value) => {
    if (value) reset()
  },
)
watch(
  () => formModel.value.targetType,
  async () => {
    if (!visible.value || targetLocked.value || resetting.value) return
    formModel.value.targetId = ''
    formModel.value.contactId = ''
    await loadTargets()
  },
)
watch(
  () => formModel.value.targetId,
  async () => {
    if (!visible.value || resetting.value) return
    formModel.value.contactId = ''
    await loadContacts()
  },
)
</script>

<template>
  <el-dialog
    v-model="visible"
    :title="title"
    :width="dialogWidth"
    destroy-on-close
    data-testid="follow-plan-dialog"
  >
    <div :class="readonly ? 'pointer-events-none opacity-70' : ''">
      <DynamicForm
        ref="formRef"
        v-model="formModel"
        :fields="fields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
        :field-filter="fieldFilter"
        :form-prop="formProp"
      >
        <template #system-field="{ field, value, setValue }">
          <FollowUpPlanSystemField
            :field="field"
            :model-value="value"
            :target-type="currentTargetType"
            :target-locked="targetLocked"
            :readonly="readonly"
            :loading-targets="loadingOptions"
            :targets="targets"
            :contacts="contacts"
            :members="fieldRefs.members.value"
            @update:model-value="setValue"
          />
        </template>
      </DynamicForm>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        v-if="!readonly"
        data-testid="follow-plan-save"
        type="primary"
        :loading="saving"
        @click="save"
      >
        保存
      </el-button>
    </template>
  </el-dialog>
</template>
