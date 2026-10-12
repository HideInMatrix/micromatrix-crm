<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'
import MobileDynamicForm from './MobileDynamicForm.vue'

defineProps<{
  field: FieldVO
  members?: Array<{ id: string; name: string }>
  deptTree?: DepartmentVO[]
}>()
const model = defineModel<unknown>()
const rows = computed<Record<string, unknown>[]>(() =>
  Array.isArray(model.value)
    ? model.value.filter((row): row is Record<string, unknown> =>
        Boolean(row && typeof row === 'object' && !Array.isArray(row)),
      )
    : [],
)

function updateRow(index: number, value: Record<string, unknown>) {
  model.value = rows.value.map((row, i) => (i === index ? value : row))
}
function removeRow(index: number) {
  model.value = rows.value.filter((_, i) => i !== index)
}
function addRow() {
  model.value = [...rows.value, {}]
}
</script>

<template>
  <div class="border-t border-[var(--van-border-color)] px-4 py-3">
    <div class="mb-3 text-sm font-medium text-[var(--van-text-color)]">{{ field.label }}</div>
    <div
      v-for="(row, index) in rows"
      :key="index"
      class="mb-3 overflow-hidden rounded-[6px] border border-[var(--van-border-color)]"
    >
      <div class="flex items-center justify-between bg-[var(--van-background-2)] px-3 py-2 text-sm">
        <span>第 {{ index + 1 }} 行</span>
        <van-button size="mini" plain type="danger" @click="removeRow(index)">删除</van-button>
      </div>
      <MobileDynamicForm
        :model-value="row"
        :fields="field.subFields ?? []"
        :members="members"
        :dept-tree="deptTree"
        @update:model-value="updateRow(index, $event)"
      />
    </div>
    <van-button size="small" block plain type="primary" @click="addRow">添加一行</van-button>
  </div>
</template>
