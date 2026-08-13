// ============ 审批流 ============

export type ApproverType = 'USER' | 'ROLE' | 'DEPT_LEADER' | 'DIRECT_LEADER'
export type ApprovalMode = 'ALL' | 'ANY'
export type ApprovalInstanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED'
export type ApprovalTaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
/** 业务对象上的审批状态 */
export type BizApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED'

export const APPROVER_TYPE_LABELS: Record<ApproverType, string> = {
  USER: '指定成员',
  ROLE: '指定角色',
  DEPT_LEADER: '部门主管',
  DIRECT_LEADER: '直属上级',
}

export const APPROVAL_MODE_LABELS: Record<ApprovalMode, string> = {
  ALL: '会签（全部通过）',
  ANY: '或签（任一通过）',
}

export const APPROVAL_INSTANCE_STATUS_LABELS: Record<ApprovalInstanceStatus, string> = {
  PENDING: '审批中',
  APPROVED: '已通过',
  REJECTED: '已驳回',
  CANCELED: '已撤回',
}

/** 可挂接审批的业务对象 */
export type ApprovalModule = 'quote' | 'contract' | 'order' | 'receivableRecord'

export const APPROVAL_MODULE_LABELS: Record<ApprovalModule, string> = {
  quote: '报价',
  contract: '合同',
  order: '订单',
  receivableRecord: '回款',
}

export interface ApprovalNodeConfig {
  name: string
  approverType: ApproverType
  approverIds: string[]
  mode: ApprovalMode
}

export interface ApprovalFlowVO {
  id: string
  module: ApprovalModule
  name: string
  enabled: boolean
  condition: { amountGte?: number } | null
  nodes: (ApprovalNodeConfig & { id: string; sort: number })[]
}

export interface ApprovalTaskVO {
  id: string
  instanceId: string
  nodeIndex: number
  nodeName: string
  approverId: string
  approverName?: string
  status: ApprovalTaskStatus
  comment: string | null
  handledAt: string | null
}

export interface ApprovalInstanceVO {
  id: string
  module: ApprovalModule
  targetId: string
  targetName: string
  summary: string | null
  status: ApprovalInstanceStatus
  currentNodeIndex: number
  nodesSnapshot: ApprovalNodeConfig[]
  submitterId: string
  submitterName: string
  finishedAt: string | null
  createdAt: string
  tasks: ApprovalTaskVO[]
  /** 当前用户待处理的任务 id */
  myPendingTaskId?: string | null
}
