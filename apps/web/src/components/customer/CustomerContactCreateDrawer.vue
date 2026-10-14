<script setup lang="ts">
import { isCustomFieldKey, type FieldVO, type ModuleFormProp } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { contactApi } from '@/api/sales'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{ customerId: string }>()
const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ saved: [] }>()

const fieldRefs = useFieldRefs()
const fields = ref<FieldVO[]>([])
const formProp = ref<ModuleFormProp>({})
const formModel = ref<Record<string, unknown>>({})
const formRef = ref<InstanceType<typeof DynamicForm>>()
const loading = ref(false)
const saving = ref(false)
const ready = ref(false)
const formFields = computed(() =>
  fields.value.filter((field) => !field.hidden && !['customerId', 'enable'].includes(field.key)),
)

const drawerWidth = computed(
  () => ({ small: '640px', medium: '840px', large: '1080px' })[formProp.value.viewSize ?? 'small'],
)

async function prepareForm() {
  formModel.value = {}
  ready.value = false
  loading.value = true
  try {
    const [{ data }] = await Promise.all([metadataApi.formConfig('contact'), fieldRefs.load()])
    fields.value = data.fields
    formProp.value = data.formProp
    ready.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

watch(visible, (open) => {
  if (open) void prepareForm()
})

async function save() {
  if (!ready.value || loading.value || saving.value) return
  if (!(await formRef.value?.validate())) return

  saving.value = true
  try {
    const payload: Record<string, unknown> = {}
    const customData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(formModel.value)) {
      if (isCustomFieldKey(key)) customData[key] = value
      else payload[key] = value
    }
    if (Object.keys(customData).length) payload.customData = customData
    await contactApi.create({ ...payload, customerId: props.customerId } as {
      customerId: string
      name: string
    })
    ElMessage.success('联系人已新增')
    visible.value = false
    emit('saved')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-drawer
    v-model="visible"
    title="新增联系人"
    :size="drawerWidth"
    append-to-body
    destroy-on-close
    :close-on-click-modal="false"
  >
    <div v-loading="loading" class="min-h-[120px]">
      <DynamicForm
        v-if="ready"
        ref="formRef"
        v-model="formModel"
        :fields="formFields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
        :form-prop="formProp"
      />
    </div>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" :disabled="loading || !ready" @click="save">
        保存
      </el-button>
    </template>
  </el-drawer>
</template>
