<script setup lang="ts">
import {
  supportsMobileSearchSelect,
  type FieldVO,
  type ModuleFormProp,
  type ModuleKey,
  type SubTableFieldType,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi, type SaveModuleFormInput } from '@/api/metadata'
import ModuleFormCanvas from './ModuleFormCanvas.vue'
import ModuleFormFieldPalette from './ModuleFormFieldPalette.vue'
import ModuleFormProperties from './ModuleFormProperties.vue'
import {
  cloneDraftField,
  isDraftField,
  type ModuleFormFieldDraft,
} from './types'

const props = defineProps<{
  module: ModuleKey
}>()

const emit = defineEmits<{
  saved: []
}>()

const loading = ref(false)
const saving = ref(false)
const fields = ref<ModuleFormFieldDraft[]>([])
const formProp = ref<ModuleFormProp>({ layout: 2, labelPos: 'top', viewSize: 'small' })
const activeId = ref<string | null>(null)
const savedSnapshot = ref('')

const activeField = computed<ModuleFormFieldDraft | null>({
  get: () => fields.value.find((field) => field.id === activeId.value) ?? null,
  set: (next) => {
    if (!next) {
      activeId.value = null
      return
    }
    const index = fields.value.findIndex((field) => field.id === next.id)
    if (index >= 0) fields.value[index] = next
    activeId.value = next.id
  },
})

const dirty = computed(() => Boolean(savedSnapshot.value) && snapshot() !== savedSnapshot.value)

function normalizeField(field: FieldVO): ModuleFormFieldDraft {
  const cloned = JSON.parse(JSON.stringify(field)) as FieldVO
  return {
    ...cloned,
    mobile: field.mobile ?? true,
    options: cloned.options ?? null,
    config: cloned.config ?? {},
    subFields: cloned.subFields ?? null,
    draft: false,
  }
}

function normalizeFormProp(value: ModuleFormProp): ModuleFormProp {
  const cloned = JSON.parse(JSON.stringify(value)) as ModuleFormProp
  return {
    ...cloned,
    layout: [1, 2, 3, 4].includes(Number(value.layout))
      ? (value.layout as 1 | 2 | 3 | 4)
      : 2,
    labelPos: value.labelPos === 'left' ? 'left' : 'top',
    viewSize: ['small', 'medium', 'large'].includes(String(value.viewSize))
      ? value.viewSize
      : 'small',
  }
}

function snapshot() {
  return JSON.stringify({
    fields: fields.value.map((field) => ({
      ...field,
      draft: undefined,
    })),
    formProp: formProp.value,
  })
}

