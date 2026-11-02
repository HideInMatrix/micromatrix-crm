// ============ 销售核心：线索 / 跟进 / 公海 ============

export interface LeadVO {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  inPool: boolean
  poolId: string | null
  ownerId: string | null
  ownerName?: string | null
  deptId: string | null
  customData: Record<string, unknown>
  transitionType: string | null
  transitionId: string | null
  collectedAt: string | null
  poolEnteredAt: string | null
  lastFollowedAt: string | null
  createdAt: string
  updatedAt: string
}

// ============ 跟进记录 ============

export type FollowTargetType = 'lead' | 'customer'

export const FOLLOW_UP_TYPES = ['电话', '拜访', '微信', '邮件', '会议', '其他'] as const

export interface AttachmentVO {
  id: string
  name: string
  size: number
  mime: string | null
  targetType: string | null
  targetId: string | null
  uploaderId: string | null
  createdAt: string
}

export interface FollowUpVO {
  id: string
  targetType: FollowTargetType
  targetId: string
  targetName?: string
  customerId?: string | null
  type: string | null
  content: string
  followedAt: string | null
  ownerId: string
  ownerName: string
  canManage: boolean
  commentCount: number
  moduleFields: Array<{ fieldId: string; fieldValue?: unknown }>
  attachmentMap?: Record<string, AttachmentVO[]>
  createdAt: string
  updatedAt: string
}

export interface FollowUpRecordPrefillVO {
  sourcePlanId: string
  values: Record<string, unknown>
}

export interface FollowCommentMentionUserVO {
  id: string
  name: string
  avatar: string | null
  enabled: boolean
}

export interface FollowCommentVO {
  id: string
  resourceId: string
  parentId: string | null
  replyToUserId: string | null
  replyToUserName: string | null
  content: string
  createdById: string
  createdByName: string
  createdByAvatar: string | null
  editable: boolean
  mentionUsers: FollowCommentMentionUserVO[]
  replies: FollowCommentVO[]
  replyCount: number
  createdAt: string
  updatedAt: string
}

export interface FollowCommentPageVO {
  items: FollowCommentVO[]
  total: number
  commentCount: number
  page: number
  pageSize: number
}

// ============ 跟进计划 ============

export type FollowUpPlanTargetType = 'lead' | 'customer'
export type FollowUpPlanStatus = 'PREPARED' | 'UNDERWAY' | 'COMPLETED' | 'CANCELLED'

export const FOLLOW_UP_PLAN_SYSTEM_FIELD_KEYS = [
  'targetType',
  'targetId',
  'ownerId',
  'estimatedAt',
  'content',
  'method',
  'status',
] as const

export type FollowUpPlanSystemFieldKey = (typeof FOLLOW_UP_PLAN_SYSTEM_FIELD_KEYS)[number]
export type FollowUpPlanCreateContext = 'customer' | 'clue' | 'business'

export const FOLLOW_UP_PLAN_CREATE_CONTEXT_BY_TARGET: Record<
  FollowUpPlanTargetType,
  FollowUpPlanCreateContext
> = {
  customer: 'customer',
  lead: 'clue',
}

export function isFollowUpPlanSystemFieldKey(key: string): key is FollowUpPlanSystemFieldKey {
  return (FOLLOW_UP_PLAN_SYSTEM_FIELD_KEYS as readonly string[]).includes(key)
}

export const FOLLOW_UP_PLAN_STATUS_LABELS: Record<FollowUpPlanStatus, string> = {
  PREPARED: '未开始',
  UNDERWAY: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

export interface FollowUpPlanModuleFieldValue {
  fieldId: string
  fieldValue?: unknown
}

export interface FollowUpPlanVO {
  id: string
  targetType: FollowUpPlanTargetType
  targetId: string
  targetName: string
  customerId: string | null
  content: string
  method: string | null
  estimatedAt: string | null
  status: FollowUpPlanStatus
  converted: boolean
  convertedRecordId: string | null
  commentCount: number
  ownerId: string
  ownerName: string
  createdById: string
  moduleFields: FollowUpPlanModuleFieldValue[]
  canManage: boolean
  createdAt: string
  updatedAt: string
}

export interface StageLogVO {
  id: string
  fromStageName: string | null
  toStageName: string
  userName: string
  createdAt: string
}

// ============ 团队成员 ============

export interface TeamMemberVO {
  id: string
  userId: string
  userName?: string
  role: string | null
  collaborationType: 'READ_ONLY' | 'COLLABORATION'
  createdAt: string
}

// ============ 负责人历史 ============

export interface OwnerHistoryVO {
  id: string
  module: 'lead' | 'customer'
  resourceId: string
  ownerId: string
  ownerName: string | null
  departmentId: string | null
  departmentName: string | null
  operatorId: string | null
  operatorName: string | null
  poolId: string | null
  reasonId: string | null
  reasonName: string | null
  collectedAt: string | null
  endedAt: string
}

// ============ 公海/线索池规则 ============

export interface PoolRuleVO {
  module: 'lead' | 'customer'
  enabled: boolean
  recycleDays: number
  notifyDays: number
}
