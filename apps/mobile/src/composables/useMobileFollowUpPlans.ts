import type {
  FollowUpPlanStatus,
  FollowUpPlanTargetType,
  FollowUpPlanVO,
} from '@micromatrix/shared'
import type { Ref } from 'vue'
import { ref } from 'vue'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { followUpPlanApi } from '@/api/sales'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'

export type MobileFollowUpPlanScope = 'ALL' | 'SELF'

export function useMobileFollowUpPlans(
  targetType: Readonly<Ref<FollowUpPlanTargetType | undefined>>,
  targetId: Readonly<Ref<string | undefined>>,
) {
  const items = ref<FollowUpPlanVO[]>([])
  const page = ref(1)
  const loading = ref(false)
  const finished = ref(false)
  const refreshing = ref(false)
  const keyword = ref('')
  const scope = ref<MobileFollowUpPlanScope>('ALL')

  async function loadMore() {
    loading.value = true
    try {
      const { data } = await followUpPlanApi.list({
        page: page.value,
        pageSize: 20,
        keyword: keyword.value.trim() || undefined,
        targetType: targetType.value,
        targetId: targetId.value,
        mine: !targetId.value && scope.value === 'SELF' ? true : undefined,
      })
      if (refreshing.value) refreshing.value = false
      items.value.push(...data.items)
      finished.value = items.value.length >= data.total
      page.value += 1
    } catch (error) {
      showFailToast(extractErrorMessage(error))
      finished.value = true
    } finally {
      loading.value = false
    }
  }

  function reload() {
    page.value = 1
    items.value = []
    finished.value = false
    void loadMore()
  }

  function setScope(value: MobileFollowUpPlanScope) {
    if (scope.value === value) return
    scope.value = value
    reload()
  }

  async function changeStatus(plan: FollowUpPlanVO, next: FollowUpPlanStatus) {
    if (plan.status === next) return
    try {
      await followUpPlanApi.updateStatus(plan.id, next)
      plan.status = next
      showSuccessFeedback('状态已更新')
    } catch (error) {
      showFailToast(extractErrorMessage(error))
    }
  }

  async function removePlan(plan: FollowUpPlanVO) {
    const confirmed = await showActionConfirm({
      title: '删除计划',
      message: '确认删除该跟进计划？',
      confirmButtonText: '删除',
    })
    if (!confirmed) return

    try {
      await followUpPlanApi.remove(plan.id)
      items.value = items.value.filter((item) => item.id !== plan.id)
      showSuccessFeedback('计划已删除')
    } catch (error) {
      showFailToast(extractErrorMessage(error))
    }
  }

  function updateCommentCount(plan: FollowUpPlanVO, count: number) {
    const item = items.value.find((row) => row.id === plan.id)
    if (item) item.commentCount = count
  }

  return {
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
  }
}

