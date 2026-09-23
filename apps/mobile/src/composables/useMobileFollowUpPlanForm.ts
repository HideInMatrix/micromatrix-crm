import {
  isFollowUpPlanSystemFieldKey,
  type FieldVO,
  type FollowUpPlanTargetType,
  type FollowUpPlanVO,
} from '@micromatrix/shared'
import type { Ref } from 'vue'
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { showSuccessFeedback } from '@/utils/feedback'
import { contactApi, followUpPlanApi, leadApi, opportunityApi } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

export interface MobileFollowUpPlanTargetOption {
  id: string
  name: string
  customerId?: string
}

export function useMobileFollowUpPlanForm(
  targetType: Readonly<Ref<FollowUpPlanTargetType | undefined>>,
  targetId: Readonly<Ref<string | undefined>>,
  targetName: Readonly<Ref<string | undefined>>,
  onSaved: () => void,
) {
  const auth = useAuthStore()
  const fieldRefs = useFieldRefs()
  const show = ref(false)
  const saving = ref(false)
  const resetting = ref(false)
  const editing = ref<FollowUpPlanVO | null>(null)
  const targets = ref<MobileFollowUpPlanTargetOption[]>([])
  const contacts = ref<{ id: string; name: string }[]>([])
  const fields = ref<FieldVO[]>([])
  const formModel = ref<Record<string, unknown>>({})
  const metaLoaded = ref(false)

  const targetLocked = computed(() => Boolean(targetType.value && targetId.value))
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
    return !(field.key === 'contactId' && currentTargetType.value === 'lead')
  }

  function defaultFieldModel() {
    return Object.fromEntries(fields.value.map((field) => [field.key, field.config?.defaultValue]))
  }

  function dynamicValues(plan?: FollowUpPlanVO | null) {
    const byId = new Map((plan?.moduleFields ?? []).map((item) => [item.fieldId, item.fieldValue]))
    return Object.fromEntries(
      writableDynamicFields.value.map((field) => [field.key, byId.get(field.id)]),
    )
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
    return visibleFormFields.value.some(
      (field) => field.required && isEmpty(formModel.value[field.key]),
    )
  }

  async function loadMeta() {
    if (metaLoaded.value) return
    const [{ data }] = await Promise.all([followUpPlanApi.moduleForm(), fieldRefs.load()])
    fields.value = data.fields.filter(
      (field) => !field.system || isFollowUpPlanSystemFieldKey(field.key),
    )
    metaLoaded.value = true
  }

  async function loadTargets() {
    if (targetId.value) {
      targets.value = [{ id: targetId.value, name: targetName.value ?? '当前对象' }]
      return
    }

    try {
      if (currentTargetType.value === 'lead') {
        const { data } = await leadApi.list({ page: 1, pageSize: 100, scope: 'mine' })
        targets.value = data.items.map((item) => ({ id: item.id, name: item.name }))
        return
      }
      if (currentTargetType.value === 'customer') {
        const { data } = await listCustomerOptions()
        targets.value = data
        return
      }
      const { data } = await opportunityApi.list({ page: 1, pageSize: 100 })
      targets.value = data.items.map((item) => ({
        id: item.id,
        name: item.name,
        customerId: item.customerId,
      }))
    } catch (error) {
      showFailToast(extractErrorMessage(error))
    }
  }

  async function resolveOpportunityCustomerId() {
    const fromOptions = targets.value.find(
      (item) => item.id === currentTargetId.value,
    )?.customerId
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

  async function open(plan?: FollowUpPlanVO) {
    try {
      await loadMeta()
    } catch (error) {
      showFailToast(extractErrorMessage(error))
      return
    }

    resetting.value = true
    try {
      editing.value = plan ?? null
      const nextTargetType = targetType.value ?? plan?.targetType ?? 'customer'
      const nextTargetId = targetId.value ?? plan?.targetId ?? ''
      formModel.value = {
        ...defaultFieldModel(),
        ...dynamicValues(plan),
        targetType: nextTargetType,
        targetId: nextTargetId,
        contactId: plan?.contactId ?? '',
        method: plan?.method ?? '电话',
        estimatedAt: plan?.estimatedAt ?? '',
        content: plan?.content ?? '',
        ownerId: plan?.ownerId ?? auth.user?.id ?? '',
        status: plan?.status ?? 'PREPARED',
      }
      await loadTargets()
      await loadContacts()
      show.value = true
    } finally {
      resetting.value = false
    }
  }

  async function save() {
    if (hasMissingRequiredField()) {
      showFailToast('请填写所有必填字段')
      return
    }
    const nextTargetId = currentTargetId.value
    const content = stringValue('content').trim()
    if (!nextTargetId || !content) {
      showFailToast('请选择计划对象并填写内容')
      return
    }

    saving.value = true
    try {
      const payload = {
        targetType: currentTargetType.value,
        targetId: nextTargetId,
        contactId: stringValue('contactId') || undefined,
        method: stringValue('method') || undefined,
        estimatedAt: stringValue('estimatedAt') || undefined,
        content,
        ownerId: stringValue('ownerId') || undefined,
        moduleFields: moduleFieldsPayload(),
      }
      if (editing.value) await followUpPlanApi.update(editing.value.id, payload)
      else await followUpPlanApi.create(payload)
      showSuccessFeedback(editing.value ? '计划已更新' : '计划已创建')
      show.value = false
      onSaved()
    } catch (error) {
      showFailToast(extractErrorMessage(error))
    } finally {
      saving.value = false
    }
  }

  watch(
    () => formModel.value.targetType,
    async () => {
      if (!show.value || targetLocked.value || resetting.value) return
      formModel.value.targetId = ''
      formModel.value.contactId = ''
      await loadTargets()
    },
  )

  watch(
    () => formModel.value.targetId,
    async () => {
      if (!show.value || resetting.value) return
      formModel.value.contactId = ''
      await loadContacts()
    },
  )

  return {
    show,
    saving,
    editing,
    targets,
    contacts,
    fields,
    formModel,
    fieldRefs,
    targetLocked,
    fieldFilter,
    open,
    save,
  }
}

