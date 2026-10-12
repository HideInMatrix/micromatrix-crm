import type { FieldVO, ModuleFormProp } from '@micromatrix/shared'
import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { listCustomerOptions } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@micromatrix/frontend-shared/api/metadata'
import { contactApi } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { showSuccessFeedback, wait } from '@/utils/feedback'
import {
  contactFormToPayload,
  contactToFormModel,
  createContactFormModel,
  firstMissingRequiredContactField,
} from '@/utils/contact-form'

export function useContactForm(contactId: Readonly<Ref<string | undefined>>) {
  const fieldRefs = useFieldRefs()
  const fields = ref<FieldVO[]>([])
  const formProp = ref<ModuleFormProp>({})
  const model = ref<Record<string, unknown>>({})
  const customerOptions = ref<Array<{ id: string; name: string }>>([])
  const loading = ref(false)
  const saving = ref(false)

  const editing = computed(() => Boolean(contactId.value))
  const title = computed(() => (editing.value ? '编辑联系人' : '新建联系人'))
  const submitText = computed(() => (editing.value ? '更新' : '创建'))

  async function init() {
    loading.value = true
    try {
      fields.value = []
      formProp.value = {}
      model.value = {}
      const [{ data: config }, { data: customers }, detail] = await Promise.all([
        metadataApi.formConfig('contact'),
        listCustomerOptions(),
        contactId.value ? contactApi.get(contactId.value) : Promise.resolve(null),
        fieldRefs.load(),
      ])
      fields.value = [...config.fields].sort((a, b) => a.sort - b.sort)
      formProp.value = config.formProp
      customerOptions.value = customers
      model.value = detail
        ? contactToFormModel(detail.data, fields.value)
        : createContactFormModel(fields.value)
    } catch (error) {
      showFailToast(extractErrorMessage(error))
      throw error
    } finally {
      loading.value = false
    }
  }

  async function save() {
    const missing = firstMissingRequiredContactField(model.value, fields.value, formProp.value)
    if (missing) {
      showFailToast('请填写' + missing.label)
      return false
    }

    saving.value = true
    try {
      const payload = contactFormToPayload(model.value)
      if (contactId.value) await contactApi.update(contactId.value, payload)
      else await contactApi.create(payload as { customerId: string; name: string })
      showSuccessFeedback(editing.value ? '联系人已更新' : '联系人已创建')
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
    customerOptions,
    loading,
    saving,
    editing,
    title,
    submitText,
    init,
    save,
  }
}
