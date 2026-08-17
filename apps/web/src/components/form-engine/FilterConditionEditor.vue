<script setup lang="ts">
import {
  FILTER_OP_LABELS,
  filterOpsForType,
  type DepartmentVO,
  type FieldVO,
  type FilterCondition,
  type FilterOp,
} from '@micromatrix/shared'
import { computed } from 'vue'
import type { MemberOption } from '@/api/system'

const props = withDefaults(
  defineProps<{
    fields: FieldVO[]
    members: MemberOption[]
    deptTree: DepartmentVO[]
    showSearchMode?: boolean
  }>(),
  { showSearchMode: false },
)

const conditions = defineModel<FilterCondition[]>({ required: true })
const searchMode = defineModel<'AND' | 'OR'>('searchMode', { default: 'AND' })

const filterableFields = computed(() =>
  props.fields.filter((field) => !field.hidden && field.type !== 'formula'),
)

function fieldOf(key: string): FieldVO | undefined {
  return props.fields.find((field) => field.key === key)
}

function opsOf(key: string): FilterOp[] {
  const field = fieldOf(key)
  return field ? filterOpsForType(field.type) : []
}

function needValue(op: FilterOp): boolean {
  return op !== 'isEmpty' && op !== 'notEmpty'
}

function addCondition() {
  const first = filterableFields.value[0]
  if (!first) return
  conditions.value.push({
    key: first.key,
    op: filterOpsForType(first.type)[0],
    value: undefined,
  })
}

function handleKeyChange(condition: FilterCondition) {
  condition.op = opsOf(condition.key)[0]
  condition.value = undefined
}

function removeCondition(index: number) {
  conditions.value.splice(index, 1)
}

function getValidConditions() {
  return conditions.value.filter(
    (condition) =>
      !needValue(condition.op) ||
      (condition.value !== undefined && condition.value !== null && condition.value !== ''),
  )
}

function hasIncompleteCondition() {
  return getValidConditions().length !== conditions.value.length
}

defineExpose({ getValidConditions, hasIncompleteCondition })
</script>

<template>
  <div class="space-y-2">
    <div v-if="showSearchMode" class="flex items-center gap-3 pb-2">
      <span class="text-sm text-[var(--el-text-color-regular)]">条件关系</span>
      <el-radio-group v-model="searchMode" size="small">
        <el-radio-button value="AND">全部满足</el-radio-button>
        <el-radio-button value="OR">任一满足</el-radio-button>
      </el-radio-group>
    </div>

    <div
      v-if="conditions.length === 0"
      class="text-sm text-[var(--el-text-color-secondary)] py-2"
    >
      暂无筛选条件，点击下方“添加条件”
    </div>

    <div
      v-for="(condition, index) in conditions"
      :key="index"
      class="flex items-center gap-2"
    >
      <el-select
        :model-value="condition.key"
        class="!w-40"
        @update:model-value="(condition.key = $event), handleKeyChange(condition)"
      >
        <el-option
          v-for="field in filterableFields"
          :key="field.key"
          :label="field.label"
          :value="field.key"
        />
      </el-select>

      <el-select v-model="condition.op" class="!w-28">
        <el-option
          v-for="op in opsOf(condition.key)"
          :key="op"
          :label="FILTER_OP_LABELS[op]"
          :value="op"
        />
      </el-select>

      <template v-if="needValue(condition.op)">
        <template v-if="fieldOf(condition.key)?.type === 'member'">
          <el-select v-model="condition.value as string" filterable class="flex-1">
            <el-option v-for="member in members" :key="member.id" :label="member.name" :value="member.id" />
          </el-select>
        </template>
        <template v-else-if="fieldOf(condition.key)?.type === 'dept'">
          <el-tree-select
            v-model="condition.value as string"
            :data="deptTree"
            :props="{ label: 'name', children: 'children' }"
            node-key="id"
            check-strictly
            class="flex-1"
          />
        </template>
        <template
          v-else-if="
            ['select', 'multiselect', 'radio', 'checkbox'].includes(
              fieldOf(condition.key)?.type ?? '',
            )
          "
        >
          <el-select v-model="condition.value as string" class="flex-1">
            <el-option
              v-for="option in fieldOf(condition.key)?.options ?? []"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </template>
        <template
          v-else-if="
            ['number', 'currency', 'percent'].includes(fieldOf(condition.key)?.type ?? '')
          "
        >
          <el-input-number
            v-model="condition.value as number"
            controls-position="right"
            class="flex-1"
          />
        </template>
        <template v-else-if="['date', 'datetime'].includes(fieldOf(condition.key)?.type ?? '')">
          <el-date-picker
            v-model="condition.value as string"
            type="date"
            value-format="YYYY-MM-DD"
            class="flex-1"
          />
        </template>
        <template v-else>
          <el-input v-model="condition.value as string" class="flex-1" placeholder="筛选值" />
        </template>
      </template>
      <div v-else class="flex-1" />

      <el-button link type="danger" @click="removeCondition(index)">删除</el-button>
    </div>

    <div class="pt-2">
      <el-button link type="primary" @click="addCondition">+ 添加条件</el-button>
    </div>
  </div>
</template>
