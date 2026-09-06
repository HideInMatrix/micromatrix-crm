<script setup lang="ts">
import {
  FILTER_OP_LABELS,
  filterOpsForType,
  type DataSourceFilterItem,
  type DataSourceFilterOperator,
  type DataSourceType,
  type FieldConfig,
  type FieldVO,
  type FilterOp,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { loadDataSourceFields } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  sourceType?: DataSourceType
  fields: FieldVO[]
  currentFieldId?: string
}>()

const config = defineModel<FieldConfig>({ required: true })
const sourceFields = ref<FieldVO[]>([])
const loading = ref(false)

const currentFields = computed(() =>
  props.fields.filter((field) => !field.system && field.id !== props.currentFieldId),
)

const operatorByFilterOp: Record<FilterOp, DataSourceFilterOperator> = {
  eq: 'EQUALS',
  ne: 'NOT_EQUALS',
  in: 'IN',
  notIn: 'NOT_IN',
  contains: 'CONTAINS',
  notContains: 'NOT_CONTAINS',
  gt: 'GT',
  gte: 'GE',
  lt: 'LT',
  lte: 'LE',
  isEmpty: 'EMPTY',
  notEmpty: 'NOT_EMPTY',
}
const filterOpByOperator = Object.fromEntries(
  Object.entries(operatorByFilterOp).map(([key, value]) => [value, key]),
) as Record<DataSourceFilterOperator, FilterOp>

