import type { FieldVO } from '@micromatrix/shared'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { fetchFields } from '@/api/mobile'
import { leadApi } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { showSuccessFeedback, wait } from '@/utils/feedback'
import {
  createLeadFormModel,
  firstMissingRequiredLeadField,
  leadFormToPayload,
  leadToFormModel,
} from '@/utils/lead-form'

export function useLeadForm(leadId: Readonly<Ref<string | undefined>>) {
  const fieldRefs = useFieldRefs()
  const fields = ref<FieldVO[]>([])
  const model = ref<Record<string, unknown>>({})
  const loading = ref(false)
  const saving = ref(false)

  const editing = computed(() => Boolean(leadId.value))
  const title = computed(() => (editing.value ? '编辑线索' : '新建线索'))
  const submitText = computed(() => (editing.value ? '更新' : '创建'))

  async function init() {
    loading.value = true
    try {
      fields.value = []
      model.value = {}
      const [{ data: fieldData }, detail] = await Promise.all([
        fetchFields('lead'),
        leadId.value ? leadApi.get(leadId.value) : Promise.resolve(null),
        fieldRefs.load(),
      ])
      fields.value = [...fieldData].sort((a, b) => a.sort - b.sort)
      model.value = detail
        ? leadToFormModel(detail.data, fields.value)
        : createLeadFormModel(fields.value)
    } catch (error) {
      showFailToast(extractErrorMessage(error))
      throw error
    } finally {
      loading.value = false
    }
  }

  async function save() {
    const missing = firstMissingRequiredLeadField(model.value, fields.value)
    if (missing) {
      showFailToast('请填写' + missing.label)
      return false
    }

    saving.value = true
    try {
      const payload = leadFormToPayload(model.value, fields.value)
      if (leadId.value) await leadApi.update(leadId.value, payload)
      else await leadApi.create(payload)
      showSuccessFeedback(editing.value ? '线索已更新' : '线索已创建')
      await wait(300)
      return true
    } catch (error) {
      showFailToast(extractErrorMessage(error))
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    fieldRefs,
    fields,
    model,
    loading,
    saving,
    editing,
    title,
    submitText,
    init,
    save,
  }
}

