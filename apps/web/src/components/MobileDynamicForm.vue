<script setup lang="ts">
import type { DepartmentVO, FieldVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'

const props = defineProps<{
  fields: FieldVO[]
  members?: Array<{ id: string; name: string }>
  deptTree?: DepartmentVO[]
}>()
const model = defineModel<Record<string, unknown>>({ required: true })

const visibleFields = computed(() =>
  props.fields.filter((f) => !f.hidden && f.type !== 'formula'),
)

const pickerField = ref<FieldVO | null>(null)
const showPicker = ref(false)
const showDatePicker = ref(false)
const dateValue = ref<string[]>([])

const deptOptions = computed(() => {
  const result: Array<{ text: string; value: string }> = []
  const walk = (nodes: DepartmentVO[], depth = 0) => {
    for (const node of nodes) {
      result.push({ text: `${'　'.repeat(depth)}${node.name}`, value: node.id })
      if (node.children?.length) walk(node.children, depth + 1)
    }
  }
  walk(props.deptTree ?? [])
  return result
})

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
  if (field.type === 'multiselect' || field.type === 'checkbox') {
    const values = Array.isArray(value) ? value : []
    return values
      .map((item) => field.options?.find((o) => o.value === item)?.label ?? String(item))
      .join('、')
  }
  if (field.type === 'member') {
    return props.members?.find((item) => item.id === value)?.name ?? String(value)
  }
  if (field.type === 'dept') {
    return deptOptions.value.find((item) => item.value === value)?.text.trim() ?? String(value)
  }
  return String(value)
}

const pickerColumns = computed(() => {
  const field = pickerField.value
  if (!field) return []
  if (field.type === 'member') {
    return (props.members ?? []).map((item) => ({ text: item.name, value: item.id }))
  }
  if (field.type === 'dept') return deptOptions.value
  return field.options?.map((o) => ({ text: o.label, value: o.value })) ?? []
})

function datetimeLocalValue(field: FieldVO) {
  const value = model.value[field.key]
  if (typeof value !== 'string' || !value) return ''
  return value.replace(' ', 'T').slice(0, 16)
}

function updateDatetime(field: FieldVO, value: string) {
  model.value[field.key] = value ? `${value.replace('T', ' ')}:00` : undefined
}
</script>

<template>
  <van-cell-group inset>
    <template v-for="field in visibleFields" :key="field.key">
      <!-- 选项/日期类：只读点击唤起选择器 -->
      <van-field
        v-if="['select', 'radio', 'date', 'member', 'dept'].includes(field.type)"
        :model-value="displayValue(field)"
        :label="field.label"
        :placeholder="`请选择${field.label}`"
        :required="field.required"
        is-link
        readonly
        @click="openPicker(field)"
      />
      <!-- 日期时间 -->
      <van-field v-else-if="field.type === 'datetime'" :label="field.label" :required="field.required">
        <template #input>
          <input
            :value="datetimeLocalValue(field)"
            type="datetime-local"
            class="w-full bg-transparent"
            @input="updateDatetime(field, ($event.target as HTMLInputElement).value)"
          />
        </template>
      </van-field>
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
      <!-- 多选类 -->
      <van-field
        v-else-if="field.type === 'multiselect' || field.type === 'checkbox'"
        :label="field.label"
        :required="field.required"
      >
        <template #input>
          <van-checkbox-group
            :model-value="(model[field.key] as string[] | undefined) ?? []"
            direction="horizontal"
            @update:model-value="model[field.key] = $event"
          >
            <van-checkbox
              v-for="option in field.options ?? []"
              :key="option.value"
              :name="option.value"
              shape="square"
            >
              {{ option.label }}
            </van-checkbox>
          </van-checkbox-group>
        </template>
      </van-field>
      <van-field
        v-else
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
