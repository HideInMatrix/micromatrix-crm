<script setup lang="ts">
import type { FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'

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
const datetimeLocalValue = computed(() => (stringValue.value ? stringValue.value.slice(0, 16) : ''))

function update(value: unknown) {
  emit('update:modelValue', value)
}

function updateSelect(event: Event) {
  update((event.target as HTMLSelectElement).value)
}

function updateDatetime(event: Event) {
  const value = (event.target as HTMLInputElement).value
  update(value ? new Date(value).toISOString() : '')
}
</script>

<template>
  <van-field v-if="field.key === 'targetType'" :label="field.label" :required="field.required">
    <template #input>
      <select
        :value="stringValue"
        :disabled="targetLocked"
        class="w-full bg-transparent"
        @change="updateSelect"
      >
        <option
          v-for="option in field.options ?? []"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </template>
  </van-field>

  <van-field v-else-if="field.key === 'targetId'" :label="field.label" :required="field.required">
    <template #input>
      <select
        :value="stringValue"
        :disabled="targetLocked"
        class="w-full bg-transparent"
        @change="updateSelect"
      >
        <option value="">请选择</option>
        <option v-for="item in targets" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </template>
  </van-field>

  <van-field v-else-if="field.key === 'contactId'" :label="field.label" :required="field.required">
    <template #input>
      <select :value="stringValue" class="w-full bg-transparent" @change="updateSelect">
        <option value="">请选择</option>
        <option v-for="item in contacts" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </template>
  </van-field>

  <van-field v-else-if="field.key === 'estimatedAt'" :label="field.label" :required="field.required">
    <template #input>
      <input
        :value="datetimeLocalValue"
        type="datetime-local"
        class="w-full bg-transparent"
        @input="updateDatetime"
      />
    </template>
  </van-field>

  <van-field
    v-else-if="field.key === 'method' || field.key === 'status'"
    :label="field.label"
    :required="field.required"
  >
    <template #input>
      <select :value="stringValue" class="w-full bg-transparent" @change="updateSelect">
        <option value="">请选择</option>
        <option
          v-for="option in field.options ?? []"
          :key="option.value"
          :value="option.value"
        >
          {{ option.label }}
        </option>
      </select>
    </template>
  </van-field>

  <van-field v-else-if="field.key === 'ownerId'" :label="field.label" :required="field.required">
    <template #input>
      <select :value="stringValue" class="w-full bg-transparent" @change="updateSelect">
        <option value="">请选择</option>
        <option v-for="item in members" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </template>
  </van-field>

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
