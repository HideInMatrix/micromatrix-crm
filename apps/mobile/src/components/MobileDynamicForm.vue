<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'

const props = defineProps<{ fields: FieldVO[] }>()
const model = defineModel<Record<string, unknown>>({ required: true })

const visibleFields = computed(() =>
  props.fields.filter((f) => !f.hidden && f.type !== 'formula'),
)

const pickerField = ref<FieldVO | null>(null)
const showPicker = ref(false)
const showDatePicker = ref(false)
const dateValue = ref<string[]>([])

function openPicker(field: FieldVO) {
  pickerField.value = field
  if (field.type === 'date') {
    const current = (model.value[field.key] as string) || new Date().toISOString().slice(0, 10)
    dateValue.value = current.split('-')
    showDatePicker.value = true
  } else {
    showPicker.value = true
  }
}

function onPickerConfirm({ selectedValues }: { selectedValues: string[] }) {
  if (pickerField.value) model.value[pickerField.value.key] = selectedValues[0]
  showPicker.value = false
}

function onDateConfirm({ selectedValues }: { selectedValues: string[] }) {
  if (pickerField.value) model.value[pickerField.value.key] = selectedValues.join('-')
  showDatePicker.value = false
}

function displayValue(field: FieldVO): string {
  const value = model.value[field.key]
  if (value === undefined || value === null || value === '') return ''
  if (field.type === 'select' || field.type === 'radio') {
    return field.options?.find((o) => o.value === value)?.label ?? String(value)
  }
  return String(value)
}

const pickerColumns = computed(
  () => pickerField.value?.options?.map((o) => ({ text: o.label, value: o.value })) ?? [],
)
</script>

<template>
  <van-cell-group inset>
    <template v-for="field in visibleFields" :key="field.key">
      <!-- 选项/日期类：只读点击唤起选择器 -->
      <van-field
        v-if="['select', 'radio', 'date'].includes(field.type)"
        :model-value="displayValue(field)"
        :label="field.label"
        :placeholder="`请选择${field.label}`"
        :required="field.required"
        is-link
        readonly
        @click="openPicker(field)"
      />
      <!-- 数字类 -->
      <van-field
        v-else-if="['number', 'currency', 'percent'].includes(field.type)"
        :model-value="(model[field.key] as string) ?? ''"
        type="number"
        :label="field.label"
        :placeholder="`请输入${field.label}`"
        :required="field.required"
        @update:model-value="model[field.key] = $event === '' ? undefined : Number($event)"
      />
      <!-- 多行文本 -->
      <van-field
        v-else-if="field.type === 'textarea'"
        :model-value="(model[field.key] as string) ?? ''"
        type="textarea"
        rows="2"
        autosize
        :label="field.label"
        :placeholder="`请输入${field.label}`"
        :required="field.required"
        @update:model-value="model[field.key] = $event"
      />
      <!-- 开关 -->
      <van-cell v-else-if="field.type === 'switch'" :title="field.label" center>
        <template #right-icon>
          <van-switch
            :model-value="Boolean(model[field.key])"
            size="20"
            @update:model-value="model[field.key] = $event"
          />
        </template>
      </van-cell>
      <!-- 成员/部门等复杂类型移动端暂不支持编辑，跳过 -->
      <van-field
        v-else-if="!['member', 'dept', 'multiselect', 'checkbox', 'datetime'].includes(field.type)"
        :model-value="(model[field.key] as string) ?? ''"
        :label="field.label"
        :placeholder="`请输入${field.label}`"
        :required="field.required"
        @update:model-value="model[field.key] = $event"
      />
    </template>
  </van-cell-group>

  <van-popup v-model:show="showPicker" position="bottom" round>
    <van-picker :columns="pickerColumns" @confirm="onPickerConfirm" @cancel="showPicker = false" />
  </van-popup>
  <van-popup v-model:show="showDatePicker" position="bottom" round>
    <van-date-picker v-model="dateValue" @confirm="onDateConfirm" @cancel="showDatePicker = false" />
  </van-popup>
</template>
