<script setup lang="ts">
import type { MobileFollowUpPlanScope } from '@/composables/useMobileFollowUpPlans'

const props = withDefaults(
  defineProps<{
    scopedToTarget?: boolean
    canWrite?: boolean
  }>(),
  {
    scopedToTarget: false,
    canWrite: true,
  },
)

const emit = defineEmits<{
  (event: 'create'): void
  (event: 'search'): void
  (event: 'scope-change', value: MobileFollowUpPlanScope): void
}>()

const keyword = defineModel<string>('keyword', { default: '' })
const scope = defineModel<MobileFollowUpPlanScope>('scope', { default: 'ALL' })

const scopeOptions: Array<{ label: string; value: MobileFollowUpPlanScope }> = [
  { label: '全部', value: 'ALL' },
  { label: '我的计划', value: 'SELF' },
]

function selectScope(value: MobileFollowUpPlanScope) {
  if (scope.value === value) return
  emit('scope-change', value)
}

function createPlan() {
  emit('create')
}

function search() {
  emit('search')
}
</script>

<template>
  <div v-if="scopedToTarget" class="flex items-center gap-3 bg-[var(--text-n10)] p-[8px_16px]">
    <van-button
      v-if="props.canWrite"
      plain
      icon="plus"
      type="primary"
      size="small"
      @click="createPlan"
    />
    <van-search
      v-model="keyword"
      shape="round"
      placeholder="请输入关键词"
      class="min-w-0 flex-1 !p-0"
      @search="search"
      @clear="search"
    />
  </div>

  <div
    v-else
    class="flex min-h-12 items-center gap-2 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] p-2"
  >
    <van-button
      v-for="item in scopeOptions"
      :key="item.value"
      round
      size="small"
      class="!border-none !px-4 !py-1 !text-sm"
      :class="
        scope === item.value
          ? '!bg-[var(--primary-7)] !text-[var(--primary-8)]'
          : '!bg-[var(--text-n9)] !text-[var(--text-n1)]'
      "
      @click="selectScope(item.value)"
    >
      {{ item.label }}
    </van-button>

    <van-button
      v-if="props.canWrite"
      plain
      icon="plus"
      type="primary"
      size="small"
      class="ml-auto"
      @click="createPlan"
    />
  </div>
</template>

