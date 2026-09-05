<script setup lang="ts">
import { FIELD_TYPE_OPTIONS, type FieldVO } from '@micromatrix/shared'
import draggable from 'vuedraggable'

defineProps<{
  fields: FieldVO[]
}>()

const emit = defineEmits<{
  create: []
  edit: [field: FieldVO]
  remove: [field: FieldVO]
  reorder: []
  'update:fields': [fields: FieldVO[]]
}>()

function typeLabel(type: string) {
  return FIELD_TYPE_OPTIONS.find((item) => item.value === type)?.label ?? type
}
</script>

<template>
  <div class="mb-3 flex items-center justify-between">
    <div>
      <div class="text-sm font-600">字段设计</div>
      <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
        名称和负责人是系统字段；其它字段可按业务需要新增和排序。
      </div>
    </div>
    <el-button type="primary" plain @click="emit('create')">新增字段</el-button>
  </div>

  <div class="border border-[var(--el-border-color)] rounded-1.5 overflow-hidden">
    <div
      class="grid grid-cols-[30px_1fr_120px_70px_80px_70px_130px] items-center gap-2 bg-[var(--el-fill-color-light)] px-3 py-2 text-xs text-[var(--el-text-color-secondary)]"
    >
      <span />
      <span>字段名称</span>
      <span>类型</span>
      <span>必填</span>
      <span>列表显示</span>
      <span>栅格</span>
      <span>操作</span>
    </div>
    <draggable
      :model-value="fields"
      item-key="id"
      handle=".custom-form-field-drag"
      @update:model-value="emit('update:fields', $event)"
      @end="emit('reorder')"
    >
      <template #item="{ element: field }">
        <div
          class="grid grid-cols-[30px_1fr_120px_70px_80px_70px_130px] items-center gap-2 border-t border-[var(--el-border-color-lighter)] px-3 py-2.5 text-sm"
        >
          <span class="custom-form-field-drag cursor-move text-[var(--el-text-color-placeholder)]">
            ⠿
          </span>
          <span class="min-w-0 truncate">
            {{ field.label }}
            <span class="ml-1 text-xs text-[var(--el-text-color-placeholder)]">
              {{ field.key }}
            </span>
          </span>
          <span>{{ typeLabel(field.type) }}</span>
          <span>{{ field.required ? '是' : '-' }}</span>
          <span>{{ field.showInList ? '是' : '-' }}</span>
          <span>{{ field.span }}/24</span>
          <span>
            <el-button link type="primary" @click="emit('edit', field)">编辑</el-button>
            <el-button link type="danger" :disabled="field.system" @click="emit('remove', field)">
              删除
            </el-button>
          </span>
        </div>
      </template>
    </draggable>
  </div>
</template>
