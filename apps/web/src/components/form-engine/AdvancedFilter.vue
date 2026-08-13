<script setup lang="ts">
import {
  FILTER_OP_LABELS,
  filterOpsForType,
  type DepartmentVO,
  type FieldVO,
  type FilterCondition,
  type FilterOp,
} from '@micromatrix/shared'
import { computed, ref } from 'vue'
import type { MemberOption } from '@/api/system'

const props = defineProps<{
  fields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
}>()

const emit = defineEmits<{ apply: [conditions: FilterCondition[]] }>()

const visible = ref(false)
const conditions = ref<FilterCondition[]>([])

const filterableFields = computed(() =>
  props.fields.filter((f) => !f.hidden && f.type !== 'formula'),
)
const activeCount = ref(0)

function fieldOf(key: string): FieldVO | undefined {
  return props.fields.find((f) => f.key === key)
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
  conditions.value.push({ key: first.key, op: filterOpsForType(first.type)[0], value: undefined })
}

function handleKeyChange(condition: FilterCondition) {
  condition.op = opsOf(condition.key)[0]
  condition.value = undefined
}

function removeCondition(index: number) {
  conditions.value.splice(index, 1)
}

function apply() {
  const valid = conditions.value.filter((c) => !needValue(c.op) || (c.value !== undefined && c.value !== ''))
  activeCount.value = valid.length
  emit('apply', valid)
  visible.value = false
}

function reset() {
  conditions.value = []
  activeCount.value = 0
  emit('apply', [])
  visible.value = false
}
</script>

<template>
  <el-popover v-model:visible="visible" placement="bottom-start" width="640" trigger="click">
    <template #reference>
      <el-badge :value="activeCount" :hidden="activeCount === 0" type="primary">
        <el-button>高级筛选</el-button>
      </el-badge>
    </template>

    <div class="space-y-2">
      <div v-if="conditions.length === 0" class="text-sm text-[var(--el-text-color-secondary)] py-2">
        暂无筛选条件，点击下方"添加条件"
      </div>
      <div v-for="(condition, index) in conditions" :key="index" class="flex items-center gap-2">
        <el-select
          :model-value="condition.key"
          class="!w-40"
          @update:model-value="(condition.key = $event), handleKeyChange(condition)"
        >
          <el-option v-for="f in filterableFields" :key="f.key" :label="f.label" :value="f.key" />
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
          <!-- 按字段类型渲染值输入 -->
          <template v-if="fieldOf(condition.key)?.type === 'member'">
            <el-select v-model="condition.value as string" filterable class="flex-1">
              <el-option v-for="m in members" :key="m.id" :label="m.name" :value="m.id" />
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
            v-else-if="['select', 'multiselect', 'radio', 'checkbox'].includes(fieldOf(condition.key)?.type ?? '')"
          >
            <el-select v-model="condition.value as string" class="flex-1">
              <el-option
                v-for="opt in fieldOf(condition.key)?.options ?? []"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
          </template>
          <template
            v-else-if="['number', 'currency', 'percent'].includes(fieldOf(condition.key)?.type ?? '')"
          >
            <el-input-number v-model="condition.value as number" controls-position="right" class="flex-1" />
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

      <div class="flex-between pt-2 border-t border-[var(--el-border-color-lighter)]">
        <el-button link type="primary" @click="addCondition">+ 添加条件</el-button>
        <div class="flex gap-2">
          <el-button size="small" @click="reset">清空</el-button>
          <el-button size="small" type="primary" @click="apply">应用</el-button>
        </div>
      </div>
    </div>
  </el-popover>
</template>
