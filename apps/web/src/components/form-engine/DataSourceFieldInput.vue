<script setup lang="ts">
import type {
  DataSourceOptionVO,
  DataSourceRecordVO,
  DataSourceType,
  FieldVO,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { buildDataSourceFilters, dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  modelValue?: string | string[]
  sourceType: DataSourceType
  multiple?: boolean
  placeholder?: string
  disabled?: boolean
  field?: FieldVO
  formFields?: FieldVO[]
  formValues?: Record<string, unknown>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | undefined]
  record: [value: DataSourceRecordVO | null]
}>()

const loading = ref(false)
const options = ref<DataSourceOptionVO[]>([])
const selectedRecord = ref<DataSourceRecordVO | null>(null)
let searchSeq = 0
let recordSeq = 0
let resolveSeq = 0

const selectedIds = computed(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue.filter(Boolean)
  return props.modelValue ? [props.modelValue] : []
})

function mergeOptions(next: DataSourceOptionVO[]) {
  const merged = new Map(options.value.map((item) => [item.id, item]))
  for (const item of next) merged.set(item.id, item)
  options.value = [...merged.values()]
}

async function resolveSelected() {
  const seq = ++resolveSeq
  if (!props.sourceType || !selectedIds.value.length) {
    selectedRecord.value = null
    return
  }
  try {
    const rows = await dataSourceApi.resolve(props.sourceType, selectedIds.value)
    if (seq !== resolveSeq) return
    mergeOptions(rows)
    if (!props.multiple && selectedIds.value[0]) {
      const record = await dataSourceApi.record(props.sourceType, selectedIds.value[0])
      if (seq === resolveSeq) selectedRecord.value = record
    } else {
      selectedRecord.value = null
    }
  } catch {
    // 引用源被停用、删除或当前用户失去权限时，Element Plus 会退化显示原始 ID。
  }
}

async function search(keyword = '') {
  if (!props.sourceType) return
  const seq = ++searchSeq
  loading.value = true
  try {
    const filters = await buildDataSourceFilters(
      props.sourceType,
      props.field?.config?.combineSearch,
      props.formFields ?? [],
      props.formValues ?? {},
    )
    const page = await dataSourceApi.page(props.sourceType, {
      current: 1,
      pageSize: 50,
      keyword: keyword.trim() || undefined,
      filters,
      filterMode: props.field?.config?.combineSearch?.searchMode ?? 'AND',
    })
    if (seq !== searchSeq) return
    mergeOptions(page.list)
  } catch (error) {
    if (seq !== searchSeq) return
    ElMessage.error(extractErrorMessage(error))
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

watch(
  () => props.sourceType,
  async () => {
    recordSeq += 1
    options.value = []
    await resolveSelected()
  },
  { immediate: true },
)

watch(
  () => selectedIds.value.join('\u0000'),
  () => void resolveSelected(),
)

function update(value: string | string[] | undefined) {
  emit('update:modelValue', value)
  const seq = ++recordSeq
  if (props.multiple || typeof value !== 'string' || !value) {
    selectedRecord.value = null
    emit('record', null)
    return
  }
  void dataSourceApi.record(props.sourceType, value).then((record) => {
    if (seq !== recordSeq) return
    selectedRecord.value = record
    emit('record', record)
  })
}

const displayFields = computed(() => {
  const ids = new Set(props.field?.config?.showFields ?? [])
  if (!ids.size || !selectedRecord.value) return []
  return selectedRecord.value.fields.filter((field) => ids.has(field.id))
})

function displayValue(field: FieldVO): string {
  const value = selectedRecord.value?.values[field.id]
  if (value === undefined || value === null || value === '') return '-'
  if (field.type === 'sub_product') return `${Array.isArray(value) ? value.length : 0} 行`
  const optionMap = new Map((field.options ?? []).map((option) => [option.value, option.label]))
  if (Array.isArray(value)) {
    return value.map((item) => optionMap.get(String(item)) ?? String(item)).join('、') || '-'
  }
  return optionMap.get(String(value)) ?? String(value)
}
</script>

<template>
  <div class="w-full">
    <el-select
      :model-value="modelValue"
      :multiple="multiple"
      filterable
      remote
      clearable
      reserve-keyword
      :remote-method="search"
      :loading="loading"
      :disabled="disabled"
      :placeholder="placeholder ?? '请选择数据'"
      class="w-full"
      collapse-tags
      collapse-tags-tooltip
      @visible-change="$event && search()"
      @update:model-value="update"
    >
      <el-option
        v-for="option in options"
        :key="option.id"
        :label="option.name"
        :value="option.id"
      />
    </el-select>
    <div v-if="displayFields.length" class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <div v-for="item in displayFields" :key="item.id" class="min-w-0 flex gap-1">
        <span class="shrink-0 text-[var(--el-text-color-secondary)]">{{ item.label }}：</span>
        <span class="truncate text-[var(--el-text-color-regular)]">{{ displayValue(item) }}</span>
      </div>
    </div>
  </div>
</template>
