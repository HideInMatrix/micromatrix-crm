<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface MobilePickerOption {
  text: string
  value: string
}

const props = withDefaults(
  defineProps<{
    label?: string
    options: MobilePickerOption[]
    placeholder?: string
    required?: boolean
    disabled?: boolean
    multiple?: boolean
    clearable?: boolean
    testid?: string
  }>(),
  {
    label: '',
    placeholder: '请选择',
    required: false,
    disabled: false,
    multiple: false,
    clearable: true,
    testid: undefined,
  },
)

const model = defineModel<string | string[]>({ required: true })
const showPicker = ref(false)
const draftValues = ref<string[]>([])

const selectedValues = computed(() => {
  if (Array.isArray(model.value)) return model.value
  return model.value ? [model.value] : []
})

const displayValue = computed(() =>
  props.options
    .filter((option) => selectedValues.value.includes(option.value))
    .map((option) => option.text)
    .join('；'),
)

function openPicker() {
  if (props.disabled) return
  draftValues.value = [...selectedValues.value]
  showPicker.value = true
}

function onSingleConfirm({ selectedValues: values }: { selectedValues: string[] }) {
  model.value = values[0] ?? ''
  showPicker.value = false
}

function toggle(value: string) {
  if (draftValues.value.includes(value)) {
    draftValues.value = draftValues.value.filter((item) => item !== value)
  } else {
    draftValues.value.push(value)
  }
}

function confirmMultiple() {
  model.value = [...draftValues.value]
  showPicker.value = false
}

function clearValue() {
  model.value = props.multiple ? [] : ''
}

watch(
  () => props.options,
  () => {
    const valid = new Set(props.options.map((option) => option.value))
    if (props.multiple) {
      const next = selectedValues.value.filter((value) => valid.has(value))
      if (next.length !== selectedValues.value.length) model.value = next
    } else if (selectedValues.value[0] && !valid.has(selectedValues.value[0])) {
      model.value = ''
    }
  },
)
</script>

<template>
  <van-field
    :model-value="displayValue"
    :label="label || undefined"
    :placeholder="placeholder"
    :required="required"
    :disabled="disabled"
    :clearable="clearable && !disabled"
    :data-testid="testid"
    is-link
    readonly
    @click="openPicker"
    @clear="clearValue"
  />

  <van-popup
    v-model:show="showPicker"
    position="bottom"
    round
    destroy-on-close
    safe-area-inset-bottom
  >
    <template v-if="multiple">
      <van-nav-bar
        title="请选择"
        left-text="取消"
        right-text="确定"
        @click-left="showPicker = false"
        @click-right="confirmMultiple"
      />
      <div class="max-h-[55vh] overflow-auto py-2">
        <van-checkbox-group v-model="draftValues">
          <van-cell-group :border="false">
            <van-cell
              v-for="option in options"
              :key="option.value"
              :title="option.text"
              clickable
              @click="toggle(option.value)"
            >
              <template #right-icon>
                <van-checkbox :name="option.value" shape="square" @click.stop />
              </template>
            </van-cell>
          </van-cell-group>
        </van-checkbox-group>
      </div>
    </template>
    <van-picker
      v-else
      :model-value="selectedValues"
      :columns="options"
      @confirm="onSingleConfirm"
      @cancel="showPicker = false"
    />
  </van-popup>
</template>
