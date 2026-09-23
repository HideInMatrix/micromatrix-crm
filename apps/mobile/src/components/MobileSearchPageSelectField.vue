<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { showFailToast } from 'vant'
import { dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'
import { flattenDepartmentOptions } from '@/utils/search-select'

const props = defineProps<{
  field: FieldVO
  modelValue?: string | string[]
  members?: Array<{ id: string; name: string }>
  deptTree?: DepartmentVO[]
  name?: string
  rules?: Array<{ required?: boolean; message?: string }>
}>()
const emit = defineEmits<{
  (event: 'open'): void
  (event: 'update:modelValue', value: string | string[] | undefined): void
}>()

const resolvedNames = ref<string[]>([])

const ids = computed(() => {
  if (Array.isArray(props.modelValue)) return props.modelValue.filter(Boolean)
  return typeof props.modelValue === 'string' && props.modelValue ? [props.modelValue] : []
})

const displayText = computed(() => {
  if (props.field.type === 'member') {
    const map = new Map((props.members ?? []).map((item) => [item.id, item.name]))
    return ids.value.map((id) => map.get(id) ?? id).join('、')
  }
  if (props.field.type === 'dept') {
    const map = new Map(
      flattenDepartmentOptions(props.deptTree ?? []).map((item) => [item.id, item.name]),
    )
    return ids.value.map((id) => map.get(id) ?? id).join('、')
  }
  return resolvedNames.value.join('、')
})

async function resolveDataSourceNames() {
  if (!['data_source', 'data_source_multiple'].includes(props.field.type) || !ids.value.length) {
    resolvedNames.value = []
    return
  }
  const sourceType = props.field.config?.dataSourceType
  if (!sourceType) {
    resolvedNames.value = []
    return
  }
  try {
    const options = await dataSourceApi.resolve(sourceType, ids.value)
    resolvedNames.value = options.map((item) => item.name)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function clear() {
  emit(
    'update:modelValue',
    props.field.type === 'data_source_multiple' ? [] : undefined,
  )
}

watch(
  () => [props.field.config?.dataSourceType, JSON.stringify(ids.value)] as const,
  () => void resolveDataSourceNames(),
  { immediate: true },
)
</script>

<template>
  <van-field
    :model-value="displayText"
    :name="name"
    :rules="rules"
    :label="field.label"
    :placeholder="'请选择' + field.label"
    :required="field.required"
    readonly
    is-link
    clearable
    @clear="clear"
    @click="emit('open')"
  />
</template>

