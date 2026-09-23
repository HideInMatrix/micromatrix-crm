<script setup lang="ts">
import { formatFieldValue } from '@micromatrix/frontend-shared/field-display'
import type { CustomerVO, FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'

const props = defineProps<{
  customer: CustomerVO
  fields: FieldVO[]
  memberMap: Map<string, string>
  deptMap: Map<string, string>
}>()

const emit = defineEmits<{
  (event: 'open', customer: CustomerVO): void
}>()

const primaryField = computed(
  () => props.fields.find((field) => field.key === 'name') ?? props.fields[0],
)

const detailFields = computed(() =>
  props.fields.filter((field) => field.id !== primaryField.value?.id),
)

function displayValue(field: FieldVO) {
  return formatFieldValue(field, props.customer as unknown as Record<string, unknown>, {
    memberMap: props.memberMap,
    deptMap: props.deptMap,
  })
}

function openCustomer() {
  emit('open', props.customer)
}
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-[6px] bg-[var(--text-n10)] px-5 py-4"
    @click="openCustomer"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-n1)]">
        {{ primaryField ? displayValue(primaryField) : customer.name }}
      </div>
    </div>

    <div v-if="detailFields.length" class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
      <div
        v-for="field in detailFields"
        :key="field.id"
        class="flex min-w-0 items-start gap-2"
      >
        <span class="shrink-0 text-[var(--text-n4)]">{{ field.label }}</span>
        <span class="min-w-0 break-all text-[var(--text-n1)]">
          {{ displayValue(field) }}
        </span>
      </div>
    </div>

    <template v-if="$slots.actions">
      <van-divider class="!my-0" />
      <div
        class="flex w-full items-center justify-between gap-2 [&_.van-button]:min-w-0 [&_.van-button]:flex-1 [&_.van-button]:!px-1"
        @click.stop
      >
        <slot name="actions" />
      </div>
    </template>
  </div>
</template>
