<script setup lang="ts">
import { evaluateFormula, type ModuleFormProp } from '@micromatrix/shared'
import { Copy, GripVertical, Trash2 } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import DynamicFormItem from '@/components/form-engine/DynamicFormItem.vue'
import FormAlert from '@/components/form-engine/FormAlert.vue'
import SubTableFieldInput from '@/components/form-engine/SubTableFieldInput.vue'
import draggable from 'vuedraggable'
import type { ModuleFormFieldDraft } from './types'

const fields = defineModel<ModuleFormFieldDraft[]>({ required: true })

const props = defineProps<{
  activeId: string | null
  formProp: ModuleFormProp
}>()

// 控件复用业务表单的真实渲染实现，但不允许在设计器里录入/上传数据。
const previewValues = ref<Record<string, unknown>>({})
const canvasWidth = computed(
  () =>
    ({
      small: '640px',
      medium: '840px',
      large: '1080px',
    })[props.formProp.viewSize ?? 'small'],
)

function previewFormula(field: ModuleFormFieldDraft) {
  return field.type === 'formula' && field.config?.formula
    ? evaluateFormula(field.config.formula, previewValues.value)
    : null
}

const emit = defineEmits<{
  select: [field: ModuleFormFieldDraft]
  added: [field: ModuleFormFieldDraft]
  remove: [field: ModuleFormFieldDraft]
  copy: [field: ModuleFormFieldDraft]
}>()

function fieldWidth(field: ModuleFormFieldDraft) {
  return `${(Math.max(6, Math.min(24, field.span || 12)) / 24) * 100}%`
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

function canCopy(field: ModuleFormFieldDraft) {
  return field.capabilities?.copy ?? !field.system
}

function canDelete(field: ModuleFormFieldDraft) {
  return field.capabilities?.delete ?? !field.system
}
</script>

<template>
  <div class="h-full overflow-auto bg-[var(--el-fill-color-lighter)] p-4">
    <div
      class="module-form-canvas mx-auto min-h-full bg-[var(--el-bg-color)] p-6"
      :style="{
        width: canvasWidth,
        '--crm-form-label-color': formProp.labelStyle?.color ?? 'var(--el-text-color-regular)',
        '--crm-form-label-font-size': `${formProp.labelStyle?.fontSize ?? 14}px`,
        '--crm-form-label-font-weight': { normal: '400', medium: '500', semibold: '600' }[
          formProp.labelStyle?.fontWeight ?? 'normal'
        ],
      }"
      data-testid="module-form-preview"
    >
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
          <div
            :style="{ width: fieldWidth(field) }"
            class="canvas-field-slot relative self-start p-2"
          >
            <div
              class="group relative cursor-move rounded-[var(--el-border-radius-base)] border p-1 transition"
              :class="[
                activeId === field.id
                  ? 'border-[var(--el-color-primary)] bg-[var(--el-color-primary-light-9)]'
                  : 'border-transparent hover:bg-[var(--el-fill-color-light)]',
                field.hidden ? 'opacity-65' : '',
              ]"
              @click="emit('select', field)"
            >
              <div
                class="absolute right-2 top-2 z-10 flex items-center gap-1"
                :class="activeId === field.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
              >
                <el-tooltip content="复制" placement="top">
                  <el-button
                    v-if="canCopy(field)"
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
                    v-if="canDelete(field)"
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

              <FormAlert v-if="field.type === 'alert'" :field="field" class="mt-4" />
              <template v-else>
                <!-- 左右布局：拖拽手柄和字段来源放在独立的一行，不挤占标题及输入框宽度。 -->
                <div
                  v-if="formProp.labelPos === 'left'"
                  class="canvas-field-meta mb-2 flex min-w-0 flex-wrap items-center gap-1.5 pr-16"
                >
                  <GripVertical
                    :size="14"
                    class="shrink-0 text-[var(--el-text-color-placeholder)]"
                  />
                  <el-tag
                    v-if="field.origin === 'SYSTEM'"
                    size="small"
                    type="warning"
                    effect="plain"
                    >系统</el-tag
                  >
                  <el-tag
                    v-else-if="field.origin === 'PRESET'"
                    size="small"
                    type="success"
                    effect="plain"
                    >预设</el-tag
                  >
                  <el-tag v-if="field.hidden" size="small" type="warning">隐藏</el-tag>
                </div>
                <div
                  :class="
                    formProp.labelPos === 'left'
                      ? 'canvas-field-horizontal grid grid-cols-[72px_minmax(0,1fr)] items-center gap-3'
                      : ''
                  "
                >
                  <div
                    class="flex min-w-0 items-center gap-1.5 text-sm text-[var(--el-text-color-primary)]"
                    :class="[
                      formProp.labelPos !== 'left' ? 'mb-2' : '',
                      formProp.labelPos === 'left' && formProp.labelAlign === 'right'
                        ? 'justify-end'
                        : '',
                    ]"
                  >
                    <GripVertical
                      v-if="formProp.labelPos !== 'left'"
                      :size="14"
                      class="shrink-0 text-[var(--el-text-color-placeholder)]"
                    />
                    <span v-if="field.required" class="shrink-0 text-[var(--el-color-danger)]"
                      >*</span
                    >
                    <span class="truncate form-preview-label">{{ field.label }}</span>
                    <template v-if="formProp.labelPos !== 'left'">
                      <el-tag
                        v-if="field.origin === 'SYSTEM'"
                        size="small"
                        type="warning"
                        effect="plain"
                        >系统</el-tag
                      >
                      <el-tag
                        v-else-if="field.origin === 'PRESET'"
                        size="small"
                        type="success"
                        effect="plain"
                        >预设</el-tag
                      >
                      <el-tag v-if="field.hidden" size="small" type="warning">隐藏</el-tag>
                    </template>
                  </div>

                  <div
                    v-if="field.hidden"
                    class="rounded bg-[var(--el-fill-color-light)] p-2 text-xs text-[var(--el-text-color-secondary)]"
                  >
                    此字段在实际表单中隐藏，可选中后在右侧重新开启
                  </div>
                  <div v-else inert class="pointer-events-none min-w-0 select-none">
                    <SubTableFieldInput
                      v-if="field.type === 'sub_product'"
                      v-model="previewValues[field.key]"
                      :field="field"
                      :members="[]"
                      :dept-tree="[]"
                    />
                    <DynamicFormItem
                      v-else
                      v-model="previewValues[field.key]"
                      :field="field"
                      :members="[]"
                      :dept-tree="[]"
                      :form-fields="fields"
                      :form-values="previewValues"
                      :formula-value="previewFormula(field)"
                    />
                  </div>
                </div>
              </template>
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

<style scoped>
.canvas-field-slot {
  container-type: inline-size;
}

/* 窄字段卡片不强行挤压输入框；只影响设计器预览，不改变实际表单布局。 */
@container (max-width: 245px) {
  .canvas-field-horizontal {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
  }
}

.module-form-canvas .form-preview-label {
  color: var(--crm-form-label-color);
  font-size: var(--crm-form-label-font-size);
  font-weight: var(--crm-form-label-font-weight);
}
</style>
