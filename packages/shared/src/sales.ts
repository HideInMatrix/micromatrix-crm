// ============ 销售核心：线索 / 跟进 / 商机 / 公海 ============

import type { LineItemVO } from './deal'

export type LeadStatus = 'FOLLOWING' | 'CONVERTED' | 'INVALID'

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  FOLLOWING: '跟进中',
  CONVERTED: '已转化',
  INVALID: '无效',
}

export interface LeadVO {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  email: string | null
  status: LeadStatus
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

export type FollowTargetType = 'lead' | 'customer' | 'opportunity' | 'contract'

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
  type: string
  content: string
  nextFollowAt: string | null
  ownerId: string
  ownerName: string
  createdAt: string
  attachments?: AttachmentVO[]
}

// ============ 跟进计划 ============

export type FollowUpPlanTargetType = 'lead' | 'customer' | 'opportunity'
export type FollowUpPlanStatus = 'PREPARED' | 'UNDERWAY' | 'COMPLETED' | 'CANCELLED'

export const FOLLOW_UP_PLAN_STATUS_LABELS: Record<FollowUpPlanStatus, string> = {
  PREPARED: '未开始',
  UNDERWAY: '进行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
}

export interface FollowUpPlanVO {
  id: string
  targetType: FollowUpPlanTargetType
  targetId: string
  targetName: string
  customerId: string | null
  contactId: string | null
  contactName: string | null
  content: string
  method: string | null
  estimatedAt: string | null
  status: FollowUpPlanStatus
  converted: boolean
  convertedRecordId: string | null
  ownerId: string
  ownerName: string
  createdById: string
  customData: Record<string, unknown>
  canManage: boolean
  createdAt: string
  updatedAt: string
}

// ============ 商机 ============

export interface OpportunityStageVO {
  id: string
  name: string
  probability: number
  sort: number
  isWon: boolean
  isLost: boolean
  system: boolean
  count?: number
  amountSum?: number
}

export interface OpportunityVO {
  id: string
  name: string
  customerId: string
  customerName?: string
  contactId?: string | null
  contactName?: string | null
  stageId: string
  stageName?: string
  stageProbability?: number
  isWon?: boolean
  isLost?: boolean
  amount: number | null
  expectedCloseAt: string | null
  lostReason: string | null
  remark: string | null
  ownerId: string | null
  ownerName?: string | null
  deptId: string | null
  customData: Record<string, unknown>
  items?: LineItemVO[]
  wonAt: string | null
  lostAt: string | null
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

export interface ContactVO {
  id: string
  customerId: string
  customerName: string | null
  ownerId: string | null
  ownerName: string | null
  deptId: string | null
  name: string
  phone: string | null
  enable: boolean
  disableReason: string | null
  customData: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

// ============ 公海/线索池规则 ============

export interface PoolRuleVO {
  module: 'lead' | 'customer'
  enabled: boolean
  recycleDays: number
  notifyDays: number
}
