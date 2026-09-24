<script setup lang="ts">
import type { ModuleKey } from '@micromatrix/shared'
import {
  AlignLeft,
  BadgeDollarSign,
  Building2,
  CalendarDays,
  Calculator,
  CheckSquare2,
  CircleDot,
  Database,
  Hash,
  Image,
  ListChecks,
  Mail,
  MapPin,
  Paperclip,
  Percent,
  Phone,
  Table2,
  ToggleLeft,
  Type,
  UserRound,
} from 'lucide-vue-next'
import type { Component } from 'vue'
import draggable from 'vuedraggable'
import {
  ADVANCED_FIELD_PALETTE,
  BASIC_FIELD_PALETTE,
  createDraftField,
  type FieldPaletteItem,
  type ModuleFormFieldDraft,
} from './types'

const props = defineProps<{
  module: ModuleKey
}>()

const emit = defineEmits<{
  add: [field: ModuleFormFieldDraft]
}>()

const iconMap: Record<string, Component> = {
  text: Type,
  textarea: AlignLeft,
  number: Hash,
  currency: BadgeDollarSign,
  percent: Percent,
  date: CalendarDays,
  datetime: CalendarDays,
  select: ListChecks,
  multiselect: ListChecks,
  radio: CircleDot,
  checkbox: CheckSquare2,
  switch: ToggleLeft,
  member: UserRound,
  dept: Building2,
  phone: Phone,
  email: Mail,
  picture: Image,
  location: MapPin,
  attachment: Paperclip,
  data_source: Database,
  data_source_multiple: Database,
  sub_product: Table2,
  formula: Calculator,
}

function cloneItem(item: FieldPaletteItem) {
  return createDraftField(props.module, item)
}

function add(item: FieldPaletteItem) {
  emit('add', cloneItem(item))
}

</script>

<template>
  <div class="h-full overflow-y-auto bg-[var(--el-bg-color)] p-4">
    <div class="mb-4 text-sm font-semibold text-[var(--el-text-color-primary)]">基础字段</div>
    <draggable
      :list="BASIC_FIELD_PALETTE"
      item-key="type"
      :sort="false"
      :group="{ name: 'module-form-designer', pull: 'clone', put: false }"
      :clone="cloneItem"
      ghost-class="opacity-50"
      class="mb-6 grid grid-cols-2 gap-3"
    >
      <template #item="{ element }">
        <button
          type="button"
          class="flex cursor-move items-center gap-2 rounded-[var(--el-border-radius-base)] border border-transparent bg-[var(--el-fill-color-lighter)] px-3 py-2 text-left text-sm text-[var(--el-text-color-regular)] transition hover:border-[var(--el-color-primary)] hover:text-[var(--el-color-primary)]"
          @click="add(element)"
        >
          <component :is="iconMap[element.type]" :size="16" :stroke-width="1.8" />
          <span class="truncate">{{ element.label }}</span>
        </button>
      </template>
    </draggable>

    <div class="mb-4 text-sm font-semibold text-[var(--el-text-color-primary)]">高级字段</div>
    <draggable
      :list="ADVANCED_FIELD_PALETTE"
      item-key="type"
      :sort="false"
      :group="{ name: 'module-form-designer', pull: 'clone', put: false }"
      :clone="cloneItem"
      ghost-class="opacity-50"
      class="grid grid-cols-2 gap-3"
    >
      <template #item="{ element }">
        <button
          type="button"
          class="flex cursor-move items-center gap-2 rounded-[var(--el-border-radius-base)] border border-transparent bg-[var(--el-fill-color-lighter)] px-3 py-2 text-left text-sm text-[var(--el-text-color-regular)] transition hover:border-[var(--el-color-primary)] hover:text-[var(--el-color-primary)]"
          @click="add(element)"
        >
          <component :is="iconMap[element.type]" :size="16" :stroke-width="1.8" />
          <span class="truncate">{{ element.label }}</span>
        </button>
      </template>
    </draggable>
  </div>
</template>
