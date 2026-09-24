<script setup lang="ts">
import type { ModuleFormProp } from '@micromatrix/shared'
import { Copy, GripVertical, Trash2 } from 'lucide-vue-next'
import draggable from 'vuedraggable'
import type { ModuleFormFieldDraft } from './types'

const fields = defineModel<ModuleFormFieldDraft[]>({ required: true })

defineProps<{
  activeId: string | null
  formProp: ModuleFormProp
}>()

const emit = defineEmits<{
  select: [field: ModuleFormFieldDraft]
  added: [field: ModuleFormFieldDraft]
  remove: [field: ModuleFormFieldDraft]
  copy: [field: ModuleFormFieldDraft]
}>()

function fieldWidth(field: ModuleFormFieldDraft) {
  return `${Math.max(25, Math.min(100, (field.span / 24) * 100))}%`
}

function handleAdded(event: { newIndex?: number }) {
  const field = fields.value[event.newIndex ?? -1]
  if (field) {
    emit('added', field)
    emit('select', field)
  }
}

function handleStart(event: { oldIndex?: number }) {
  const field = fields.value[event.oldIndex ?? -1]
  if (field) emit('select', field)
}
</script>

<template>
  <div class="h-full overflow-auto bg-[var(--el-fill-color-lighter)] p-4">
    <div class="mx-auto min-h-full min-w-[640px] max-w-[960px] bg-[var(--el-bg-color)] p-6">
      <draggable
        v-model="fields"
        item-key="id"
        :animation="150"
        :group="{ name: 'module-form-designer', pull: true, put: true }"
        ghost-class="opacity-50"
        class="flex min-h-[calc(100vh-136px)] flex-wrap content-start"
        @add="handleAdded"
        @start="handleStart"
      >
        <template #item="{ element: field }">
          <div :style="{ width: fieldWidth(field) }" class="relative self-start p-2">
            <div
              class="group relative min-h-[92px] cursor-move rounded-[var(--el-border-radius-base)] border p-4 transition"
              :class="
                activeId === field.id
                  ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary-light-9)]'
                  : 'border-transparent hover:bg-[var(--el-fill-color-light)]'
              "
              @click="emit('select', field)"
            >
              <div
                class="absolute right-2 top-2 z-10 flex items-center gap-1"
                :class="activeId === field.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
              >
                <el-tooltip content="复制" placement="top">
                  <el-button
                    v-if="!field.system"
                    link
                    size="small"
                    class="!m-0 !h-7 !w-7 !p-0"
                    @click.stop="emit('copy', field)"
                  >
                    <Copy :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
                <el-tooltip content="删除" placement="top">
                  <el-button
                    v-if="!field.system"
                    link
                    type="danger"
                    size="small"
                    class="!m-0 !h-7 !w-7 !p-0"
                    @click.stop="emit('remove', field)"
                  >
                    <Trash2 :size="15" :stroke-width="1.8" />
                  </el-button>
                </el-tooltip>
              </div>

              <div
                v-if="formProp.labelPos !== 'left'"
                class="mb-2 flex items-center gap-2 text-sm text-[var(--el-text-color-primary)]"
              >
                <GripVertical :size="14" class="text-[var(--el-text-color-placeholder)]" />
                <span>{{ field.label }}</span>
                <span v-if="field.required" class="text-[var(--el-color-danger)]">*</span>
                <el-tag v-if="field.hidden" size="small" type="warning">隐藏</el-tag>
              </div>

              <div
                :class="
                  formProp.labelPos === 'left'
                    ? 'grid grid-cols-[96px_minmax(0,1fr)] items-center gap-3'
                    : ''
                "
              >
                <span
                  v-if="formProp.labelPos === 'left'"
                  class="truncate text-sm text-[var(--el-text-color-regular)]"
                >
                  {{ field.label }}
                </span>

                <el-input
                  v-if="['text', 'phone', 'email', 'formula'].includes(field.type)"
                  :placeholder="field.config?.placeholder || '请输入'"
                  disabled
                />
                <el-input
                  v-else-if="field.type === 'textarea'"
                  type="textarea"
                  :rows="2"
                  :placeholder="field.config?.placeholder || '请输入'"
                  disabled
                />
                <el-input
                  v-else-if="['number', 'currency', 'percent'].includes(field.type)"
                  :placeholder="field.config?.placeholder || '请输入'"
                  disabled
                />
                <el-date-picker
                  v-else-if="['date', 'datetime'].includes(field.type)"
                  class="!w-full"
                  :type="field.type === 'date' ? 'date' : 'datetime'"
                  placeholder="请选择"
                  disabled
                />
                <el-select
                  v-else-if="
                    [
                      'select',
                      'multiselect',
                      'member',
                      'dept',
                      'data_source',
                      'data_source_multiple',
                    ].includes(field.type)
                  "
                  class="w-full"
                  placeholder="请选择"
                  disabled
                />
                <el-radio-group v-else-if="field.type === 'radio'" disabled>
                  <el-radio
                    v-for="option in field.options?.slice(0, 3) ?? []"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </el-radio>
                </el-radio-group>
                <el-checkbox-group v-else-if="field.type === 'checkbox'" disabled>
                  <el-checkbox
                    v-for="option in field.options?.slice(0, 3) ?? []"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </el-checkbox>
                </el-checkbox-group>
                <el-switch v-else-if="field.type === 'switch'" disabled />
                <div
                  v-else-if="field.type === 'sub_product'"
                  class="flex h-20 items-center justify-center rounded-[var(--el-border-radius-base)] border border-dashed border-[var(--el-border-color)] text-sm text-[var(--el-text-color-secondary)]"
                >
                  子表格
                </div>
                <el-button
                  v-else-if="['picture', 'attachment'].includes(field.type)"
                  disabled
                  class="!ml-0"
                >
                  {{ field.type === 'picture' ? '上传图片' : '上传附件' }}
                </el-button>
                <el-input v-else placeholder="请选择" disabled />
              </div>
            </div>
          </div>
        </template>
      </draggable>

      <div
        v-if="fields.length === 0"
        class="flex min-h-[360px] items-center justify-center border border-dashed border-[var(--el-border-color)] text-sm text-[var(--el-text-color-secondary)]"
      >
        从左侧选择或拖拽字段到这里
      </div>
    </div>
  </div>
</template>
