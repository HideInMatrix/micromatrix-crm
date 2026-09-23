<script setup lang="ts">
import type { FollowUpPlanStatus, FollowUpPlanVO } from '@micromatrix/shared'
import { ref, watch } from 'vue'
import {
  FOLLOW_UP_PLAN_STATUS_OPTIONS,
  formatFollowUpPlanCommentCount,
  formatFollowUpPlanDate,
} from '@/utils/follow-up-plan'

const props = withDefaults(
  defineProps<{
    plan: FollowUpPlanVO
    canWrite?: boolean
  }>(),
  {
    canWrite: true,
  },
)

const emit = defineEmits<{
  (event: 'edit', plan: FollowUpPlanVO): void
  (event: 'delete', plan: FollowUpPlanVO): void
  (event: 'comment', plan: FollowUpPlanVO): void
  (event: 'convert', plan: FollowUpPlanVO): void
  (event: 'status-change', plan: FollowUpPlanVO, status: FollowUpPlanStatus): void
}>()

const status = ref<FollowUpPlanStatus>(props.plan.status)

watch(
  () => props.plan.status,
  (value) => {
    status.value = value
  },
)

function changeStatus(value: string | number) {
  emit('status-change', props.plan, value as FollowUpPlanStatus)
  status.value = props.plan.status
}

function edit() {
  emit('edit', props.plan)
}

function remove() {
  emit('delete', props.plan)
}

function comment() {
  emit('comment', props.plan)
}

function convert() {
  emit('convert', props.plan)
}
</script>

<template>
  <div class="flex gap-4 overflow-hidden">
    <div class="flex flex-col items-center gap-1">
      <div class="flex h-[22px] w-2 items-center">
        <div class="h-2 w-full rounded-full border border-[var(--primary-8)]" />
      </div>
      <div class="flex flex-1 justify-center">
        <div class="h-full w-px bg-[var(--primary-8)]" />
      </div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col gap-2 overflow-hidden">
      <div class="flex min-h-6 items-center justify-between gap-4">
        <div class="flex min-w-0 items-center gap-2">
          <van-tag
            v-if="plan.converted"
            plain
            type="primary"
            class="shrink-0"
          >
            已转跟进记录
          </van-tag>
          <span class="shrink-0 text-sm text-[var(--text-n2)]">
            {{ formatFollowUpPlanDate(plan) }}
          </span>
          <span class="min-w-0 truncate text-sm font-semibold text-[var(--text-n1)]">
            {{ plan.method || '-' }}
          </span>
        </div>

        <van-dropdown-menu
          class="shrink-0 [&_.van-dropdown-menu__bar]:!h-6 [&_.van-dropdown-menu__bar]:!rounded-[4px] [&_.van-dropdown-menu__bar]:!shadow-none [&_.van-dropdown-menu__title]:!text-sm"
          @click.stop
        >
          <van-dropdown-item
            v-model="status"
            :disabled="!props.canWrite || !plan.canManage || (plan.converted && plan.status === 'COMPLETED')"
            :options="FOLLOW_UP_PLAN_STATUS_OPTIONS"
            @change="changeStatus"
          />
        </van-dropdown-menu>
      </div>

      <div class="flex flex-col gap-3 rounded-[9px] bg-[var(--text-n10)] p-4">
        <div class="flex items-center justify-between gap-4">
          <div class="flex min-w-0 items-center gap-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary-7)] text-sm font-semibold text-[var(--primary-8)]"
            >
              {{ plan.ownerName?.slice(0, 1) || '?' }}
            </div>
            <div class="min-w-0">
              <div class="truncate text-base font-semibold text-[var(--text-n1)]">
                {{ plan.ownerName || '-' }}
              </div>
              <div class="mt-0.5 truncate text-xs text-[var(--text-n4)]">
                {{ plan.targetName }}
              </div>
            </div>
          </div>
        </div>

        <div class="rounded-[3px] bg-[var(--text-n9)] p-3 text-xs leading-5 text-[var(--text-n1)]">
          {{ plan.content }}
        </div>

        <div
          class="flex items-center"
          :class="props.canWrite && plan.canManage ? 'justify-between' : 'justify-end'"
        >
          <div v-if="props.canWrite && plan.canManage" class="flex items-center gap-4">
            <van-button
              icon="delete-o"
              size="small"
              type="danger"
              plain
              class="!h-auto !border-0 !p-0"
              @click.stop="remove"
            />
            <van-button
              icon="edit"
              size="small"
              type="primary"
              plain
              class="!h-auto !border-0 !p-0"
              @click.stop="edit"
            />
            <van-button
              v-if="plan.status === 'COMPLETED' && !plan.converted"
              icon="exchange"
              size="small"
              type="primary"
              plain
              class="!h-auto !border-0 !p-0"
              @click.stop="convert"
            />
          </div>

          <div
            class="flex items-center gap-1 px-1 text-xs text-[var(--text-n4)]"
            @click.stop="comment"
          >
            <van-icon name="chat-o" size="14" />
            <span>{{ formatFollowUpPlanCommentCount(plan.commentCount) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

