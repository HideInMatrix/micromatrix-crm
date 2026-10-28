<script setup lang="ts">
import { computed, ref } from 'vue'
import MobileCalendarPopup from './MobileCalendarPopup.vue'

const props = withDefaults(
  defineProps<{
    label?: string
    name?: string
    rules?: Array<{ required?: boolean; message?: string }>
    placeholder?: string
    required?: boolean
    inputAlign?: 'left' | 'right'
    disabled?: boolean
    format?: 'iso' | 'space' | 'local'
  }>(),
  {
    label: '',
    name: undefined,
    rules: () => [],
    placeholder: '请选择',
    required: false,
    inputAlign: 'left',
    disabled: false,
    format: 'iso',
  },
)

const model = defineModel<string>({ required: true })
const showCalendar = ref(false)

function parseValue(value: string): Date | null {
  if (!value) return null
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatLocalDay(date: Date): string {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

const displayValue = computed(() => {
  const date = parseValue(model.value)
  return date ? formatLocalDay(date) : ''
})

function openPicker() {
  if (props.disabled) return
  showCalendar.value = true
}

function onCalendarConfirm(date: string) {
  // Datetime fields keep their API serialization contract, but only expose a
  // calendar to users. A selected day is normalized to local midnight.
  const local = `${date}T00:00:00`
  if (props.format === 'space') model.value = `${date} 00:00:00`
  else if (props.format === 'local') model.value = `${date}T00:00`
  else model.value = new Date(local).toISOString()
}
</script>

<template>
  <van-field
    :model-value="displayValue"
    :input-align="inputAlign"
    :name="name"
    :rules="rules"
    :label="label || undefined"
    :placeholder="placeholder"
    :required="required"
    :disabled="disabled"
    is-link
    readonly
    clearable
    @click="openPicker"
    @clear="model = ''"
  />

  <MobileCalendarPopup
    v-model:show="showCalendar"
    :label="label || '选择日期'"
    :value="displayValue"
    @confirm="onCalendarConfirm"
  />
</template>
