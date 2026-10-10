<script setup lang="ts">
import type {
  FieldVO, FilterCondition, ModuleQuickSearchConfig, QuickSearchItem,
  QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { computed, reactive } from 'vue'

const props = defineProps<{
  config: ModuleQuickSearchConfig
  fields: FieldVO[]
  leadStages?: Array<{ key: string; name: string; enabled?: boolean }>
}>()
const emit = defineEmits<{
  search: [payload: { filters: FilterCondition[]; quickGroups: QuickSearchQueryGroup[] }]
  reset: []
}>()
const values = reactive<Record<string, string>>({})
const fieldMap = computed(() => new Map(props.fields.filter((field) => !field.hidden).map((field) => [field.key, field])))
const visibleItems = computed(() =>
  props.config.items.filter((item) =>
    item.kind === 'preset_select' || fieldMap.value.has(item.fieldKey ?? ''),
  ),
)
function fieldOf(item: QuickSearchItem) { return fieldMap.value.get(item.fieldKey ?? '') }
function choices(item: QuickSearchItem) {
  if (item.fieldKey === 'status' && props.leadStages?.length) {
    return props.leadStages.map((stage) => ({ value: stage.key, label: stage.name }))
  }
  return fieldOf(item)?.options?.map((option) => ({ value: option.value, label: option.label })) ?? []
}

function submit() {
  const filters: FilterCondition[] = []
  const quickGroups: QuickSearchQueryGroup[] = []
  for (const item of visibleItems.value) {
    const raw = (values[item.id] ?? '').trim()
    if (!raw) continue
    if (item.kind === 'preset_select') {
      const selected = item.options?.find((option) => option.id === raw)
      if (selected?.conditions.length) {
        quickGroups.push({
          mode: selected.searchMode,
          conditions: selected.conditions.map((condition) => ({ ...condition })),
        })
      }
      continue
    }
    if (item.kind !== 'field' || !item.fieldKey) continue
    const field = fieldOf(item)
    const value = field && ['number', 'currency', 'percent'].includes(field.type) ? Number(raw) : raw
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    filters.push({ key: item.fieldKey, op: item.operator ?? 'eq', value })
  }
  emit('search', { filters, quickGroups })
}
function reset() {
  for (const key of Object.keys(values)) delete values[key]
  emit('reset')
}
</script>

<template>
  <div class="mb-4 flex flex-wrap items-end gap-3 rounded-lg bg-[var(--el-bg-color)] p-4" data-testid="module-quick-search">
    <div v-for="item in visibleItems" :key="item.id" class="min-w-[190px] flex-1 max-w-[320px]">
      <div class="mb-1 text-sm text-[var(--el-text-color-regular)]">{{ item.label }}</div>
      <el-select
        v-if="item.kind === 'preset_select'"
        v-model="values[item.id]"
        clearable class="w-full"
        :placeholder="item.placeholder || '全部'"
      >
        <el-option label="全部" value="" />
        <el-option
          v-for="option in (item.options ?? [])"
          :key="option.id" :label="option.label" :value="option.id"
        />
      </el-select>
      <el-select v-else-if="item.kind === 'field' && ['select', 'radio'].includes(fieldOf(item)?.type ?? '')"
        v-model="values[item.id]" clearable class="w-full" :placeholder="item.placeholder || '全部'">
        <el-option v-for="option in choices(item)" :key="option.value" :label="option.label" :value="option.value" />
      </el-select>
      <el-date-picker v-else-if="item.kind === 'field' && ['date', 'datetime'].includes(fieldOf(item)?.type ?? '')"
        v-model="values[item.id]" class="!w-full" :type="fieldOf(item)?.type === 'datetime' ? 'datetime' : 'date'"
        :value-format="fieldOf(item)?.type === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'"
        :placeholder="item.placeholder || '选择日期'" />
      <el-input v-else v-model="values[item.id]" class="w-full"
        :placeholder="item.placeholder || '请输入'" clearable @keyup.enter="submit" />
    </div>
    <el-button type="primary" @click="submit">查询</el-button>
    <el-button @click="reset">重置</el-button>
  </div>
</template>
