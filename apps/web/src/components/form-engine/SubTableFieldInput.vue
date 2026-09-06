<script setup lang="ts">
import { evaluateFormula, type DepartmentVO, type FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'
import type { MemberOption } from '@/api/system'
import DynamicFormItem from './DynamicFormItem.vue'

const props = defineProps<{
  field: FieldVO
  members: MemberOption[]
  deptTree: DepartmentVO[]
}>()

const model = defineModel<unknown>()

const rows = computed<Array<Record<string, unknown>>>(() =>
  Array.isArray(model.value)
    ? model.value.filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === 'object' && !Array.isArray(row)),
      )
    : [],
)

const subFields = computed(() => props.field.subFields ?? [])
const sumColumnIds = computed(() => new Set(props.field.config?.sumColumns ?? []))

function setRows(next: Array<Record<string, unknown>>) {
  model.value = next
}

function addRow() {
  setRows([...rows.value, {}])
}

function removeRow(index: number) {
  setRows(rows.value.filter((_, rowIndex) => rowIndex !== index))
}

function updateCell(index: number, key: string, value: unknown) {
  const next = rows.value.map((row, rowIndex) =>
    rowIndex === index ? { ...row, [key]: value } : row,
  )
  setRows(next)
}

function formulaValue(row: Record<string, unknown>, field: FieldVO) {
  if (field.type !== 'formula' || !field.config?.formula) return undefined
  return evaluateFormula(field.config.formula, row)
}

function columnWidth(field: FieldVO) {
  if (field.type === 'picture') return 220
  if (field.type === 'data_source') return 220
  if (['member', 'dept', 'datetime'].includes(field.type)) return 180
  return 160
}

function columnSum(field: FieldVO) {
  if (!sumColumnIds.value.has(field.id)) return null
  let total = 0
  let hasValue = false
  for (const row of rows.value) {
    const raw = field.type === 'formula' ? formulaValue(row, field) : row[field.key]
    const value = Number(raw)
    if (!Number.isFinite(value)) continue
    total += value
    hasValue = true
  }
  return hasValue ? total : null
}
</script>

<template>
  <div class="w-full overflow-hidden rounded-1.5 border border-[var(--el-border-color)]">
    <el-table :data="rows" row-key="id" class="w-full">
      <el-table-column type="index" label="#" width="52" fixed="left" />
      <el-table-column
        v-for="(subField, index) in subFields"
        :key="subField.id"
        :label="subField.label"
        :min-width="columnWidth(subField)"
        :fixed="index < (field.config?.fixedColumn ?? 1) ? 'left' : undefined"
      >
        <template #header>
          <span>{{ subField.label }}</span>
          <span v-if="subField.required" class="ml-1 text-[var(--el-color-danger)]">*</span>
        </template>
        <template #default="{ row, $index }">
          <DynamicFormItem
            :model-value="row[subField.key]"
            :field="subField"
            :members="members"
            :dept-tree="deptTree"
            :formula-value="formulaValue(row, subField)"
            @update:model-value="updateCell($index, subField.key, $event)"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="76" fixed="right">
        <template #default="{ $index }">
          <el-button link type="danger" @click="removeRow($index)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div
      class="flex items-center justify-between border-t border-[var(--el-border-color-lighter)] px-3 py-2"
    >
      <el-button text type="primary" @click="addRow">+ 添加一行</el-button>
      <div v-if="sumColumnIds.size" class="flex flex-wrap justify-end gap-x-4 gap-y-1 text-sm">
        <template v-for="subField in subFields" :key="subField.id">
          <span v-if="sumColumnIds.has(subField.id)" class="text-[var(--el-text-color-regular)]">
            {{ subField.label }}：{{ columnSum(subField) ?? '-' }}
          </span>
        </template>
      </div>
    </div>
  </div>
</template>
