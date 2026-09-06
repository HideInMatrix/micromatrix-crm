<script setup lang="ts">
import {
  FOLLOW_UP_TYPES,
  type AttachmentVO,
  type FieldVO,
  type FollowTargetType,
  type FollowUpVO,
} from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'
import { contactApi, followUpApi, followUpPlanApi, opportunityApi } from '@/api/sales'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{
  modelValue: boolean
  targetType: FollowTargetType
  targetId: string
  targetName?: string
  customerId?: string | null
  sourcePlanId?: string
  recordId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [record: FollowUpVO]
}>()

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const contacts = ref<Array<{ id: string; name: string }>>([])
const resolvedCustomerId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const attachmentMap = ref<Record<string, AttachmentVO[]>>({})
const formRef = ref<InstanceType<typeof DynamicForm>>()
const loading = ref(false)
const saving = ref(false)
const loadFailed = ref(false)

const form = reactive({
  contactId: '',
  ownerId: '',
  type: '',
  content: '',
  followedAt: '',
})

const dynamicFields = computed(() =>
  fields.value.filter((field) => !field.system && !field.hidden && field.type !== 'formula'),
)

function defaultDynamicModel() {
  return Object.fromEntries(
    dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]),
  )
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({
    fieldId: field.id,
    fieldValue: formModel.value[field.key],
  }))
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function loadContacts() {
  contacts.value = []
  if (!resolvedCustomerId.value) return
  try {
    const { data } = await contactApi.list(resolvedCustomerId.value)
    contacts.value = data.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function resolveCustomerId() {
  if (props.targetType === 'customer') return props.targetId
  if (props.targetType !== 'opportunity') return null
  if (props.customerId) return props.customerId
  const { data } = await opportunityApi.get(props.targetId)
  return data.customerId ?? null
}

async function reset() {
  loading.value = true
  loadFailed.value = false
  try {
    const [configRes, prefillRes, recordRes, customerId] = await Promise.all([
      followUpApi.moduleForm(),
      props.sourcePlanId
        ? followUpPlanApi.recordPrefill(props.sourcePlanId)
        : Promise.resolve(null),
      props.recordId ? followUpApi.get(props.recordId) : Promise.resolve(null),
      fieldRefs.load(),
      resolveCustomerId(),
    ]).then(
      ([config, prefill, record, _refs, customerId]) =>
        [config, prefill, record, customerId] as const,
    )

    fields.value = configRes.data.fields
    resolvedCustomerId.value = customerId
    await loadContacts()
    const record = recordRes?.data
    const values = record
      ? Object.fromEntries([
          ['contactId', record.contactId],
          ['ownerId', record.ownerId],
          ['type', record.type],
          ['content', record.content],
          ['followedAt', record.followedAt],
          ...record.moduleFields.flatMap((item) => {
            const field = fields.value.find((candidate) => candidate.id === item.fieldId)
            return field ? [[field.key, item.fieldValue] as const] : []
          }),
        ])
      : (prefillRes?.data.values ?? {})
    attachmentMap.value = record?.attachmentMap ?? {}
    form.contactId = stringValue(values.contactId)
    form.ownerId = stringValue(values.ownerId)
    form.type = stringValue(values.type)
    form.content = stringValue(values.content)
    form.followedAt = stringValue(values.followedAt)
    formModel.value = {
      ...defaultDynamicModel(),
      ...Object.fromEntries(
        dynamicFields.value
          .filter((field) => Object.prototype.hasOwnProperty.call(values, field.key))
          .map((field) => [field.key, values[field.key]]),
      ),
    }
  } catch (error) {
    loadFailed.value = true
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (loadFailed.value) {
    ElMessage.warning('跟进记录表单配置加载失败，请重新打开后再保存')
    return
  }
  if (!form.content.trim()) {
    ElMessage.warning('请填写跟进内容')
    return
  }
  if (dynamicFields.value.length && !(await formRef.value?.validate())) return

  saving.value = true
  try {
    const commonPayload = {
      targetType: props.targetType,
      targetId: props.targetId,
      ownerId: form.ownerId || undefined,
      content: form.content.trim(),
      moduleFields: moduleFieldsPayload(),
    }
    const { data } = props.recordId
      ? await followUpApi.update(props.recordId, {
          ...commonPayload,
          contactId: form.contactId || null,
          type: form.type || null,
          followedAt: form.followedAt || null,
        })
      : await followUpApi.create({
          ...commonPayload,
          contactId: form.contactId || undefined,
          type: form.type || undefined,
          followedAt: form.followedAt || undefined,
          sourcePlanId: props.sourcePlanId,
        })
    ElMessage.success(
      props.recordId
        ? '跟进记录已更新'
        : props.sourcePlanId
          ? '计划已转为跟进记录'
          : '跟进记录已保存',
    )
    visible.value = false
    emit('saved', data)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function claimedAttachmentIds() {
  return new Set(
    Object.values(attachmentMap.value).flatMap((files) => files.map((file) => file.id)),
  )
}

async function downloadAttachment(file: AttachmentVO) {
  if (!props.recordId || !claimedAttachmentIds().has(file.id)) {
    await attachmentApi.download(file.id, file.name)
    return
  }
  const { data } = await followUpApi.downloadAttachment(props.recordId, file.id)
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  URL.revokeObjectURL(url)
}

async function attachmentObjectUrl(id: string) {
  if (!props.recordId || !claimedAttachmentIds().has(id)) return attachmentApi.objectUrl(id)
  const { data } = await followUpApi.downloadAttachment(props.recordId, id)
  return URL.createObjectURL(data)
}

watch(
  () => props.modelValue,
  (value) => {
    if (value) reset()
  },
)
</script>

<template>
  <el-drawer
    v-model="visible"
    size="50%"
    destroy-on-close
    :title="recordId ? '编辑跟进记录' : sourcePlanId ? '计划转跟进记录' : '新建跟进记录'"
    data-testid="follow-record-form-drawer"
  >
    <div v-loading="loading" class="min-h-40">
      <el-form v-if="!loading" label-width="92px">
        <el-form-item label="关联对象">
          <el-input :model-value="targetName || targetId" disabled />
        </el-form-item>
        <el-form-item v-if="targetType !== 'lead'" label="联系人">
          <el-select
            v-model="form.contactId"
            clearable
            filterable
            class="w-full"
            placeholder="可选"
          >
            <el-option
              v-for="item in contacts"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="跟进时间">
          <el-date-picker
            v-model="form.followedAt"
            type="datetime"
            value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
            class="!w-full"
            placeholder="默认当前时间"
          />
        </el-form-item>
        <el-form-item label="跟进方式">
          <el-select v-model="form.type" clearable class="w-full" placeholder="可选">
            <el-option v-for="item in FOLLOW_UP_TYPES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人">
          <el-select
            v-model="form.ownerId"
            clearable
            filterable
            class="w-full"
            :placeholder="sourcePlanId ? '默认来源计划负责人' : '默认当前用户'"
          >
            <el-option
              v-for="item in fieldRefs.members.value"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="跟进内容" required>
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="4"
            maxlength="3000"
            show-word-limit
            data-testid="follow-record-content"
          />
        </el-form-item>
        <div v-if="dynamicFields.length" data-testid="follow-record-dynamic-fields">
          <DynamicForm
            ref="formRef"
            v-model="formModel"
            :fields="dynamicFields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
            :attachment-map="attachmentMap"
            :attachment-download="downloadAttachment"
            :attachment-object-url="attachmentObjectUrl"
          />
        </div>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="loading || loadFailed"
        data-testid="follow-record-save"
        @click="save"
      >
        保存
      </el-button>
    </template>
  </el-drawer>
</template>
