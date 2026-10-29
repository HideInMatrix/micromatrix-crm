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
  teleported?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | undefined]
  record: [value: DataSourceRecordVO | null]
}>()

const pageSize = 50
const loading = ref(false)
const loadingMore = ref(false)
const resolvedOptions = ref<DataSourceOptionVO[]>([])
const pageOptions = ref<DataSourceOptionVO[]>([])
const currentPage = ref(0)
const total = ref(0)
const activeKeyword = ref('')
const selectedRecord = ref<DataSourceRecordVO | null>(null)
let activeFilters: Awaited<ReturnType<typeof buildDataSourceFilters>> = []
let activeFilterMode: 'AND' | 'OR' = 'AND'
let searchSeq = 0
let recordSeq = 0
let resolveSeq = 0

const selectedIds = computed(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue.filter(Boolean)
  return props.modelValue ? [props.modelValue] : []
})

const selectOptions = computed(() => {
  const merged = new Map<string, DataSourceOptionVO>()
  for (const item of [...resolvedOptions.value, ...pageOptions.value]) {
    merged.set(item.id, item)
  }
  // 即使源记录已被删除或当前用户无权访问，也保留已保存的 ID，避免编辑表单丢失选中值。
  for (const id of selectedIds.value) {
    if (!merged.has(id)) merged.set(id, { id, name: id })
  }
  return [...merged.values()].map((item) => ({ label: item.name, value: item.id }))
})

function appendPageOptions(next: DataSourceOptionVO[]) {
  const merged = new Map(pageOptions.value.map((item) => [item.id, item]))
  for (const item of next) merged.set(item.id, item)
  pageOptions.value = [...merged.values()]
}

async function resolveSelected() {
  const seq = ++resolveSeq
  if (!props.sourceType || !selectedIds.value.length) {
    resolvedOptions.value = []
    selectedRecord.value = null
    return
  }
  try {
    const rows = await dataSourceApi.resolve(props.sourceType, selectedIds.value)
    if (seq !== resolveSeq) return
    resolvedOptions.value = rows
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
  const query = keyword.trim()
  activeKeyword.value = query
  currentPage.value = 0
  total.value = 0
  pageOptions.value = []
  loading.value = true
  loadingMore.value = false
  try {
    const filters = await buildDataSourceFilters(
      props.sourceType,
      props.field?.config?.combineSearch,
      props.formFields ?? [],
      props.formValues ?? {},
    )
    const filterMode = props.field?.config?.combineSearch?.searchMode ?? 'AND'
    const page = await dataSourceApi.page(props.sourceType, {
      current: 1,
      pageSize,
      keyword: query || undefined,
      filters,
      filterMode,
    })
    if (seq !== searchSeq) return
    activeFilters = filters
    activeFilterMode = filterMode
    pageOptions.value = page.list
    currentPage.value = page.current
    total.value = page.total
  } catch (error) {
    if (seq !== searchSeq) return
    ElMessage.error(extractErrorMessage(error))
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

async function loadMore(direction: string) {
  if (
    direction !== 'bottom' ||
    loading.value ||
    loadingMore.value ||
    currentPage.value * pageSize >= total.value
  ) {
    return
  }
  const seq = searchSeq
  loadingMore.value = true
  try {
    const page = await dataSourceApi.page(props.sourceType, {
      current: currentPage.value + 1,
      pageSize,
      keyword: activeKeyword.value || undefined,
      filters: activeFilters,
      filterMode: activeFilterMode,
    })
    if (seq !== searchSeq) return
    appendPageOptions(page.list)
    currentPage.value = page.current
    total.value = page.total
  } catch (error) {
    if (seq !== searchSeq) return
    ElMessage.error(extractErrorMessage(error))
  } finally {
    if (seq === searchSeq) loadingMore.value = false
  }
}

watch(
  () => props.sourceType,
  async () => {
    searchSeq += 1
    recordSeq += 1
    loading.value = false
    loadingMore.value = false
    resolvedOptions.value = []
    pageOptions.value = []
    currentPage.value = 0
    total.value = 0
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
    <el-select-v2
      :model-value="modelValue"
      :options="selectOptions"
      :multiple="multiple"
      filterable
      remote
      clearable
      reserve-keyword
      :remote-method="search"
      :loading="loading || loadingMore"
      :disabled="disabled"
      :placeholder="placeholder ?? '请选择数据'"
      :teleported="teleported ?? true"
      class="w-full"
      collapse-tags
      collapse-tags-tooltip
      @visible-change="$event && search()"
      @end-reached="loadMore"
      @update:model-value="update"
    />
    <div v-if="displayFields.length" class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      <div v-for="item in displayFields" :key="item.id" class="min-w-0 flex gap-1">
        <span class="shrink-0 text-[var(--el-text-color-secondary)]">{{ item.label }}：</span>
        <span class="truncate text-[var(--el-text-color-regular)]">{{ displayValue(item) }}</span>
      </div>
    </div>
  </div>
</template>
