<script setup lang="ts">
import type { FieldVO, FollowUpPlanTargetType, FollowUpPlanVO } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { contactApi, followUpPlanApi, leadApi, opportunityApi } from '@/api/sales'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'

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

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})
const saving = ref(false)
const loadingOptions = ref(false)
const targets = ref<TargetOption[]>([])
const contacts = ref<{ id: string; name: string }[]>([])
const fieldRefs = useFieldRefs()
const members = fieldRefs.members
const fields = ref<FieldVO[]>([])
const formModel = ref<Record<string, unknown>>({})
const formRef = ref<InstanceType<typeof DynamicForm>>()
const metaLoaded = ref(false)
const metaLoadFailed = ref(false)
const form = reactive({
  targetType: 'customer' as FollowUpPlanTargetType,
  targetId: '',
  contactId: '',
  content: '',
  method: '电话',
  estimatedAt: '',
  ownerId: '',
})

const title = computed(() => (props.plan ? '编辑跟进计划' : '新建跟进计划'))
const targetLocked = computed(() => Boolean(props.fixedTargetType && props.fixedTargetId))
const readonly = computed(() => Boolean(props.plan && !props.plan.canManage))
const dynamicFields = computed(() =>
  fields.value.filter((field) => !field.system && !field.hidden && field.type !== 'formula'),
)

async function loadTargets() {
  if (targetLocked.value) {
    targets.value = [{ id: props.fixedTargetId!, name: props.fixedTargetName ?? '当前对象' }]
    return
  }
  loadingOptions.value = true
  try {
    if (form.targetType === 'lead') {
      const { data } = await leadApi.list({ page: 1, pageSize: 100, scope: 'mine' })
      targets.value = data.items.map((item) => ({ id: item.id, name: item.name }))
    } else if (form.targetType === 'customer') {
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
  form.contactId = ''
  let customerId = form.targetType === 'customer' ? form.targetId : ''
  if (form.targetType === 'opportunity') {
    customerId = targets.value.find((item) => item.id === form.targetId)?.customerId ?? ''
  }
  if (!customerId) return
  try {
    const { data } = await contactApi.list(customerId)
    contacts.value = data.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function defaultDynamicModel() {
  return Object.fromEntries(
    dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]),
  )
}

function dynamicValues(plan?: FollowUpPlanVO | null) {
  const byId = new Map((plan?.moduleFields ?? []).map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, byId.get(field.id)]))
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({
    fieldId: field.id,
    fieldValue: formModel.value[field.key],
  }))
}

async function loadMeta() {
  if (metaLoaded.value) return
  try {
    const [configRes] = await Promise.all([followUpPlanApi.moduleForm(), fieldRefs.load()])
    fields.value = configRes.data.fields
    metaLoaded.value = true
    metaLoadFailed.value = false
  } catch (error) {
    metaLoadFailed.value = true
    ElMessage.error(extractErrorMessage(error))
  }
}

async function reset() {
  const plan = props.plan
  form.targetType = props.fixedTargetType ?? plan?.targetType ?? 'customer'
  form.targetId = props.fixedTargetId ?? plan?.targetId ?? ''
  form.contactId = plan?.contactId ?? ''
  form.content = plan?.content ?? ''
  form.method = plan?.method ?? '电话'
  form.estimatedAt = plan?.estimatedAt ?? ''
  form.ownerId = plan?.ownerId ?? ''
  await Promise.all([loadTargets(), loadMeta()])
  formModel.value = { ...defaultDynamicModel(), ...dynamicValues(plan) }
  if (plan?.contactId) {
    await loadContacts()
    form.contactId = plan.contactId
  } else if (form.targetId) {
    await loadContacts()
  }
}

async function save() {
  if (metaLoadFailed.value) {
    ElMessage.warning('跟进计划表单配置加载失败，请重新打开后再保存')
    return
  }
  if (!form.targetId || !form.content.trim()) {
    ElMessage.warning('请选择业务对象并填写计划内容')
    return
  }
  if (dynamicFields.value.length && !(await formRef.value?.validate())) return
  saving.value = true
  try {
    const payload = {
      targetType: form.targetType,
      targetId: form.targetId,
      contactId: form.contactId || undefined,
      content: form.content.trim(),
      method: form.method || undefined,
      estimatedAt: form.estimatedAt || undefined,
      ownerId: form.ownerId || undefined,
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
  () => form.targetType,
  async () => {
    if (!visible.value || targetLocked.value) return
    form.targetId = ''
    form.contactId = ''
    await loadTargets()
  },
)
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="560px" destroy-on-close data-testid="follow-plan-dialog">
    <el-form label-width="92px">
      <el-form-item label="计划对象" required>
        <div class="flex gap-2 w-full">
          <el-select v-model="form.targetType" :disabled="targetLocked || readonly" class="!w-32">
            <el-option label="客户" value="customer" />
            <el-option label="线索" value="lead" />
            <el-option label="商机" value="opportunity" />
          </el-select>
          <el-select
            v-model="form.targetId"
            data-testid="follow-plan-target-select"
            :loading="loadingOptions"
            :disabled="targetLocked || readonly"
            filterable
            class="flex-1"
            placeholder="请选择业务对象"
            @change="loadContacts"
          >
            <el-option v-for="item in targets" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </div>
      </el-form-item>
      <el-form-item v-if="form.targetType !== 'lead'" label="联系人">
        <el-select v-model="form.contactId" :disabled="readonly" clearable filterable class="w-full" placeholder="可选">
          <el-option v-for="item in contacts" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="计划时间">
        <el-date-picker
          v-model="form.estimatedAt"
          :disabled="readonly"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          class="!w-full"
          placeholder="可选"
        />
      </el-form-item>
      <el-form-item label="跟进方式">
        <el-select v-model="form.method" :disabled="readonly" clearable class="w-full">
          <el-option v-for="item in ['电话', '拜访', '微信', '邮件', '会议', '其他']" :key="item" :label="item" :value="item" />
        </el-select>
      </el-form-item>
      <el-form-item label="负责人">
        <el-select v-model="form.ownerId" :disabled="readonly" clearable filterable class="w-full" placeholder="默认当前用户">
          <el-option v-for="item in members" :key="item.id" :label="item.name" :value="item.id" />
        </el-select>
      </el-form-item>
      <el-form-item label="计划内容" required>
        <el-input v-model="form.content" data-testid="follow-plan-content" :disabled="readonly" type="textarea" :rows="4" maxlength="3000" show-word-limit />
      </el-form-item>
      <div v-if="dynamicFields.length" data-testid="follow-plan-dynamic-fields" :class="readonly ? 'pointer-events-none opacity-70' : ''">
        <DynamicForm
          ref="formRef"
          v-model="formModel"
          :fields="dynamicFields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
        />
      </div>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="!readonly" data-testid="follow-plan-save" type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
