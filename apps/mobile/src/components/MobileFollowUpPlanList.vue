<script setup lang="ts">
import type { FollowUpPlanStatus, FollowUpPlanTargetType, FollowUpPlanVO } from '@micromatrix/shared'
import { ref, toRef } from 'vue'
import MobileFollowCommentSheet from '@/components/MobileFollowCommentSheet.vue'
import MobileFollowRecordFormSheet from '@/components/MobileFollowRecordFormSheet.vue'
import MobileFollowUpPlanFormSheet from '@/components/follow-up-plan/MobileFollowUpPlanFormSheet.vue'
import MobileFollowUpPlanItem from '@/components/follow-up-plan/MobileFollowUpPlanItem.vue'
import MobileFollowUpPlanToolbar from '@/components/follow-up-plan/MobileFollowUpPlanToolbar.vue'
import { useMobileFollowUpPlans } from '@/composables/useMobileFollowUpPlans'

const props = withDefaults(
  defineProps<{
    targetType?: FollowUpPlanTargetType
    targetId?: string
    targetName?: string
    canWrite?: boolean
  }>(),
  {
    targetType: undefined,
    targetId: undefined,
    targetName: undefined,
    canWrite: true,
  },
)

const {
  items,
  loading,
  finished,
  refreshing,
  keyword,
  scope,
  loadMore,
  reload,
  setScope,
  changeStatus,
  removePlan,
  updateCommentCount,
} = useMobileFollowUpPlans(toRef(props, 'targetType'), toRef(props, 'targetId'))

const formSheet = ref<InstanceType<typeof MobileFollowUpPlanFormSheet> | null>(null)
const commentPlan = ref<FollowUpPlanVO | null>(null)
const commentShow = ref(false)
const convertingPlan = ref<FollowUpPlanVO | null>(null)
const recordFormShow = ref(false)

function openCreate() {
  formSheet.value?.open()
}

function editPlan(plan: FollowUpPlanVO) {
  formSheet.value?.open(plan)
}

function openComments(plan: FollowUpPlanVO) {
  commentPlan.value = plan
  commentShow.value = true
}

function handleCommentCount(count: number) {
  if (!commentPlan.value) return
  updateCommentCount(commentPlan.value, count)
}

function convertPlan(plan: FollowUpPlanVO) {
  convertingPlan.value = plan
  recordFormShow.value = true
}

function handleStatusChange(plan: FollowUpPlanVO, status: FollowUpPlanStatus) {
  void changeStatus(plan, status)
}

function handleDelete(plan: FollowUpPlanVO) {
  void removePlan(plan)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--text-n9)]">
    <MobileFollowUpPlanToolbar
      v-model:keyword="keyword"
      v-model:scope="scope"
      :scoped-to-target="Boolean(targetId)"
      :can-write="canWrite !== false"
      @create="openCreate"
      @search="reload"
      @scope-change="setScope"
    />

    <van-pull-refresh
      v-model="refreshing"
      class="min-h-0 flex-1 overflow-auto"
      @refresh="reload"
    >
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="已经到底部啦~"
        class="flex flex-col gap-4 p-4"
        @load="loadMore"
      >
        <van-empty
          v-if="finished && items.length === 0"
          image-size="64"
          description="暂无跟进计划"
          class="!py-10"
        />

        <MobileFollowUpPlanItem
          v-for="plan in items"
          :key="plan.id"
          :plan="plan"
          :can-write="canWrite !== false"
          @edit="editPlan"
          @delete="handleDelete"
          @comment="openComments"
          @convert="convertPlan"
          @status-change="handleStatusChange"
        />
      </van-list>
    </van-pull-refresh>

    <MobileFollowUpPlanFormSheet
      ref="formSheet"
      :target-type="targetType"
      :target-id="targetId"
      :target-name="targetName"
      @saved="reload"
    />

    <MobileFollowCommentSheet
      v-if="commentPlan"
      v-model="commentShow"
      resource-type="plan"
      :resource-id="commentPlan.id"
      @count-changed="handleCommentCount"
    />

    <MobileFollowRecordFormSheet
      v-model="recordFormShow"
      :plan="convertingPlan"
      @saved="reload"
    />
  </div>
</template>
