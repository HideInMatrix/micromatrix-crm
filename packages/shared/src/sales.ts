// ============ 销售核心：线索 / 跟进 / 商机 / 公海 ============

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
  ownerId: string | null
  ownerName?: string | null
  deptId: string | null
  customData: Record<string, unknown>
  convertedCustomerId: string | null
  lastFollowedAt: string | null
  createdAt: string
  updatedAt: string
}

// ============ 跟进记录 ============

export type FollowTargetType = 'lead' | 'customer' | 'opportunity' | 'contract'

export const FOLLOW_UP_TYPES = ['电话', '拜访', '微信', '邮件', '会议', '其他'] as const

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
  createdAt: string
}

// ============ 公海/线索池规则 ============

export interface PoolRuleVO {
  module: 'lead' | 'customer'
  enabled: boolean
  recycleDays: number
  notifyDays: number
}