async function loadFields() {
  const sourceType = props.sourceType
  if (!sourceType) {
    sourceFields.value = []
    return
  }
  loading.value = true
  try {
    sourceFields.value = await loadDataSourceFields(sourceType)
  } catch (error) {
    sourceFields.value = []
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

watch(
  () => props.sourceType,
  () => void loadFields(),
  { immediate: true },
)

function sourceField(item: DataSourceFilterItem) {
  return sourceFields.value.find((field) => field.id === item.leftFieldId)
}

function operatorOptions(item: DataSourceFilterItem) {
  const field = sourceField(item)
  if (!field) return []
  return filterOpsForType(field.type).map((op) => ({
    value: operatorByFilterOp[op],
    label: FILTER_OP_LABELS[op],
  }))
}

function defaultOperator(field?: FieldVO): DataSourceFilterOperator {
  const op = field ? filterOpsForType(field.type)[0] : undefined
  return op ? operatorByFilterOp[op] : 'EQUALS'
}

function addCondition() {
  const field = sourceFields.value.find((item) => !item.hidden) ?? sourceFields.value[0]
  if (!field) return
  const conditions = [...(config.value.combineSearch?.conditions ?? [])]
  conditions.push({
    leftFieldId: field.id,
    leftFieldType: field.type,
    operator: defaultOperator(field),
    matchType: 'MATCH_FIELD',
    rightFieldId: currentFields.value[0]?.id,
    rightFieldCustom: false,
    rightFieldType: currentFields.value[0]?.type,
  })
  config.value.combineSearch = {
    searchMode: config.value.combineSearch?.searchMode ?? 'OR',
    conditions,
  }
}

function removeCondition(index: number) {
  const conditions = [...(config.value.combineSearch?.conditions ?? [])]
  conditions.splice(index, 1)
  config.value.combineSearch = conditions.length
    ? { searchMode: config.value.combineSearch?.searchMode ?? 'OR', conditions }
    : undefined
}

function changeSourceField(item: DataSourceFilterItem, fieldId: string) {
  const field = sourceFields.value.find((candidate) => candidate.id === fieldId)
  if (!field) return
  item.leftFieldId = field.id
  item.leftFieldType = field.type
  item.operator = defaultOperator(field)
  item.rightFieldCustomValue = undefined
}

function changeOperator(item: DataSourceFilterItem, operator: DataSourceFilterOperator) {
  item.operator = operator
  const op = filterOpByOperator[operator]
  if (op === 'in' || op === 'notIn') {
    if (!Array.isArray(item.rightFieldCustomValue)) {
      item.rightFieldCustomValue = item.rightFieldCustomValue ? [item.rightFieldCustomValue] : []
    }
  } else if (Array.isArray(item.rightFieldCustomValue)) {
    item.rightFieldCustomValue = item.rightFieldCustomValue[0]
  }
}

function changeMatchType(item: DataSourceFilterItem, matchType: 'MATCH_FIELD' | 'MATCH_VALUE') {
  item.matchType = matchType
  item.rightFieldCustom = matchType === 'MATCH_VALUE'
  if (matchType === 'MATCH_FIELD') {
    const field = currentFields.value[0]
    item.rightFieldId = field?.id
    item.rightFieldType = field?.type
    item.rightFieldCustomValue = undefined
  } else {
    item.rightFieldId = undefined
    item.rightFieldType = item.leftFieldType
  }
}

function changeRightField(item: DataSourceFilterItem, fieldId: string) {
  const field = currentFields.value.find((candidate) => candidate.id === fieldId)
  item.rightFieldId = fieldId
  item.rightFieldType = field?.type
}

function isEmptyOperator(item: DataSourceFilterItem) {
  return ['EMPTY', 'NOT_EMPTY'].includes(item.operator)
}

function isMultipleValue(item: DataSourceFilterItem) {
  return ['IN', 'NOT_IN'].includes(item.operator)
}

function fixedOptions(item: DataSourceFilterItem) {
  return sourceField(item)?.options ?? []
}

function fixedSelectValue(item: DataSourceFilterItem): string | string[] | undefined {
  const value = item.rightFieldCustomValue
  if (isMultipleValue(item)) {
    if (Array.isArray(value)) return value.map(String)
    return value === undefined || value === null || value === '' ? [] : [String(value)]
  }
  if (value === undefined || value === null) return undefined
  return String(value)
}

function updateFixedSelectValue(item: DataSourceFilterItem, value: string | string[]) {
  item.rightFieldCustomValue = value
}

function fixedTextValue(item: DataSourceFilterItem): string {
  const value = item.rightFieldCustomValue
  return value === undefined || value === null ? '' : String(value)
}

function updateFixedTextValue(item: DataSourceFilterItem, value: string) {
  item.rightFieldCustomValue = value
}
</script>

<template>
  <div class="mb-4 rounded-2 border border-[var(--el-border-color)] p-3">
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <div class="text-sm font-600">数据源候选过滤</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          过滤只影响当前数据源下拉候选；动态引用字段为空时该条件不会进入请求。
        </div>
      </div>
      <el-button
        plain
        type="primary"
        :loading="loading"
        :disabled="!sourceFields.length"
        @click="addCondition"
      >
        添加条件
      </el-button>
    </div>

    <div v-if="config.combineSearch?.conditions.length" class="mb-3 flex items-center gap-2">
      <span class="text-sm">条件关系</span>
      <el-radio-group v-model="config.combineSearch.searchMode" size="small">
        <el-radio-button value="AND">并且</el-radio-button>
        <el-radio-button value="OR">或者</el-radio-button>
      </el-radio-group>
    </div>

    <div
      v-if="!config.combineSearch?.conditions.length"
      class="py-3 text-center text-sm text-[var(--el-text-color-secondary)]"
    >
      未配置候选过滤
    </div>

    <div
      v-for="(item, index) in config.combineSearch?.conditions ?? []"
      :key="index"
      class="mb-2 grid grid-cols-[1fr_120px_120px_1fr_60px] items-start gap-2 last:mb-0"
    >
      <el-select
        :model-value="item.leftFieldId"
        filterable
        placeholder="数据源字段"
        @update:model-value="changeSourceField(item, $event)"
      >
        <el-option
          v-for="field in sourceFields"
          :key="field.id"
          :label="field.label"
          :value="field.id"
        />
      </el-select>

      <el-select :model-value="item.operator" @update:model-value="changeOperator(item, $event)">
        <el-option
          v-for="option in operatorOptions(item)"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>

      <el-select
        v-if="!isEmptyOperator(item)"
        :model-value="item.matchType"
        @update:model-value="changeMatchType(item, $event)"
      >
        <el-option label="当前字段" value="MATCH_FIELD" />
        <el-option label="固定值" value="MATCH_VALUE" />
      </el-select>
      <div v-else></div>

      <template v-if="!isEmptyOperator(item)">
        <el-select
          v-if="item.matchType === 'MATCH_FIELD'"
          :model-value="item.rightFieldId"
          filterable
          placeholder="当前表单字段"
          @update:model-value="changeRightField(item, $event)"
        >
          <el-option
            v-for="field in currentFields"
            :key="field.id"
            :label="field.label"
            :value="field.id"
          />
        </el-select>

        <el-select
          v-else-if="fixedOptions(item).length || isMultipleValue(item)"
          :model-value="fixedSelectValue(item)"
          :multiple="isMultipleValue(item)"
          :allow-create="isMultipleValue(item)"
          filterable
          default-first-option
          placeholder="固定值"
          @update:model-value="updateFixedSelectValue(item, $event)"
        >
          <el-option
            v-for="option in fixedOptions(item)"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-input
          v-else
          :model-value="fixedTextValue(item)"
          placeholder="固定值"
          @update:model-value="updateFixedTextValue(item, $event)"
        />
      </template>
      <div v-else></div>

      <el-button text type="danger" @click="removeCondition(index)">删除</el-button>
    </div>
  </div>
</template>
