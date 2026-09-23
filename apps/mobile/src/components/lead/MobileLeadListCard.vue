<script setup lang="ts">
import type { FieldVO, LeadVO } from '@micromatrix/shared'
import { formatFieldValue } from '@micromatrix/frontend-shared/field-display'
import { computed } from 'vue'

const props = defineProps<{
  lead: LeadVO
  fields: FieldVO[]
  memberMap: Map<string, string>
  deptMap: Map<string, string>
}>()

const primaryField = computed(
  () => props.fields.find((field) => field.key === 'name') ?? props.fields[0],
)
const detailFields = computed(() =>
  props.fields.filter((field) => field.id !== primaryField.value?.id),
)

function displayValue(field: FieldVO) {
  return formatFieldValue(field, props.lead as unknown as Record<string, unknown>, {
    memberMap: props.memberMap,
    deptMap: props.deptMap,
  })
}
</script>

<template>
  <div class="flex flex-col gap-3 rounded-[6px] bg-[var(--text-n10)] px-5 py-4">
    <div class="flex min-w-0 items-start justify-between gap-3">
      <div class="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-n1)]">
        {{ primaryField ? displayValue(primaryField) : lead.name }}
      </div>
      <slot name="extra" />
    </div>

    <div v-if="detailFields.length" class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      <div v-for="field in detailFields" :key="field.id" class="min-w-0">
        <div class="truncate text-[var(--text-n4)]">{{ field.label }}</div>
        <div class="mt-0.5 break-all text-[var(--text-n1)]">{{ displayValue(field) }}</div>
      </div>
    </div>

    <template v-if="$slots.actions">
      <van-divider class="!my-0" />
      <div
        class="flex w-full items-center justify-between gap-2 [&_.van-button]:min-w-0 [&_.van-button]:flex-1 [&_.van-button]:!px-1"
      >
        <slot name="actions" />
      </div>
    </template>
  </div>
</template>

