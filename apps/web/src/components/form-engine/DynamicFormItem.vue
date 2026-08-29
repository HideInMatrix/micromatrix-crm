<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'
import type { MemberOption } from '@/api/system'
import PictureFieldInput from './PictureFieldInput.vue'

const props = defineProps<{
  field: FieldVO
  members: MemberOption[]
  deptTree: DepartmentVO[]
  /** formula 类型的实时计算结果 */
  formulaValue?: number | null
}>()

const model = defineModel<unknown>()

const placeholder = computed(
  () => props.field.config?.placeholder ?? `请输入${props.field.label}`,
)
const precision = computed(() =>
  props.field.config?.precision ?? (props.field.type === 'currency' ? 2 : 0),
)
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
    :model-value="(model as number | undefined)"
    :precision="precision"
    :min="field.config?.min"
    :max="field.config?.max"
    controls-position="right"
    class="!w-full"
    @update:model-value="model = $event ?? undefined"
  />
  <div v-else-if="field.type === 'percent'" class="flex items-center gap-2 w-full">
    <el-input-number
      :model-value="(model as number | undefined)"
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
    :model-value="(model as string | undefined)"
    type="date"
    value-format="YYYY-MM-DD"
    :placeholder="placeholder"
    class="!w-full"
    @update:model-value="model = $event"
  />
  <el-date-picker
    v-else-if="field.type === 'datetime'"
    :model-value="(model as string | undefined)"
    type="datetime"
    value-format="YYYY-MM-DD HH:mm:ss"
    :placeholder="placeholder"
    class="!w-full"
    @update:model-value="model = $event"
  />

  <!-- 选项类 -->
  <el-select
    v-else-if="field.type === 'select'"
    :model-value="(model as string | undefined)"
    :placeholder="placeholder"
    clearable
    filterable
    class="w-full"
    @update:model-value="model = $event"
  >
    <el-option
      v-for="opt in field.options ?? []"
      :key="opt.value"
      :label="opt.label"
      :value="opt.value"
    />
  </el-select>
  <el-select
    v-else-if="field.type === 'multiselect'"
    :model-value="(model as string[] | undefined) ?? []"
    multiple
    clearable
    filterable
    :placeholder="placeholder"
    class="w-full"
    @update:model-value="model = $event"
  >
    <el-option
      v-for="opt in field.options ?? []"
      :key="opt.value"
      :label="opt.label"
      :value="opt.value"
    />
  </el-select>
  <el-radio-group
    v-else-if="field.type === 'radio'"
    :model-value="(model as string | undefined)"
    @update:model-value="model = $event"
  >
    <el-radio v-for="opt in field.options ?? []" :key="opt.value" :value="opt.value">
      {{ opt.label }}
    </el-radio>
  </el-radio-group>
  <el-checkbox-group
    v-else-if="field.type === 'checkbox'"
    :model-value="(model as string[] | undefined) ?? []"
    @update:model-value="model = $event"
  >
    <el-checkbox v-for="opt in field.options ?? []" :key="opt.value" :value="opt.value">
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
    :model-value="(model as string[] | undefined) ?? []"
    :max="field.config?.uploadLimit ?? 10"
    :max-size-mb="field.config?.uploadSizeLimit ?? 20"
    @update:model-value="model = $event"
  />

  <!-- 引用类 -->
  <el-select
    v-else-if="field.type === 'member'"
    :model-value="(model as string | undefined)"
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
    :model-value="(model as string | undefined)"
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
  <el-input
    v-else-if="field.type === 'formula'"
    :model-value="formulaValue ?? '-'"
    disabled
  >
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
