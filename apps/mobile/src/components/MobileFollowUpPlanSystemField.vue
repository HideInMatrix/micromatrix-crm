<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'
import MobileVantDateTimeField from '@/components/MobileVantDateTimeField.vue'
import MobileVantPickerField from '@/components/MobileVantPickerField.vue'

interface OptionItem {
  id: string
  name: string
}

const props = defineProps<{
  field: FieldVO
  modelValue: unknown
  targetLocked: boolean
  targets: OptionItem[]
  contacts: OptionItem[]
  members: OptionItem[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

const stringValue = computed(() => (typeof props.modelValue === 'string' ? props.modelValue : ''))
function update(value: unknown) {
  emit('update:modelValue', value)
}

const fieldOptions = computed(() =>
  (props.field.options ?? []).map((option) => ({ text: option.label, value: String(option.value) })),
)
const targetOptions = computed(() => props.targets.map((item) => ({ text: item.name, value: item.id })))
const contactOptions = computed(() => props.contacts.map((item) => ({ text: item.name, value: item.id })))
const memberOptions = computed(() => props.members.map((item) => ({ text: item.name, value: item.id })))
</script>

<template>
  <MobileVantPickerField
    v-if="field.key === 'targetType'"
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    :disabled="targetLocked"
    :options="fieldOptions"
    @update:model-value="update"
  />

  <MobileVantPickerField
    v-else-if="field.key === 'targetId'"
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    :disabled="targetLocked"
    :options="targetOptions"
    @update:model-value="update"
  />

  <MobileVantPickerField
    v-else-if="field.key === 'contactId'"
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    :options="contactOptions"
    @update:model-value="update"
  />

  <MobileVantDateTimeField
    v-else-if="field.key === 'estimatedAt'"
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    format="iso"
    @update:model-value="update"
  />

  <MobileVantPickerField
    v-else-if="field.key === 'method' || field.key === 'status'"
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    :options="fieldOptions"
    @update:model-value="update"
  />

  <MobileVantPickerField
    v-else-if="field.key === 'ownerId'"
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    :options="memberOptions"
    @update:model-value="update"
  />

  <van-field
    v-else-if="field.key === 'content'"
    :model-value="stringValue"
    data-testid="mobile-follow-plan-content"
    :label="field.label"
    :required="field.required"
    type="textarea"
    rows="4"
    maxlength="3000"
    show-word-limit
    @update:model-value="update"
  />

  <van-field
    v-else
    :model-value="stringValue"
    :label="field.label"
    :required="field.required"
    @update:model-value="update"
  />
</template>
