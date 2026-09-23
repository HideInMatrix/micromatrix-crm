<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    label?: string
    name?: string
    rules?: Array<{ required?: boolean; message?: string }>
    placeholder?: string
    required?: boolean
    disabled?: boolean
    format?: 'iso' | 'space' | 'local'
  }>(),
  {
    label: '',
    name: undefined,
    rules: () => [],
    placeholder: '请选择',
    required: false,
    disabled: false,
    format: 'iso',
  },
)

const model = defineModel<string>({ required: true })
const showPicker = ref(false)
const currentDate = ref<string[]>([])
const currentTime = ref<string[]>([])

function parseValue(value: string) {
  if (!value) return new Date()
  const normalized = value.includes(' ') ? value.replace(' ', 'T') : value
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

function syncPicker() {
  const date = parseValue(model.value)
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  currentDate.value = [yyyy, mm, dd]
  currentTime.value = [hh, min]
}

const displayValue = computed(() => {
  if (!model.value) return ''
  const date = parseValue(model.value)
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
})

function openPicker() {
  if (props.disabled) return
  syncPicker()
  showPicker.value = true
}

function onConfirm() {
  const datePart = currentDate.value.join('-')
  const timePart = currentTime.value.join(':')
  const local = `${datePart}T${timePart}:00`
  if (props.format === 'space') model.value = `${datePart} ${timePart}:00`
  else if (props.format === 'local') model.value = `${datePart}T${timePart}`
  else model.value = new Date(local).toISOString()
  showPicker.value = false
}

watch(model, syncPicker, { immediate: true })
</script>

<template>
  <van-field
    :model-value="displayValue"
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

  <van-popup
    v-model:show="showPicker"
    position="bottom"
    round
    destroy-on-close
    safe-area-inset-bottom
  >
    <van-picker-group
      title="选择日期时间"
      :tabs="['日期', '时间']"
      next-step-text="下一步"
      @confirm="onConfirm"
      @cancel="showPicker = false"
    >
      <van-date-picker v-model="currentDate" :columns-type="['year', 'month', 'day']" />
      <van-time-picker v-model="currentTime" :columns-type="['hour', 'minute']" />
    </van-picker-group>
  </van-popup>
</template>
