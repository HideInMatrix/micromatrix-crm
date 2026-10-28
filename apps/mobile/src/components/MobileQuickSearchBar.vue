<script setup lang="ts">
import type {
  FieldVO,
  FilterCondition,
  ModuleQuickSearchConfig,
  QuickSearchItem,
  QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { buildQuickSearchPayload } from '@micromatrix/frontend-shared'
import type { DropdownMenuInstance, TimePickerColumnType } from 'vant'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{
  fields: FieldVO[]
  config: ModuleQuickSearchConfig | null
  stages?: Array<{ key: string; name: string; enabled?: boolean }>
}>()
const emit = defineEmits<{ search: [] }>()
const keyword = defineModel<string>('keyword', { default: '' })
const filters = defineModel<FilterCondition[]>('filters', { required: true })
const quickGroups = defineModel<QuickSearchQueryGroup[]>('quickGroups', { required: true })
const dropdownMenu = ref<DropdownMenuInstance | null>(null)
const values = reactive<Record<string, string>>({})
const fieldMap = computed(
  () => new Map(props.fields.filter((field) => !field.hidden).map((field) => [field.key, field])),
)
const visibleItems = computed(() =>
  props.config?.enabled
    ? props.config.items.filter(
        (item) => item.kind === 'preset_select' || fieldMap.value.has(item.fieldKey ?? ''),
      )
    : [],
)
const selectItems = computed(() => visibleItems.value.filter(isDropdownItem))
const inputItems = computed(() => visibleItems.value.filter(isInputItem))
const dateItems = computed(() => visibleItems.value.filter(isDateItem))
const dateTarget = ref<QuickSearchItem | null>(null)
const datePickerValues = ref<string[]>([])
const timePickerValues = ref<string[]>(['00', '00'])
const datePickerStep = ref<'date' | 'time'>('date')

function fieldOf(item: QuickSearchItem) {
  return fieldMap.value.get(item.fieldKey ?? '')
}
function isDropdownItem(item: QuickSearchItem) {
  return item.kind === 'preset_select' || ['select', 'radio'].includes(fieldOf(item)?.type ?? '')
}
function isDateItem(item: QuickSearchItem) {
  return item.kind === 'field' && ['date', 'datetime'].includes(fieldOf(item)?.type ?? '')
}
function isInputItem(item: QuickSearchItem) {
  return item.kind === 'field' && !isDropdownItem(item) && !isDateItem(item)
}
function choices(item: QuickSearchItem) {
  if (item.fieldKey === 'status' && props.stages?.length) {
    return props.stages
      .filter((stage) => stage.enabled !== false)
      .map((stage) => ({ label: stage.name, value: stage.key }))
  }
  if (item.kind === 'preset_select') {
    return (item.options ?? []).map((option) => ({ label: option.label, value: option.id }))
  }
  return (fieldOf(item)?.options ?? []).map((option) => ({
    label: option.label,
    value: option.value,
  }))
}
function orderedChoices(item: QuickSearchItem) {
  const list = choices(item)
  const selected = values[item.id]
  if (!selected) return list
  return [
    ...list.filter((option) => option.value === selected),
    ...list.filter((option) => option.value !== selected),
  ]
}
function displayLabel(item: QuickSearchItem) {
  return choices(item).find((option) => option.value === values[item.id])?.label ?? item.label
}
function search() {
  if (props.config?.enabled) {
    const payload = buildQuickSearchPayload(props.config, props.fields, values)
    filters.value = payload.filters
    quickGroups.value = payload.quickGroups
  }
  emit('search')
}
function selectOption(item: QuickSearchItem, value: string) {
  // 重复选择当前选项即清空筛选，保持蓝湖三列选项布局。
  values[item.id] = values[item.id] === value ? '' : value
  dropdownMenu.value?.close()
  search()
}
function clearDate(item: QuickSearchItem) {
  values[item.id] = ''
  search()
}
function openDate(item: QuickSearchItem) {
  dateTarget.value = item
  const existing = values[item.id] || ''
  const today = new Date()
  const date = /^\d{4}-\d{2}-\d{2}/.test(existing)
    ? existing.slice(0, 10)
    : `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  datePickerValues.value = date.split('-')
  timePickerValues.value = /^\d{2}:\d{2}/.test(existing.slice(11))
    ? [...existing.slice(11).split(':'), '00'].slice(0, 2)
    : ['00', '00']
  datePickerStep.value = 'date'
}
function confirmDate({ selectedValues }: { selectedValues: string[] }) {
  datePickerValues.value = selectedValues
  if (!dateTarget.value) return
  if (
    fieldOf(dateTarget.value)?.type === 'datetime' &&
    fieldOf(dateTarget.value)?.config?.datetimePrecision !== 'day'
  ) {
    datePickerStep.value = 'time'
  } else {
    values[dateTarget.value.id] = selectedValues.join('-')
    dateTarget.value = null
    search()
  }
}
function confirmTime({ selectedValues }: { selectedValues: string[] }) {
  if (!dateTarget.value) return
  const [hour = '00', minute = '00', second = '00'] = selectedValues
  values[dateTarget.value.id] = `${datePickerValues.value.join('-')} ${hour}:${minute}:${second}`
  dateTarget.value = null
  search()
}
const timeColumns: TimePickerColumnType[] = ['hour', 'minute']
</script>

<template>
  <div
    v-if="visibleItems.length || $slots['search-prefix']"
    class="relative shrink-0 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.07)]"
  >
    <div
      v-if="$slots['search-prefix']"
      class="flex h-[40px] items-start gap-[12px] px-[12px] pt-[8px]"
    >
      <div class="h-[32px] w-[92px] shrink-0">
        <slot name="search-prefix" />
      </div>
      <div class="h-[32px] min-w-0 flex-1">
        <van-search
          v-if="inputItems[0]"
          v-model="values[inputItems[0].id]"
          shape="round"
          :placeholder="inputItems[0].placeholder || `搜索${inputItems[0].label}`"
          style="
            --van-search-padding: 0;
            --van-search-background: transparent;
            --van-search-input-height: 32px;
            --van-search-content-background: #f3f4f8;
            --van-field-icon-size: 12px;
            --van-field-placeholder-text-color: #c0c4cc;
            --van-search-left-icon-color: #8e8e93;
            --van-cell-font-size: 12px;
            --van-cell-line-height: 16px;
            --van-padding-sm: 9px;
          "
          @search="search"
          @clear="search"
        />
        <van-search
          v-else
          v-model="keyword"
          shape="round"
          placeholder="搜索学生姓名或手机号"
          style="
            --van-search-padding: 0;
            --van-search-background: transparent;
            --van-search-input-height: 32px;
            --van-search-content-background: #f3f4f8;
            --van-field-icon-size: 12px;
            --van-field-placeholder-text-color: #c0c4cc;
            --van-search-left-icon-color: #8e8e93;
            --van-cell-font-size: 12px;
            --van-cell-line-height: 16px;
            --van-padding-sm: 9px;
          "
          @search="search"
          @clear="search"
        />
      </div>
    </div>
    <div
      v-for="item in $slots['search-prefix'] ? inputItems.slice(1) : inputItems"
      :key="item.id"
      class="h-[40px] px-[12px] pt-[8px]"
    >
      <van-search
        v-model="values[item.id]"
        shape="round"
        :placeholder="item.placeholder || `搜索${item.label}`"
        style="
          --van-search-padding: 0;
          --van-search-background: transparent;
          --van-search-input-height: 32px;
          --van-search-content-background: #f3f4f8;
          --van-field-icon-size: 12px;
          --van-field-placeholder-text-color: #c0c4cc;
          --van-search-left-icon-color: #8e8e93;
          --van-cell-font-size: 12px;
          --van-cell-line-height: 16px;
          --van-padding-sm: 9px;
        "
        @search="search"
        @clear="search"
      />
    </div>
    <div v-for="item in dateItems" :key="item.id" class="px-[12px] pt-[8px]">
      <van-cell
        :title="item.label"
        :value="values[item.id] || item.placeholder || '选择日期'"
        is-link
        clickable
        class="!rounded-[16px] !bg-[#F3F4F8]"
        @click="openDate(item)"
      />
      <van-button
        v-if="values[item.id]"
        size="mini"
        plain
        class="!my-[4px]"
        @click="clearDate(item)"
        >清除日期</van-button
      >
    </div>
    <van-dropdown-menu
      v-if="selectItems.length"
      ref="dropdownMenu"
      :z-index="1001"
      active-color="var(--van-primary-color)"
      class="[&_.van-dropdown-item__content]:rounded-b-[12px]"
      style="
        --van-dropdown-menu-height: 32px;
        --van-dropdown-menu-background: #ffffff;
        --van-dropdown-menu-shadow: none;
        --van-dropdown-menu-title-font-size: 12px;
        --van-dropdown-menu-title-text-color: #333333;
        --van-dropdown-menu-title-active-text-color: var(--van-primary-color);
        --van-dropdown-menu-title-padding: 0 4px;
        --van-dropdown-menu-title-line-height: 16px;
        --van-dropdown-menu-content-max-height: 55vh;
      "
    >
      <van-dropdown-item
        v-for="item in selectItems"
        :key="item.id"
        :title="displayLabel(item)"
        :title-class="values[item.id] ? 'text-[var(--van-primary-color)]' : ''"
      >
        <div class="max-h-[55vh] overflow-y-auto rounded-b-[12px] bg-white px-[12px] py-[12px]">
          <div
            v-if="choices(item).length"
            class="grid grid-cols-3 gap-[10px]"
            style="
              --van-button-small-height: 36px;
              --van-button-small-padding: 0;
              --van-button-small-font-size: 14px;
              --van-button-radius: 6px;
              --van-button-border-width: 1px;
              --van-button-default-color: #000000;
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
              v-for="option in orderedChoices(item)"
              :key="option.value"
              size="small"
              :type="values[item.id] === option.value ? 'primary' : 'default'"
              class="w-full min-w-0"
              @click="selectOption(item, option.value)"
              ><span class="block truncate px-[3px]">{{ option.label }}</span></van-button
            >
          </div>
          <div v-else class="py-[12px] text-center text-[13px] text-[#999999]">暂无可用选项</div>
        </div>
      </van-dropdown-item>
    </van-dropdown-menu>
    <van-popup
      :show="dateTarget !== null"
      position="bottom"
      round
      @update:show="
        (show: boolean) => {
          if (!show) dateTarget = null
        }
      "
    >
      <van-date-picker
        v-if="datePickerStep === 'date'"
        v-model="datePickerValues"
        :title="dateTarget?.label"
        @confirm="confirmDate"
        @cancel="dateTarget = null"
      />
      <van-time-picker
        v-else
        v-model="timePickerValues"
        :columns-type="timeColumns"
        :title="dateTarget?.label"
        @confirm="confirmTime"
        @cancel="dateTarget = null"
      />
    </van-popup>
  </div>
</template>
