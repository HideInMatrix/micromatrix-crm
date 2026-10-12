<script setup lang="ts">
import {
  evaluateFormula,
  evaluateFormRuntime,
  supportsMobileSearchSelect,
  type ModuleFormProp,
  type DepartmentVO,
  type FieldVO,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import MobileDataSourceFieldInput from './MobileDataSourceFieldInput.vue'
import MobileFormAlert from './MobileFormAlert.vue'
import MobileSubTableField from './MobileSubTableField.vue'
import { visibleMobileFormFields } from '@/utils/mobile-form-fields'
import MobileSearchPageSelectField from './MobileSearchPageSelectField.vue'
import MobileVantDateTimeField from './MobileVantDateTimeField.vue'

const props = defineProps<{
  fields: FieldVO[]
  formProp?: ModuleFormProp
  members?: Array<{ id: string; name: string }>
  deptTree?: DepartmentVO[]
  fieldFilter?: (field: FieldVO) => boolean
}>()
const emit = defineEmits<{
  (event: 'search-select', field: FieldVO): void
}>()
const model = defineModel<Record<string, unknown>>({ required: true })

const runtime = computed(() => evaluateFormRuntime(props.fields, model.value))
const visibleFields = computed(() =>
  visibleMobileFormFields(props.fields, props.formProp, runtime.value.values, props.fieldFilter),
)

watch(
  () => runtime.value.values,
  (values) => {
    if (
      Object.entries(values).some(
        ([key, value]) => JSON.stringify(model.value[key]) !== JSON.stringify(value),
      )
    ) {
      model.value = { ...model.value, ...values }
    }
  },
  { immediate: true, deep: true },
)

function formulaDisplayValue(field: FieldVO): string {
  if (!field.config?.formula) return '-'
  const result = evaluateFormula(field.config.formula, model.value)
  if (result === null) return '-'
  return field.config.precision !== undefined
    ? result.toFixed(field.config.precision)
    : String(result)
}

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

function usesSearchPage(field: FieldVO) {
  return supportsMobileSearchSelect(field.type) && field.config?.mobileSelectMode === 'searchPage'
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

function setFieldValue(field: FieldVO, value: unknown) {
  model.value[field.key] = value
}

function isDataSourceField(field: FieldVO) {
  return ['data_source', 'data_source_multiple'].includes(field.type)
}

function dataSourceValue(field: FieldVO): string | string[] | undefined {
  return model.value[field.key] as string | string[] | undefined
}

function searchPageValue(field: FieldVO): string | string[] | undefined {
  return model.value[field.key] as string | string[] | undefined
}

function fieldRules(field: FieldVO) {
  if (!field.required) return []
  return [{ required: true, message: `请填写${field.label}` }]
}

function textInputType(field: FieldVO) {
  if (field.type === 'phone') return 'tel'
  if (field.type === 'email') return 'email'
  return 'text'
}
</script>

<template>
  <van-empty
    v-if="visibleFields.length === 0"
    image-size="64"
    description="当前没有可在移动端显示的字段"
    class="!py-10"
  />
  <van-cell-group
    v-else
    inset
    class="!mx-4 overflow-hidden rounded-[6px] border border-[var(--text-n8)] bg-[var(--text-n10)] [&_.van-cell]:!px-4 [&_.van-cell]:!py-3 [&_.van-field__control]:text-[var(--text-n1)] [&_.van-field__label]:!w-[84px] [&_.van-field__label]:text-[var(--text-n2)]"
  >
    <template v-for="field in visibleFields" :key="field.key">
      <MobileFormAlert v-if="field.type === 'alert'" :field="field" />
      <van-field
        v-else-if="field.type === 'formula'"
        :label="field.label"
        :model-value="formulaDisplayValue(field)"
        readonly
      />
      <MobileSubTableField
        v-else-if="field.type === 'sub_product'"
        v-model="model[field.key]"
        :field="field"
        :members="members"
        :dept-tree="deptTree"
      />
      <slot
        v-else-if="field.key === 'customerId' && $slots['customer-field']"
        name="customer-field"
        :field="field"
        :value="model[field.key]"
        :set-value="(value: unknown) => setFieldValue(field, value)"
      />
      <slot
        v-else-if="field.system && $slots['system-field']"
        name="system-field"
        :field="field"
        :value="model[field.key]"
        :set-value="(value: unknown) => setFieldValue(field, value)"
      />
      <MobileSearchPageSelectField
        v-else-if="usesSearchPage(field)"
        :field="field"
        :model-value="searchPageValue(field)"
        :members="members"
        :dept-tree="deptTree"
        :name="field.key"
        :rules="fieldRules(field)"
        @open="emit('search-select', field)"
        @update:model-value="model[field.key] = $event"
      />
      <!-- 选项/日期类：只读点击唤起选择器 -->
      <van-field
        v-else-if="['select', 'radio', 'date', 'member', 'dept'].includes(field.type)"
        :model-value="displayValue(field)"
        :name="field.key"
        :rules="fieldRules(field)"
        :label="field.label"
        :placeholder="`请选择${field.label}`"
        :required="field.required"
        is-link
        readonly
        @click="openPicker(field)"
      />
      <!-- 日期时间 -->
      <MobileVantDateTimeField
        v-else-if="field.type === 'datetime'"
        :model-value="(model[field.key] as string | undefined) ?? ''"
        :name="field.key"
        :rules="fieldRules(field)"
        format="space"
        :label="field.label"
        :required="field.required"
        @update:model-value="model[field.key] = $event || undefined"
      />
      <!-- 数字类 -->
      <van-field
        v-else-if="['number', 'currency', 'percent'].includes(field.type)"
        :model-value="(model[field.key] as string) ?? ''"
        :name="field.key"
        :rules="fieldRules(field)"
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
        :name="field.key"
        :rules="fieldRules(field)"
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
        :model-value="displayValue(field)"
        :name="field.key"
        :rules="fieldRules(field)"
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
      <MobileDataSourceFieldInput
        v-else-if="isDataSourceField(field)"
        :field="field"
        :model-value="dataSourceValue(field)"
        :name="field.key"
        :rules="fieldRules(field)"
        @update:model-value="model[field.key] = $event"
      />
      <van-field
        v-else
        :model-value="(model[field.key] as string) ?? ''"
        :name="field.key"
        :rules="fieldRules(field)"
        :type="textInputType(field)"
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
    <van-date-picker
      v-model="dateValue"
      @confirm="onDateConfirm"
      @cancel="showDatePicker = false"
    />
  </van-popup>
</template>
