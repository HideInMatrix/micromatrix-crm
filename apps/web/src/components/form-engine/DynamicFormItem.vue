<script setup lang="ts">
import type { AttachmentVO, DataSourceRecordVO, DepartmentVO, FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'
import type { MemberOption } from '@/api/system'
import AttachmentFieldInput from './AttachmentFieldInput.vue'
import DataSourceFieldInput from './DataSourceFieldInput.vue'
import LocationFieldInput from './LocationFieldInput.vue'
import PictureFieldInput from './PictureFieldInput.vue'

const props = defineProps<{
  field: FieldVO
  members: MemberOption[]
  deptTree: DepartmentVO[]
  optionRange?: string[]
  formFields?: FieldVO[]
  formValues?: Record<string, unknown>
  attachmentOptions?: AttachmentVO[]
  attachmentDownload?: (file: AttachmentVO) => Promise<void>
  /** formula 类型的实时计算结果 */
  formulaValue?: number | null
}>()

const emit = defineEmits<{
  dataSourceRecord: [record: DataSourceRecordVO | null]
}>()

const model = defineModel<unknown>()

const placeholder = computed(() => props.field.config?.placeholder ?? `请输入${props.field.label}`)
const precision = computed(
  () => props.field.config?.precision ?? (props.field.type === 'currency' ? 2 : 0),
)
const stringValue = computed(() => (typeof model.value === 'string' ? model.value : undefined))
const numberValue = computed(() => (typeof model.value === 'number' ? model.value : undefined))
const stringArrayValue = computed(() =>
  Array.isArray(model.value)
    ? model.value.filter((item): item is string => typeof item === 'string')
    : [],
)
const fieldOptions = computed(() => {
  const options = props.field.options ?? []
  if (!props.optionRange) return options
  const range = new Set(props.optionRange)
  return options.filter((option) => range.has(option.value))
})
</script>

<template>
  <!-- 文本类 -->
  <el-input
    v-if="field.type === 'text' || field.type === 'phone' || field.type === 'email'"
    :model-value="(model as string) ?? ''"
    :placeholder="placeholder"
    clearable
    @update:model-value="model = $event"
  />
  <el-input
    v-else-if="field.type === 'textarea'"
    :model-value="(model as string) ?? ''"
    type="textarea"
    :rows="3"
    :placeholder="placeholder"
    @update:model-value="model = $event"
  />

  <!-- 数字类 -->
  <el-input-number
    v-else-if="field.type === 'number' || field.type === 'currency'"
    :model-value="numberValue"
    :precision="precision"
    :min="field.config?.min"
    :max="field.config?.max"
    controls-position="right"
    class="!w-full"
    @update:model-value="model = $event ?? undefined"
  />
  <div v-else-if="field.type === 'percent'" class="flex items-center gap-2 w-full">
    <el-input-number
      :model-value="numberValue"
      :precision="precision"
      :min="field.config?.min ?? 0"
      :max="field.config?.max ?? 100"
      controls-position="right"
      class="flex-1"
      @update:model-value="model = $event ?? undefined"
    />
    <span class="text-[var(--el-text-color-secondary)]">%</span>
  </div>

  <!-- 日期类 -->
  <el-date-picker
    v-else-if="field.type === 'date'"
    :model-value="stringValue"
    type="date"
    value-format="YYYY-MM-DD"
    :placeholder="placeholder"
    class="!w-full"
    @update:model-value="model = $event"
  />
  <el-date-picker
    v-else-if="field.type === 'datetime'"
    :model-value="stringValue"
    type="datetime"
    value-format="YYYY-MM-DD HH:mm:ss"
    :placeholder="placeholder"
    class="!w-full"
    @update:model-value="model = $event"
  />

  <!-- 选项类 -->
  <el-select
    v-else-if="field.type === 'select'"
    :model-value="stringValue"
    :placeholder="placeholder"
    clearable
    filterable
    class="w-full"
    @update:model-value="model = $event"
  >
    <el-option v-for="opt in fieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
  </el-select>
  <el-select
    v-else-if="field.type === 'multiselect'"
    :model-value="stringArrayValue"
    multiple
    clearable
    filterable
    :placeholder="placeholder"
    class="w-full"
    @update:model-value="model = $event"
  >
    <el-option v-for="opt in fieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
  </el-select>
  <el-radio-group
    v-else-if="field.type === 'radio'"
    :model-value="stringValue"
    @update:model-value="model = $event"
  >
    <el-radio v-for="opt in fieldOptions" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </el-radio>
  </el-radio-group>
  <el-checkbox-group
    v-else-if="field.type === 'checkbox'"
    :model-value="stringArrayValue"
    @update:model-value="model = $event"
  >
    <el-checkbox v-for="opt in fieldOptions" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </el-checkbox>
  </el-checkbox-group>
  <el-switch
    v-else-if="field.type === 'switch'"
    :model-value="Boolean(model)"
    @update:model-value="model = $event"
  />

  <PictureFieldInput
    v-else-if="field.type === 'picture'"
    :model-value="stringArrayValue"
    :max="field.config?.uploadLimit ?? 10"
    :max-size-mb="field.config?.uploadSizeLimit ?? 20"
    @update:model-value="model = $event"
  />

  <LocationFieldInput
    v-else-if="field.type === 'location'"
    :model-value="stringValue ?? ''"
    :scope="field.config?.scope ?? 'ALL'"
    :location-type="field.config?.locationType ?? 'PCD'"
    :placeholder="placeholder"
    @update:model-value="model = $event"
  />

  <AttachmentFieldInput
    v-else-if="field.type === 'attachment'"
    :model-value="stringArrayValue"
    :initial-options="attachmentOptions ?? []"
    :only-one="field.config?.onlyOne ?? false"
    :accept="field.config?.accept ?? ''"
    :limit-size="field.config?.limitSize ?? ''"
    :download="attachmentDownload"
    @update:model-value="model = $event"
  />

  <DataSourceFieldInput
    v-else-if="field.type === 'data_source' || field.type === 'data_source_multiple'"
    :model-value="field.type === 'data_source_multiple' ? stringArrayValue : stringValue"
    :source-type="field.config?.dataSourceType ?? 'CUSTOMER'"
    :multiple="field.type === 'data_source_multiple'"
    :field="field"
    :form-fields="formFields"
    :form-values="formValues"
    :placeholder="`请选择${field.label}`"
    @record="emit('dataSourceRecord', $event)"
    @update:model-value="model = $event"
  />

  <!-- 引用类 -->
  <el-select
    v-else-if="field.type === 'member'"
    :model-value="stringValue"
    clearable
    filterable
    placeholder="选择成员"
    class="w-full"
    @update:model-value="model = $event"
  >
    <el-option v-for="m in members" :key="m.id" :label="m.name" :value="m.id" />
  </el-select>
  <el-tree-select
    v-else-if="field.type === 'dept'"
    :model-value="stringValue"
    :data="deptTree"
    :props="{ label: 'name', children: 'children' }"
    node-key="id"
    check-strictly
    clearable
    placeholder="选择部门"
    class="w-full"
    @update:model-value="model = $event"
  />

  <!-- 计算字段（只读） -->
  <el-input v-else-if="field.type === 'formula'" :model-value="formulaValue ?? '-'" disabled>
    <template #suffix>
      <el-tooltip :content="`公式：${field.config?.formula ?? ''}`">
        <span class="text-xs">fx</span>
      </el-tooltip>
    </template>
  </el-input>

  <el-input
    v-else
    :model-value="(model as string) ?? ''"
    :placeholder="placeholder"
    @update:model-value="model = $event"
  />
</template>
