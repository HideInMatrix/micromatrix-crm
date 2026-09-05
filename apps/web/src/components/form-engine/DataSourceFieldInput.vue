<script setup lang="ts">
import type { DataSourceOptionVO, DataSourceType } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  modelValue?: string | string[]
  sourceType: DataSourceType
  multiple?: boolean
  placeholder?: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | string[] | undefined]
}>()

const loading = ref(false)
const options = ref<DataSourceOptionVO[]>([])
let searchSeq = 0

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
  if (!props.sourceType || !selectedIds.value.length) return
  try {
    const rows = await dataSourceApi.resolve(props.sourceType, selectedIds.value)
    mergeOptions(rows)
  } catch {
    // 引用源被停用、删除或当前用户失去权限时，Element Plus 会退化显示原始 ID。
  }
}

async function search(keyword = '') {
  if (!props.sourceType) return
  const seq = ++searchSeq
  loading.value = true
  try {
    const page = await dataSourceApi.page(props.sourceType, {
      current: 1,
      pageSize: 50,
      keyword: keyword.trim() || undefined,
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
}
</script>

<template>
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
    <el-option v-for="option in options" :key="option.id" :label="option.name" :value="option.id" />
  </el-select>
</template>
