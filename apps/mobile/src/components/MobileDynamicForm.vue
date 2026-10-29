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
import MobileCalendarPopup from './MobileCalendarPopup.vue'
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
  appearance?: 'default' | 'create'
}>()
const emit = defineEmits<{
  (event: 'search-select', field: FieldVO): void
}>()
const model = defineModel<Record<string, unknown>>({ required: true })

const runtime = computed(() => evaluateFormRuntime(props.fields, model.value))
const visibleFields = computed(() =>
  visibleMobileFormFields(props.fields, props.formProp, runtime.value.values, props.fieldFilter),
)
const createDesign = computed(() => props.appearance === 'create')
const visualAlerts = computed(() =>
  createDesign.value ? visibleFields.value.filter((field) => field.type === 'alert') : [],
)
// 视觉分组不决定字段内容：仍完全遵循表单配置与条件可见性，按原有顺序划分卡片。
const formSections = computed(() => {
  if (!createDesign.value) return [visibleFields.value]
  const first: FieldVO[] = []
  const rest: FieldVO[] = []
  let count = 0
  for (const field of visibleFields.value) {
    if (createDesign.value && field.type === 'alert') continue
    if (count < 5) first.push(field)
    else rest.push(field)
    if (field.type !== 'alert') count += 1
  }
  return [first, rest].filter((section) => section.length > 0)
})

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
const pickerSearch = ref('')
const multiSelection = ref<string[]>([])
const isMultiPicker = computed(() =>
  ['multiselect', 'checkbox'].includes(pickerField.value?.type ?? ''),
)
const dateValue = ref('')

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
  pickerSearch.value = ''
  multiSelection.value = Array.isArray(model.value[field.key])
    ? [...(model.value[field.key] as string[])]
    : []
  if (field.type === 'date') {
    dateValue.value = (model.value[field.key] as string | undefined) ?? ''
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

function onDateConfirm(value: string) {
  if (pickerField.value) model.value[pickerField.value.key] = value
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

const filteredPickerColumns = computed(() => {
  const keyword = pickerSearch.value.trim().toLocaleLowerCase()
  if (!keyword) return pickerColumns.value
  return pickerColumns.value.filter((option) => option.text.toLocaleLowerCase().includes(keyword))
})
function pickOption(value: string) {
  if (!pickerField.value) return
  if (isMultiPicker.value) {
    multiSelection.value = multiSelection.value.includes(value)
      ? multiSelection.value.filter((item) => item !== value)
      : [...multiSelection.value, value]
    return
  }
  model.value[pickerField.value.key] = value
  showPicker.value = false
}
function confirmMultiSelection() {
  if (!pickerField.value || !isMultiPicker.value) return
  model.value[pickerField.value.key] = [...multiSelection.value]
  showPicker.value = false
}
function isPickerSelected(value: string) {
  return isMultiPicker.value
    ? multiSelection.value.includes(value)
    : model.value[pickerField.value?.key ?? ''] === value
}

const searchablePicker = computed(() =>
  pickerField.value ? ['member', 'dept'].includes(pickerField.value.type) : false,
)

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
  <template v-else>
    <div
      v-for="alert in visualAlerts"
      :key="alert.id"
      role="note"
      class="mb-[12px] flex items-center gap-[5px] bg-[color-mix(in_srgb,var(--van-primary-color)_9%,white)] px-[12px] py-[8px] text-[12px] leading-[12px] text-[var(--van-primary-color)]"
    >
      <van-icon name="info-o" :size="10" class="shrink-0" aria-hidden="true" />
      <span class="whitespace-pre-wrap">{{ alert.config?.alertText }}</span>
    </div>
    <van-cell-group
      v-for="(section, index) in formSections"
      :key="index"
      :inset="!createDesign"
      :class="
        createDesign
          ? [
              'mobile-create-section mx-[12px] overflow-hidden rounded-[8px] bg-white',
              index > 0 ? 'mt-[12px]' : '',
            ]
          : '!mx-4 overflow-hidden rounded-[6px] border border-[var(--text-n8)] bg-[var(--text-n10)] [&_.van-cell]:!px-4 [&_.van-cell]:!py-3 [&_.van-field__control]:!text-[#000000] [&_.van-field__label]:!w-[84px] [&_.van-field__label]:text-[var(--text-n2)]'
      "
      :style="
        createDesign
          ? {
              '--van-cell-vertical-padding': '14px',
              '--van-cell-horizontal-padding': '12px',
              '--van-cell-font-size': '15px',
              '--van-cell-line-height': '20px',
              '--van-cell-background': '#ffffff',
              '--van-cell-border-color': '#F0F0F0',
              '--van-field-label-width': 'auto',
              '--van-field-label-margin-right': '12px',
              '--van-field-placeholder-text-color': '#BFC5D0',
              '--van-field-icon-size': '16px',
              '--van-field-required-mark-color': 'var(--van-danger-color)',
            }
          : undefined
      "
    >
      <template v-for="field in section" :key="field.key">
        <MobileFormAlert v-if="field.type === 'alert'" :field="field" />
        <van-field
          v-else-if="field.type === 'formula'"
          :input-align="createDesign ? 'right' : 'left'"
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
          :input-align="createDesign ? 'right' : 'left'"
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
          :input-align="createDesign ? 'right' : 'left'"
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
          :input-align="createDesign ? 'right' : 'left'"
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
          :input-align="createDesign ? 'right' : 'left'"
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
          :label-align="createDesign ? 'top' : 'left'"
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
        <!-- 新建模式的多选使用底部选项弹窗，不在表单中铺开复选框。 -->
        <van-field
          v-else-if="createDesign && ['multiselect', 'checkbox'].includes(field.type)"
          :model-value="displayValue(field)"
          :name="field.key"
          :rules="fieldRules(field)"
          :label="field.label"
          :placeholder="`请选择${field.label}`"
          :required="field.required"
          input-align="right"
          is-link
          readonly
          @click="openPicker(field)"
        />
        <!-- 多选类 -->
        <van-field
          v-else-if="field.type === 'multiselect' || field.type === 'checkbox'"
          :model-value="displayValue(field)"
          :name="field.key"
          :rules="fieldRules(field)"
          :label="field.label"
          :required="field.required"
          :input-align="createDesign ? 'right' : 'left'"
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
          :input-align="createDesign ? 'right' : 'left'"
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
          :input-align="createDesign ? 'right' : 'left'"
          :label="field.label"
          :placeholder="`请输入${field.label}`"
          :required="field.required"
          @update:model-value="model[field.key] = $event"
        />
      </template>
    </van-cell-group>
  </template>

  <van-popup v-model:show="showPicker" position="bottom" round safe-area-inset-bottom>
    <template v-if="createDesign">
      <div class="relative flex h-[50px] items-center justify-center rounded-t-[12px] bg-[#F5F5F5]">
        <span class="text-[16px] font-semibold text-[#000000]">{{ pickerField?.label }}</span>
        <van-button
          class="!absolute right-[12px] !border-0 !bg-transparent !text-[14px] !text-[#666666]"
          @click="showPicker = false"
          >取消</van-button
        >
      </div>
      <div class="max-h-[55vh] overflow-y-auto bg-white p-[12px]">
        <van-search
          v-if="searchablePicker"
          v-model="pickerSearch"
          shape="round"
          :placeholder="`搜索${pickerField?.label}`"
          class="!p-0"
        />
        <div
          v-if="!searchablePicker"
          :class="[
            'grid gap-[10px]',
            filteredPickerColumns.length <= 2 ? 'grid-cols-2' : 'grid-cols-3',
          ]"
          style="
            --van-button-small-height: 36px;
            --van-button-small-padding: 0;
            --van-button-small-font-size: 14px;
            --van-button-radius: 6px;
            --van-button-border-width: 1px;
            --van-button-default-background: #f3f4f8;
            --van-button-default-border-color: transparent;
            --van-button-primary-color: var(--van-primary-color);
            --van-button-primary-background: color-mix(
              in srgb,
              var(--van-primary-color) 10%,
              white
            );
            --van-button-primary-border-color: var(--van-primary-color);
          "
        >
          <van-button
            v-for="option in filteredPickerColumns"
            :key="option.value"
            size="small"
            :type="isPickerSelected(option.value) ? 'primary' : 'default'"
            class="min-w-0"
            @click="pickOption(option.value)"
            >{{ option.text }}</van-button
          >
        </div>
        <template v-else>
          <van-cell
            v-for="option in filteredPickerColumns"
            :key="option.value"
            :title="option.text"
            clickable
            class="!px-0"
            :title-class="
              model[pickerField?.key ?? ''] === option.value
                ? 'text-[var(--van-primary-color)]'
                : ''
            "
            @click="pickOption(option.value)"
          >
            <template #right-icon
              ><van-icon
                v-if="isPickerSelected(option.value)"
                name="success"
                color="var(--van-primary-color)"
            /></template>
          </van-cell>
        </template>
        <van-empty v-if="!filteredPickerColumns.length" description="暂无选项" image-size="64" />
      </div>
      <div
        v-if="isMultiPicker"
        class="border-t border-[#F0F0F0] bg-white px-[12px] pt-[10px] pb-[calc(10px+env(safe-area-inset-bottom))]"
        style="--van-button-default-height: 44px; --van-button-border-radius: 8px"
      >
        <van-button type="primary" block @click="confirmMultiSelection">
          确定{{ multiSelection.length ? `（${multiSelection.length}）` : '' }}
        </van-button>
      </div>
    </template>
    <van-picker
      v-else
      :columns="pickerColumns"
      @confirm="onPickerConfirm"
      @cancel="showPicker = false"
    />
  </van-popup>
  <MobileCalendarPopup
    v-model:show="showDatePicker"
    :label="pickerField?.label ?? '选择日期'"
    :value="dateValue"
    @confirm="onDateConfirm"
  />
</template>
