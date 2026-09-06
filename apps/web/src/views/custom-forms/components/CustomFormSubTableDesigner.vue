<script setup lang="ts">
import {
  BUILTIN_DATA_SOURCE_OPTIONS,
  FIELD_TYPE_OPTIONS,
  SUB_TABLE_FIELD_TYPES,
  type DataSourceType,
  type FieldConfig,
  type FieldType,
} from '@micromatrix/shared'
import { computed } from 'vue'
import type { SubFieldForm } from '@/api/metadata'

defineProps<{
  customDataSources: Array<{ id: string; name: string }>
}>()

const subFields = defineModel<SubFieldForm[]>('subFields', { required: true })
const config = defineModel<FieldConfig>('config', { required: true })

const typeOptions = FIELD_TYPE_OPTIONS.filter((option) =>
  (SUB_TABLE_FIELD_TYPES as readonly FieldType[]).includes(option.value),
)

const sumOptions = computed(() =>
  subFields.value
    .filter((field) => ['number', 'currency', 'percent', 'formula'].includes(field.type))
    .map((field) => ({ label: field.label || '未命名字段', value: field.id ?? '' }))
    .filter((item) => item.value),
)

function randomHex(bytes: number) {
  const values = crypto.getRandomValues(new Uint8Array(bytes))
  return [...values].map((value) => value.toString(16).padStart(2, '0')).join('')
}

function addField() {
  subFields.value.push({
    id: `sf_${randomHex(8)}`,
    key: `cf_${randomHex(6)}`,
    label: `子字段${subFields.value.length + 1}`,
    type: 'text',
    required: false,
    options: [],
    config: {},
  })
}

function removeField(index: number) {
  const [removed] = subFields.value.splice(index, 1)
  if (!removed?.id || !config.value.sumColumns?.length) return
  config.value.sumColumns = config.value.sumColumns.filter((id) => id !== removed.id)
}

function moveField(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= subFields.value.length) return
  const [field] = subFields.value.splice(index, 1)
  if (!field) return
  subFields.value.splice(target, 0, field)
}

function needsOptions(type: string) {
  return ['select', 'multiselect'].includes(type)
}

function changeType(field: SubFieldForm, type: SubFieldForm['type']) {
  field.type = type
  field.options = needsOptions(type)
    ? field.options?.length
      ? field.options
      : [{ label: '选项1', value: '1' }]
    : []
  if (type === 'data_source') field.config = { dataSourceType: 'PRODUCT' }
  else if (type === 'formula') field.config = { formula: '' }
  else field.config = {}
  if (type === 'formula') field.required = false
  if (field.id && !['number', 'currency', 'percent', 'formula'].includes(type)) {
    config.value.sumColumns = (config.value.sumColumns ?? []).filter((id) => id !== field.id)
  }
}

function updateDataSource(field: SubFieldForm, value: string) {
  field.config = { ...(field.config ?? {}), dataSourceType: value as DataSourceType }
}
</script>

<template>
  <div class="mb-4 rounded-2 border border-[var(--el-border-color)] p-3">
    <div class="mb-3 flex items-center justify-between">
      <div>
        <div class="text-sm font-600">子表字段</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          每个子字段会按独立单元格存储；不支持继续嵌套子表。
        </div>
      </div>
      <el-button type="primary" plain @click="addField">添加子字段</el-button>
    </div>

    <div
      v-if="!subFields.length"
      class="py-5 text-center text-sm text-[var(--el-text-color-secondary)]"
    >
      暂无子字段
    </div>

    <div
      v-for="(field, index) in subFields"
      :key="field.id ?? field.key ?? index"
      class="mb-3 rounded-1.5 bg-[var(--el-fill-color-light)] p-3 last:mb-0"
    >
      <div class="grid grid-cols-[1fr_150px_70px_116px] items-center gap-2">
        <el-input v-model="field.label" maxlength="30" placeholder="子字段名称" />
        <el-select :model-value="field.type" @update:model-value="changeType(field, $event)">
          <el-option
            v-for="option in typeOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-checkbox v-model="field.required" :disabled="field.type === 'formula'"
          >必填</el-checkbox
        >
        <div class="flex justify-end">
          <el-button text :disabled="index === 0" @click="moveField(index, -1)">上移</el-button>
          <el-button text :disabled="index === subFields.length - 1" @click="moveField(index, 1)"
            >下移</el-button
          >
          <el-button text type="danger" @click="removeField(index)">删除</el-button>
        </div>
      </div>

      <div v-if="needsOptions(field.type)" class="mt-2 space-y-2">
        <div
          v-for="(option, optionIndex) in field.options ?? []"
          :key="optionIndex"
          class="flex gap-2"
        >
          <el-input v-model="option.label" placeholder="显示名称" />
          <el-input v-model="option.value" placeholder="保存值" />
          <el-button text type="danger" @click="field.options?.splice(optionIndex, 1)"
            >删除</el-button
          >
        </div>
        <el-button text type="primary" @click="field.options?.push({ label: '', value: '' })"
          >添加选项</el-button
        >
      </div>

      <el-select
        v-if="field.type === 'data_source'"
        class="mt-2 w-full"
        filterable
        :model-value="field.config?.dataSourceType"
        placeholder="选择数据源"
        @update:model-value="updateDataSource(field, $event)"
      >
        <el-option-group label="业务数据">
          <el-option
            v-for="option in BUILTIN_DATA_SOURCE_OPTIONS"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-option-group>
        <el-option-group v-if="customDataSources.length" label="自定义表单">
          <el-option
            v-for="option in customDataSources"
            :key="option.id"
            :label="option.name"
            :value="option.id"
          />
        </el-option-group>
      </el-select>

      <el-input
        v-if="field.type === 'formula'"
        v-model="field.config!.formula"
        class="mt-2"
        placeholder="当前行公式，例如：cf_quantity * cf_price"
      />
    </div>

    <div class="mt-4 grid grid-cols-2 gap-4">
      <div>
        <div class="mb-1.5 text-sm">固定列数量</div>
        <el-select v-model="config.fixedColumn" class="w-full">
          <el-option :value="1" label="1 列" />
          <el-option :value="2" label="2 列" />
          <el-option :value="3" label="3 列" />
        </el-select>
      </div>
      <div>
        <div class="mb-1.5 text-sm">汇总列</div>
        <el-select
          v-model="config.sumColumns"
          multiple
          clearable
          class="w-full"
          placeholder="选择数值或公式列"
        >
          <el-option
            v-for="option in sumOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </div>
    </div>
  </div>
</template>
