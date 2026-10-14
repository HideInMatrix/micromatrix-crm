<script setup lang="ts">
import type {
  FieldVO,
  FilterCondition,
  ModuleQuickSearchConfig,
  QuickSearchItem,
  QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { computed, reactive } from 'vue'
import { buildQuickSearchPayload } from '@/utils/quick-search-query'

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
const fieldMap = computed(
  () => new Map(props.fields.filter((field) => !field.hidden).map((field) => [field.key, field])),
)
const visibleItems = computed(() =>
  props.config.items.filter(
    (item) => item.kind === 'preset_select' || fieldMap.value.has(item.fieldKey ?? ''),
  ),
)
function fieldOf(item: QuickSearchItem) {
  return fieldMap.value.get(item.fieldKey ?? '')
}
function choices(item: QuickSearchItem) {
  if (item.fieldKey === 'status' && props.leadStages?.length) {
    return props.leadStages.map((stage) => ({ value: stage.key, label: stage.name }))
  }
  return (
    fieldOf(item)?.options?.map((option) => ({ value: option.value, label: option.label })) ?? []
  )
}

function submit() {
  emit('search', buildQuickSearchPayload(props.config, props.fields, values))
}
function reset() {
  for (const key of Object.keys(values)) delete values[key]
  emit('reset')
}
</script>

<template>
  <div class="module-quick-search" data-testid="module-quick-search">
    <div v-for="item in visibleItems" :key="item.id" class="module-quick-search__field">
      <span class="module-quick-search__label">{{ item.label }}</span>
      <el-select
        v-if="item.kind === 'preset_select'"
        v-model="values[item.id]"
        class="module-quick-search__select"
        clearable
        :placeholder="item.placeholder || '全部'"
      >
        <el-option label="全部" value="" />
        <el-option
          v-for="option in item.options ?? []"
          :key="option.id"
          :label="option.label"
          :value="option.id"
        />
      </el-select>
      <el-select
        v-else-if="item.kind === 'field' && ['select', 'radio'].includes(fieldOf(item)?.type ?? '')"
        v-model="values[item.id]"
        class="module-quick-search__select"
        clearable
        :placeholder="item.placeholder || '全部'"
      >
        <el-option
          v-for="option in choices(item)"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-date-picker
        v-else-if="
          item.kind === 'field' && ['date', 'datetime'].includes(fieldOf(item)?.type ?? '')
        "
        v-model="values[item.id]"
        class="module-quick-search__date"
        :type="fieldOf(item)?.type === 'datetime' ? 'datetime' : 'date'"
        :value-format="fieldOf(item)?.type === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'"
        :placeholder="item.placeholder || '选择日期'"
      />
      <el-input
        v-else
        v-model="values[item.id]"
        class="module-quick-search__input"
        :placeholder="item.placeholder || '请输入'"
        clearable
        @keyup.enter="submit"
      />
    </div>
    <div class="module-quick-search__actions">
      <el-button type="primary" @click="submit">查询</el-button>
      <el-button @click="reset">重置</el-button>
    </div>
  </div>
</template>

<style scoped>
.module-quick-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 20px;
  row-gap: 12px;
}

.module-quick-search__field {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 11px;
}

.module-quick-search__label {
  color: #333333;
  font-size: 14px;
  font-weight: 400;
  white-space: nowrap;
}

.module-quick-search__input,
.module-quick-search__date {
  width: 220px;
  height: 36px;
  --el-input-border-color: #e4e7ed;
  --el-input-border-radius: 4px;
}

.module-quick-search__select {
  width: 160px;
  height: 36px;
  --el-border-color: #e4e7ed;
}

.module-quick-search__input :deep(.el-input__wrapper),
.module-quick-search__date :deep(.el-input__wrapper) {
  height: 36px;
  border-radius: 4px;
}

.module-quick-search__select :deep(.el-select__wrapper) {
  min-height: 36px;
  height: 36px;
  border-radius: 4px;
}

.module-quick-search__actions {
  display: inline-flex;
  align-items: center;
  gap: 12px;
}

.module-quick-search__actions :deep(.el-button) {
  height: 36px;
  margin-left: 0;
}
</style>
