<script setup lang="ts">
import {
  FOLLOW_UP_TYPES,
  type FieldVO,
  type FollowUpPlanVO,
  type FollowUpVO,
} from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { showFailToast, showSuccessToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { contactApi, followUpApi, followUpPlanApi } from '@/api/sales'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{
  plan: FollowUpPlanVO | null
}>()

const show = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [record: FollowUpVO] }>()

const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const contacts = ref<Array<{ id: string; name: string }>>([])
const formModel = ref<Record<string, unknown>>({})
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

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function defaultDynamicModel() {
  return Object.fromEntries(
    dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]),
  )
}

function isEmptyValue(value: unknown) {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && value.length === 0)
  )
}

function toLocalDateTime(value: unknown) {
  if (typeof value !== 'string' || !value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({
    fieldId: field.id,
    fieldValue: formModel.value[field.key],
  }))
}

async function loadContacts(plan: FollowUpPlanVO) {
  contacts.value = []
  const customerId = plan.targetType === 'customer' ? plan.targetId : (plan.customerId ?? '')
  if (!customerId) return
  const { data } = await contactApi.list(customerId)
  contacts.value = data.map((item) => ({ id: item.id, name: item.name }))
}

async function reset() {
  const plan = props.plan
  if (!plan) return
  loading.value = true
  loadFailed.value = false
  try {
    const [configRes, prefillRes] = await Promise.all([
      followUpApi.moduleForm(),
      followUpPlanApi.recordPrefill(plan.id),
      fieldRefs.load(),
      loadContacts(plan),
    ]).then(([config, prefill]) => [config, prefill] as const)
    fields.value = configRes.data.fields
    const values = prefillRes.data.values
    form.contactId = stringValue(values.contactId)
    form.ownerId = stringValue(values.ownerId)
    form.type = stringValue(values.type)
    form.content = stringValue(values.content)
    form.followedAt = toLocalDateTime(values.followedAt)
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
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  const plan = props.plan
  if (!plan) return
  if (loadFailed.value) {
    showFailToast('跟进记录表单配置加载失败，请重新打开后再保存')
    return
  }
  if (!form.content.trim()) {
    showFailToast('请填写跟进内容')
    return
  }
  const missing = dynamicFields.value.find(
    (field) => field.required && isEmptyValue(formModel.value[field.key]),
  )
  if (missing) {
    showFailToast(`请填写${missing.label}`)
    return
  }

  saving.value = true
  try {
    const { data } = await followUpApi.create({
      targetType: plan.targetType,
      targetId: plan.targetId,
      contactId: form.contactId || undefined,
      ownerId: form.ownerId || undefined,
      type: form.type || undefined,
      content: form.content.trim(),
      followedAt: form.followedAt ? new Date(form.followedAt).toISOString() : undefined,
      sourcePlanId: plan.id,
      moduleFields: moduleFieldsPayload(),
    })
    showSuccessToast('已转为跟进记录')
    show.value = false
    emit('saved', data)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

watch(show, (open) => {
  if (open) reset()
})
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ height: '82%' }">
    <div class="h-full flex flex-col">
      <div class="p-4 text-center font-medium">计划转跟进记录</div>
      <div v-if="plan" class="flex-1 overflow-auto px-4 pb-4 space-y-3">
        <div v-if="loading" class="py-10 text-center">
          <van-loading />
        </div>
        <template v-else>
          <van-field label="关联对象" :model-value="plan.targetName" readonly />
          <van-field v-if="contacts.length" label="联系人">
            <template #input>
              <select v-model="form.contactId" class="w-full bg-transparent">
                <option value="">不关联联系人</option>
                <option v-for="item in contacts" :key="item.id" :value="item.id">
                  {{ item.name }}
                </option>
              </select>
            </template>
          </van-field>
          <van-field label="跟进方式">
            <template #input>
              <select v-model="form.type" class="w-full bg-transparent">
                <option value="">未设置</option>
                <option v-for="item in FOLLOW_UP_TYPES" :key="item" :value="item">
                  {{ item }}
                </option>
              </select>
            </template>
          </van-field>
          <van-field label="负责人">
            <template #input>
              <select v-model="form.ownerId" class="w-full bg-transparent">
                <option value="">沿用计划负责人</option>
                <option v-for="item in fieldRefs.members.value" :key="item.id" :value="item.id">
                  {{ item.name }}
                </option>
              </select>
            </template>
          </van-field>
          <van-field label="跟进时间">
            <template #input>
              <input
                v-model="form.followedAt"
                type="datetime-local"
                class="w-full bg-transparent"
              />
            </template>
          </van-field>
          <van-field
            v-model="form.content"
            label="跟进内容"
            type="textarea"
            rows="4"
            maxlength="3000"
            show-word-limit
            required
          />
          <MobileDynamicForm
            v-if="dynamicFields.length"
            v-model="formModel"
            :fields="dynamicFields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
          />
        </template>
      </div>
      <div class="p-4">
        <van-button type="primary" block :loading="saving" :disabled="loading" @click="save">
          保存跟进记录
        </van-button>
      </div>
    </div>
  </van-popup>
</template>
