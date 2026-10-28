<script setup lang="ts">
import type { DataSourceOptionVO, DataSourceType, FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import { dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'
import MobileDataSourcePopupPicker from './MobileDataSourcePopupPicker.vue'

const props = defineProps<{
  field: FieldVO
  modelValue?: string | string[]
  name?: string
  inputAlign?: 'left' | 'right'
  rules?: Array<{ required?: boolean; message?: string }>
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string | string[] | undefined] }>()
const show = ref(false)
const selectedOptions = ref<DataSourceOptionVO[]>([])
const multiple = computed(() => props.field.type === 'data_source_multiple')
const sourceType = computed<DataSourceType>(() => props.field.config?.dataSourceType ?? 'CUSTOMER')
const selectedIds = computed(() => {
  if (multiple.value) {
    return Array.isArray(props.modelValue)
      ? props.modelValue.filter((item): item is string => typeof item === 'string' && Boolean(item))
      : []
  }
  return typeof props.modelValue === 'string' && props.modelValue ? [props.modelValue] : []
})
const displayText = computed(() => selectedOptions.value.map((item) => item.name).join('、'))

let resolveGeneration = 0
async function resolveSelected() {
  const current = ++resolveGeneration
  if (!selectedIds.value.length) {
    selectedOptions.value = []
    return
  }
  try {
    const resolved = await dataSourceApi.resolve(sourceType.value, selectedIds.value)
    if (current !== resolveGeneration) return
    const labels = new Map(resolved.map((option) => [option.id, option]))
    selectedOptions.value = selectedIds.value.flatMap((id) => {
      const option = labels.get(id)
      return option ? [option] : []
    })
  } catch (error) {
    if (current === resolveGeneration) showFailToast(extractErrorMessage(error))
  }
}

function select(ids: string[], option?: DataSourceOptionVO) {
  // 先展示刚选中的名称，再让 ID 变化触发异步解析；不必等待接口响应才回显。
  if (!multiple.value && option && ids[0] === option.id) selectedOptions.value = [option]
  emit('update:modelValue', multiple.value ? ids : ids[0])
}
function clear() {
  selectedOptions.value = []
  emit('update:modelValue', multiple.value ? [] : undefined)
}

watch(
  () => [sourceType.value, JSON.stringify(selectedIds.value)] as const,
  () => void resolveSelected(),
  { immediate: true },
)
</script>

<template>
  <van-field
    :model-value="displayText"
    :input-align="inputAlign"
    :name="name"
    :rules="rules"
    :label="field.label"
    :placeholder="`请选择${field.label}`"
    :required="field.required"
    readonly
    is-link
    clearable
    @clear="clear"
    @click="show = true"
  />
  <MobileDataSourcePopupPicker
    v-model:show="show"
    :label="field.label"
    :source-type="sourceType"
    :selected-ids="selectedIds"
    :multiple="multiple"
    @select="select"
  />
</template>
