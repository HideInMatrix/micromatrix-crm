import type { AttachmentVO } from './sales'

// ============ 审批流 ============

export type ApproverType = 'USER' | 'ROLE' | 'DEPT_LEADER' | 'DIRECT_LEADER'
export type ApprovalMode = 'ALL' | 'ANY'
export type ApprovalInstanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED'
export type ApprovalTaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
export type ApprovalTaskType = 'APPROVAL' | 'CC' | 'SIGN' | 'BACK'
export type ApprovalTaskAction = 'APPROVE' | 'REJECT' | 'SIGN' | 'BACK'
export type ApprovalAddSignType = 'BEFORE' | 'AFTER'
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
export type ApprovalModule = 'quote' | 'contract' | 'invoice' | 'order'

export const APPROVAL_MODULE_LABELS: Record<ApprovalModule, string> = {
  quote: '报价',
  contract: '合同',
  invoice: '发票',
  order: '订单',
}

export interface ApprovalNodeConfig {
  /** 新实例冻结真实流程节点 ID；历史实例没有该字段时保持兼容。 */
  nodeId?: string
  name: string
  approverType: ApproverType
  approverIds: string[]
  /** Cordys approver node 的抄送成员；进入该节点时生成 CC task。 */
  ccUserIds?: string[]
  mode: ApprovalMode
}

// ============ 流程设置 ============

export type ApprovalFormType = 'quotation' | 'contract' | 'invoice' | 'order'
export type ApprovalExecuteTiming = 'CREATE' | 'UPDATE' | 'DELETE'
export type ApprovalNodeType = 'START' | 'APPROVER' | 'CONDITION' | 'DEFAULT' | 'END'
export type DuplicateApproverRule = 'FIRST_ONLY' | 'SEQUENTIAL_ALL' | 'EACH'

export const APPROVAL_FORM_TYPE_LABELS: Record<ApprovalFormType, string> = {
  quotation: '报价',
  contract: '合同',
  invoice: '发票',
  order: '订单',
}

export const APPROVAL_FORM_TYPE_PREFIXES: Record<ApprovalFormType, string> = {
  quotation: 'QTE-APV',
  contract: 'CTR-APV',
  invoice: 'INV-APV',
  order: 'ORD-APV',
}

export const APPROVAL_EXECUTE_TIMING_LABELS: Record<ApprovalExecuteTiming, string> = {
  CREATE: '新建时执行',
  UPDATE: '编辑时执行',
  DELETE: '删除时执行',
}

export const DUPLICATE_APPROVER_RULE_LABELS: Record<DuplicateApproverRule, string> = {
  FIRST_ONLY: '仅首个节点审批',
  SEQUENTIAL_ALL: '按顺序全部审批',
  EACH: '每个节点均需审批',
}

export interface ApprovalFlowSettings {
  submitterCanRevoke: boolean
  allowBatchProcess: boolean
  allowWithdraw: boolean
  allowAddSign: boolean
  duplicateApproverRule: DuplicateApproverRule
  requireComment: boolean
}

export interface ApprovalFlowNodeInput extends ApprovalNodeConfig {
  /** 前端编辑期稳定键；后端不会将其作为数据库主键。 */
  clientId?: string
}

export interface ApprovalFlowWriteInput extends ApprovalFlowSettings {
  name: string
  formType: ApprovalFormType
  description?: string | null
  enabled: boolean
  createExecute: boolean
  updateExecute: boolean
  deleteExecute: boolean
  condition?: { amountGte?: number } | null
  createNodes: ApprovalFlowNodeInput[]
}

export interface ApprovalFlowListItem extends ApprovalFlowSettings {
  id: string
  number: string
  formType: ApprovalFormType
  name: string
  description: string | null
  enabled: boolean
  createExecute: boolean
  updateExecute: boolean
  deleteExecute: boolean
  currentVersion: number
  runtimeReady: boolean
  createdById: string | null
  createdByName: string | null
  updatedById: string | null
  updatedByName: string | null
  createdAt: string
  updatedAt: string
}

export interface ApprovalFlowNodeDetail {
  id: string
  number: string
  nodeType: ApprovalNodeType
  executeTiming: ApprovalExecuteTiming
  sort: number
  name: string
  approverType?: ApproverType
  approverIds?: string[]
  ccUserIds?: string[]
  mode?: ApprovalMode
}

export interface ApprovalFlowLinkDetail {
  id: string
  fromNodeId: string
  toNodeId: string
  sort: number
}

export interface ApprovalFlowDetail extends ApprovalFlowListItem {
  currentVersionId: string
  condition: { amountGte?: number } | null
  createNodes: ApprovalFlowNodeDetail[]
  createLinks: ApprovalFlowLinkDetail[]
}

export interface ApprovalTaskVO {
  id: string
  instanceId: string
  nodeId: string | null
  nodeIndex: number
  nodeRound: number
  nodeName: string
  approverId: string
  approverName?: string
  taskType: ApprovalTaskType
  status: ApprovalTaskStatus
  action: ApprovalTaskAction | null
  /** 兼容现有时间线，由对应 ApprovalRecord.comment 派生。 */
  comment: string | null
  handledAt: string | null
}

export interface ApprovalRecordVO {
  id: string
  taskId: string
  nodeId: string | null
  nodeRound: number
  result: ApprovalTaskAction
  comment: string | null
  createdById: string
  createdAt: string
}

export interface ApprovalAddSignTaskVO {
  id: string
  taskId: string
  signTaskId: string
  type: ApprovalAddSignType
  rootTaskId: string
  sort: string
  comment: string | null
  createdById: string
  createdAt: string
}

export interface ApprovalReturnBackRecordVO {
  id: string
  taskId: string
  returnToNodeId: string
  returnReason: string | null
  returnUserId: string
  createdAt: string
}

export interface ApprovalReturnBackTargetVO {
  nodeId: string
  nodeIndex: number
  nodeName: string
  nextRound: number
}

export interface ApprovalInstanceAttachmentVO {
  id: string
  elementId: string
  attachment: AttachmentVO
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
  records: ApprovalRecordVO[]
  addSignTasks: ApprovalAddSignTaskVO[]
  returnBackRecords: ApprovalReturnBackRecordVO[]
  returnBackTargets: ApprovalReturnBackTargetVO[]
  approvalAttachments: ApprovalInstanceAttachmentVO[]
  /** 当前审批流是否要求审批意见必填。 */
  requireComment: boolean
  /** 当前用户的当前待办是否允许执行加签。 */
  canAddSign: boolean
  /** 当前用户的普通审批待办是否存在可退回的历史审批节点。 */
  canReturnBack: boolean
  /** 当前用户最近一次已通过普通审批任务是否仍允许撤回。 */
  canWithdraw: boolean
  /** 当前用户待处理的任务 id */
  myPendingTaskId?: string | null
  /** 当前用户当前可撤回的已通过普通审批任务 id。 */
  myWithdrawTaskId?: string | null
}
