import type { FieldVO, ModuleFormProp } from '@micromatrix/shared'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { createCustomer, getCustomer, updateCustomer } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@micromatrix/frontend-shared/api/metadata'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { showSuccessFeedback, wait } from '@/utils/feedback'
import {
  createCustomerFormModel,
  customerFormToPayload,
  customerToFormModel,
  firstMissingRequiredCustomerField,
} from '@/utils/customer-form'

export function useCustomerForm(customerId: Readonly<Ref<string | undefined>>) {
  const fieldRefs = useFieldRefs()
  const fields = ref<FieldVO[]>([])
  const formProp = ref<ModuleFormProp>({})
  const model = ref<Record<string, unknown>>({})
  const loading = ref(false)
  const saving = ref(false)

  const editing = computed(() => Boolean(customerId.value))
  const title = computed(() => (editing.value ? '编辑客户' : '新建客户'))
  const submitText = computed(() => (editing.value ? '更新' : '创建'))

  async function init() {
    loading.value = true
    try {
      fields.value = []
      formProp.value = {}
      model.value = {}
      const [{ data: config }, detail] = await Promise.all([
        metadataApi.formConfig('customer'),
        customerId.value ? getCustomer(customerId.value) : Promise.resolve(null),
        fieldRefs.load(),
      ])
      fields.value = [...config.fields].sort((a, b) => a.sort - b.sort)
      formProp.value = config.formProp
      model.value = detail
        ? customerToFormModel(detail.data, fields.value)
        : createCustomerFormModel(fields.value)
    } catch (error) {
      showFailToast(extractErrorMessage(error))
      throw error
    } finally {
      loading.value = false
    }
  }

  async function save() {
    const missing = firstMissingRequiredCustomerField(model.value, fields.value, formProp.value)
    if (missing) {
      showFailToast(`请填写${missing.label}`)
      return false
    }

    saving.value = true
    try {
      const payload = customerFormToPayload(model.value)
      if (customerId.value) await updateCustomer(customerId.value, payload)
      else await createCustomer(payload)
      showSuccessFeedback(editing.value ? '客户已更新' : '客户已创建')
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
    formProp,
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
