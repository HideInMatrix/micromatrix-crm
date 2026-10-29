<script setup lang="ts">
import type { FieldVO, LeadVO } from '@micromatrix/shared'
import { formatFieldValue } from '@micromatrix/frontend-shared/field-display'
import { computed } from 'vue'

const emit = defineEmits<{
  open: []
  call: []
  follow: []
  assign: []
  claim: []
}>()
const props = withDefaults(
  defineProps<{
    lead: LeadVO
    fields: FieldVO[]
    memberMap: Map<string, string>
    deptMap: Map<string, string>
    stageNames?: Record<string, string>
    mode?: 'mine' | 'pool'
    canFollow?: boolean
    canAssign?: boolean
    canClaim?: boolean
  }>(),
  { mode: 'mine', canFollow: false, canAssign: false, canClaim: false, stageNames: () => ({}) },
)

// 字段由 PC 表单配置决定：列表显示、移动端显示、字段顺序同时生效。
// 卡片头部取配置顺序的前两个字段，其余字段仍按相同顺序展示。
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
const showActions = computed(() => props.mode === 'mine' || props.canAssign || props.canClaim)

function displayValue(field: FieldVO) {
  if (field.key === 'stage' || field.key === 'status')
    return props.stageNames?.[props.lead.status] ?? props.lead.status
  if (field.key === 'lastFollowedAt') {
    const value = props.lead.lastFollowedAt
    if (!value) return '-'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '-'
    return `${date.getMonth() + 1}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return formatFieldValue(field, props.lead as unknown as Record<string, unknown>, {
    memberMap: props.memberMap,
    deptMap: props.deptMap,
  })
}
</script>

<template>
  <article class="rounded-[8px] bg-white p-[12px]" @click="emit('open')">
    <div
      v-if="visibleFields.length"
      class="grid grid-cols-2 gap-x-[8px] gap-y-[12px] text-[12px] leading-[16px]"
    >
      <div v-for="field in visibleFields" :key="field.id" class="min-w-0 truncate">
        <span v-if="field.key !== 'name'" class="text-[#666666]">{{ field.label }}：</span
        ><span class="text-[#333333]">{{ displayValue(field) }}</span>
      </div>
    </div>
    <div v-else class="text-[12px] leading-[16px] text-[#333333]">查看线索</div>
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
        <van-button v-if="lead.phone" size="small" type="primary" plain round @click="emit('call')">
          电话联系
        </van-button>
        <van-button size="small" type="primary" plain round @click="emit('open')">
          详情
        </van-button>
        <van-button v-if="canFollow" size="small" type="primary" round @click="emit('follow')">
          写跟进
        </van-button>
      </template>
      <template v-else>
        <van-button
          v-if="canAssign"
          size="small"
          type="primary"
          plain
          round
          @click="emit('assign')"
        >
          分配
        </van-button>
        <van-button v-if="canClaim" size="small" type="primary" round @click="emit('claim')">
          领取
        </van-button>
      </template>
    </div>
  </article>
</template>
