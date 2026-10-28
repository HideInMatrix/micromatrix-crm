<script setup lang="ts">
import { formatFieldValue } from '@micromatrix/frontend-shared/field-display'
import type { CustomerVO, FieldVO } from '@micromatrix/shared'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    customer: CustomerVO
    fields: FieldVO[]
    memberMap: Map<string, string>
    deptMap: Map<string, string>
    mode?: 'mine' | 'pool'
    canFollow?: boolean
    canAssign?: boolean
    canClaim?: boolean
    canDelete?: boolean
  }>(),
  {
    mode: 'mine',
    canFollow: false,
    canAssign: false,
    canClaim: false,
    canDelete: false,
  },
)
const emit = defineEmits<{
  open: [customer: CustomerVO]
  call: [customer: CustomerVO]
  follow: [customer: CustomerVO]
  assign: [customer: CustomerVO]
  claim: [customer: CustomerVO]
  delete: [customer: CustomerVO]
}>()

// 客户卡片与线索卡片使用相同的动态字段规则和两列排版。
const visibleFields = computed(() =>
  props.fields
    .filter(
      (field) =>
        field.showInList &&
        field.mobile !== false &&
        !field.hidden &&
        !['alert', 'sub_product'].includes(field.type),
    )
    .sort((a, b) => a.sort - b.sort),
)
const heading = computed(() => visibleFields.value[0] ?? null)
const subtitle = computed(() => visibleFields.value[1] ?? null)
const detailFields = computed(() => visibleFields.value.slice(2))
const showActions = computed(
  () => props.mode === 'mine' || props.canAssign || props.canClaim || props.canDelete,
)

function displayValue(field: FieldVO): string {
  if (field.key === 'lastFollowedAt') {
    if (!props.customer.lastFollowedAt) return '-'
    const date = new Date(props.customer.lastFollowedAt)
    if (Number.isNaN(date.getTime())) return '-'
    const pad = (v: number) => String(v).padStart(2, '0')
    return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return formatFieldValue(field, props.customer as unknown as Record<string, unknown>, {
    memberMap: props.memberMap,
    deptMap: props.deptMap,
  })
}
</script>

<template>
  <article class="rounded-[8px] bg-white p-[12px]" @click="emit('open', customer)">
    <div v-if="heading" class="flex min-w-0 items-center justify-between gap-[8px]">
      <span class="min-w-0 truncate text-[15px] leading-[18px] font-medium text-[#000000]">
        <span v-if="heading.key !== 'name'">{{ heading.label }}：</span>{{ displayValue(heading) }}
      </span>
      <span
        v-if="subtitle"
        class="max-w-[64%] shrink-0 truncate whitespace-nowrap text-[12px] leading-[18px] text-[#666666]"
      >
        {{ subtitle.label }}：<span class="text-[#333333]">{{ displayValue(subtitle) }}</span>
      </span>
    </div>
    <div v-else class="text-[15px] leading-[18px] font-medium text-[#333333]">查看客户</div>
    <div
      v-if="detailFields.length"
      class="mt-[12px] grid grid-cols-2 gap-x-[8px] gap-y-[12px] text-[12px] leading-[16px]"
    >
      <div v-for="field in detailFields" :key="field.id" class="min-w-0 truncate">
        <span class="text-[#666666]">{{ field.label }}：</span
        ><span class="text-[#333333]">{{ displayValue(field) }}</span>
      </div>
    </div>
    <div
      v-if="showActions"
      class="mt-[16px] flex items-center justify-end gap-[12px]"
      style="
        --van-button-small-height: 28px;
        --van-button-small-padding: 0 18px;
        --van-button-small-font-size: 12px;
        --van-button-round-radius: 14px;
        --van-button-border-width: 0px;
        --van-button-plain-background: color-mix(in srgb, var(--van-primary-color) 8%, white);
      "
      @click.stop
    >
      <template v-if="mode === 'mine'">
        <van-button
          v-if="customer.phone"
          size="small"
          type="primary"
          plain
          round
          @click="emit('call', customer)"
          >电话联系</van-button
        >
        <van-button size="small" type="primary" plain round @click="emit('open', customer)"
          >详情</van-button
        >
        <van-button
          v-if="canFollow"
          size="small"
          type="primary"
          round
          @click="emit('follow', customer)"
          >写跟进</van-button
        >
      </template>
      <template v-else>
        <van-button
          v-if="canAssign"
          size="small"
          type="primary"
          plain
          round
          @click="emit('assign', customer)"
          >分配</van-button
        >
        <van-button
          v-if="canClaim"
          size="small"
          type="primary"
          round
          @click="emit('claim', customer)"
          >领取</van-button
        >
        <van-button
          v-if="canDelete"
          size="small"
          type="danger"
          plain
          round
          @click="emit('delete', customer)"
          >删除</van-button
        >
      </template>
    </div>
  </article>
</template>
