import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  type FollowUpPlanStatus,
  type FollowUpPlanVO,
} from '@micromatrix/shared'

export const FOLLOW_UP_PLAN_STATUS_OPTIONS = Object.entries(FOLLOW_UP_PLAN_STATUS_LABELS).map(
  ([value, text]) => ({
    text,
    value: value as FollowUpPlanStatus,
  }),
)

export function formatFollowUpPlanDate(plan: FollowUpPlanVO) {
  if (!plan.estimatedAt) return '-'
  return new Date(plan.estimatedAt).toLocaleDateString('zh-CN')
}

export function formatFollowUpPlanCommentCount(count: number) {
  if (count > 99) return '99+'
  return String(count || 0)
}