async function load() {
  loading.value = true
  try {
    const { data } = await metadataApi.formConfig(props.module)
    fields.value = data.fields.map(normalizeField)
    formProp.value = normalizeFormProp(data.formProp)
    activeId.value = null
    savedSnapshot.value = snapshot()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function nextAvailableLabel(label: string, exceptId?: string) {
  const used = new Set(
    fields.value
      .filter((field) => field.id !== exceptId)
      .map((field) => field.label.trim())
      .filter(Boolean),
  )
  if (!used.has(label)) return label
  let index = 2
  while (used.has(`${label} ${index}`)) index++
  return `${label} ${index}`
}

function selectField(field: ModuleFormFieldDraft) {
  activeId.value = field.id
}

function addField(field: ModuleFormFieldDraft) {
  field.label = nextAvailableLabel(field.label)
  fields.value.push(field)
  activeId.value = field.id
}

function handleDraggedField(field: ModuleFormFieldDraft) {
  field.label = nextAvailableLabel(field.label, field.id)
}

function copyField(field: ModuleFormFieldDraft) {
  const copy = cloneDraftField(field)
  copy.label = nextAvailableLabel(copy.label)
  const index = fields.value.findIndex((candidate) => candidate.id === field.id)
  fields.value.splice(index + 1, 0, copy)
  activeId.value = copy.id
}

function changeLayout(layout: 1 | 2 | 3 | 4) {
  formProp.value.layout = layout
  const span = 24 / layout
  fields.value.forEach((field) => {
    if (['attachment', 'sub_product'].includes(field.type)) return
    field.span = span
  })
}

async function removeField(field: ModuleFormFieldDraft) {
  if (field.system) return
  if (!isDraftField(field)) {
    const confirmed = await ElMessageBox.confirm(
      `删除字段「${field.label}」后，保存表单时会同时删除该字段已经保存的业务值，且无法恢复。确定删除？`,
      '删除字段',
      { type: 'warning' },
    ).catch(() => false)
    if (!confirmed) return
  }
  fields.value = fields.value.filter((candidate) => candidate.id !== field.id)
  if (activeId.value === field.id) activeId.value = null
}

function validateDraft(): boolean {
  const labels = fields.value.map((field) => field.label.trim())
  if (labels.some((label) => !label)) {
    ElMessage.warning('字段名称不能为空')
    return false
  }
  if (new Set(labels).size !== labels.length) {
    ElMessage.warning('字段名称不能重复')
    return false
  }
  for (const field of fields.value) {
    if (['select', 'multiselect', 'radio', 'checkbox'].includes(field.type)) {
      const options = field.options ?? []
      if (!options.length || options.some((option) => !option.label.trim() || !option.value.trim())) {
        ElMessage.warning(`「${field.label}」请至少配置一个完整选项`)
        activeId.value = field.id
        return false
      }
      const optionLabels = options.map((option) => option.label.trim())
      const optionValues = options.map((option) => option.value.trim())
      if (
        new Set(optionLabels).size !== optionLabels.length ||
        new Set(optionValues).size !== optionValues.length
      ) {
        ElMessage.warning(`「${field.label}」的选项名称和值不能重复`)
        activeId.value = field.id
        return false
      }
    }
    if (field.type === 'formula' && !field.config?.formula?.trim()) {
      ElMessage.warning(`「${field.label}」请输入公式表达式`)
      activeId.value = field.id
      return false
    }
    if (
      ['data_source', 'data_source_multiple'].includes(field.type) &&
      !field.config?.dataSourceType
    ) {
      ElMessage.warning(`「${field.label}」请选择数据源`)
      activeId.value = field.id
      return false
    }
  }
  return true
}

function buildPayload(): SaveModuleFormInput {
  return {
    fields: fields.value.map((field) => {
      const config = JSON.parse(JSON.stringify(field.config ?? {})) as NonNullable<
        ModuleFormFieldDraft['config']
      >
      if (!supportsMobileSearchSelect(field.type)) delete config.mobileSelectMode
      return {
        ...(isDraftField(field) ? {} : { id: field.id }),
        label: field.label.trim(),
        type: field.type,
        required: field.type === 'formula' || field.type === 'sub_product' ? false : field.required,
        options: field.options?.map((option) => ({
          ...option,
          label: option.label.trim(),
          value: option.value.trim(),
        })),
        config,
        span: field.type === 'sub_product' ? 24 : field.span,
        showInList: field.type === 'sub_product' ? false : field.showInList,
        listWidth: field.type === 'sub_product' ? null : field.listWidth,
        hidden: field.hidden,
        mobile: field.mobile ?? true,
        subFields:
          field.type === 'sub_product'
            ? (field.subFields ?? []).map((subField) => ({
                id: subField.id,
                key: subField.key,
                label: subField.label,
                type: subField.type as SubTableFieldType,
                required: subField.required,
                options: subField.options ?? undefined,
                config: subField.config ?? undefined,
              }))
            : undefined,
      }
    }),
    formProp: JSON.parse(JSON.stringify(formProp.value)) as ModuleFormProp,
  }
}

async function save(): Promise<boolean> {
  if (saving.value) return false
  if (!validateDraft()) return false
  saving.value = true
  try {
    const { data } = await metadataApi.saveFormDesign(props.module, buildPayload())
    fields.value = data.fields.map(normalizeField)
    formProp.value = normalizeFormProp(data.formProp)
    activeId.value = null
    savedSnapshot.value = snapshot()
    ElMessage.success('表单设置已保存')
    emit('saved')
    return true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    return false
  } finally {
    saving.value = false
  }
}

function hasUnsavedChanges() {
  return dirty.value
}

watch(
  () => props.module,
  () => void load(),
  { immediate: true },
)

defineExpose({
  save,
  load,
  hasUnsavedChanges,
  saving,
  loading,
})
</script>

<template>
  <div v-loading="loading" class="grid h-full min-h-0 grid-cols-[280px_minmax(0,1fr)_280px]">
    <ModuleFormFieldPalette :module="module" @add="addField" />
    <ModuleFormCanvas
      v-model="fields"
      :active-id="activeId"
      :form-prop="formProp"
      class="min-w-0 border-x border-[var(--el-border-color-lighter)]"
      @select="selectField"
      @added="handleDraggedField"
      @remove="removeField"
      @copy="copyField"
    />
    <ModuleFormProperties
      v-model:field="activeField"
      v-model:form-prop="formProp"
      :module="module"
      :fields="fields"
      @layout-change="changeLayout"
    />
  </div>
</template>
