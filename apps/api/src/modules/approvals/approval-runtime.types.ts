export type ApprovalJsonValue = unknown
export type ApprovalInstanceStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED'
export type ApprovalExecuteTiming = 'CREATE' | 'UPDATE' | 'DELETE'
export type ApprovalTaskType = 'APPROVAL' | 'CC' | 'SIGN' | 'BACK'
export type ApprovalTaskStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
export type ApprovalTaskAction = 'APPROVE' | 'REJECT' | 'SIGN' | 'BACK' | null

export interface ApprovalInstanceRuntime {
  id: string
  tenantId: string
  flowId: string | null
  flowVersionId: string | null
  executeTiming: ApprovalExecuteTiming
  module: string
  targetId: string
  targetName: string
  summary: string | null
  status: ApprovalInstanceStatus
  currentNodeIndex: number
  nodesSnapshot: ApprovalJsonValue
  comment: string | null
  updateFields: string | null
  submitterId: string
  submitterName: string
  finishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ApprovalTaskRuntime {
  id: string
  tenantId: string
  instanceId: string
  nodeId: string | null
  nodeIndex: number
  nodeRound: number
  nodeName: string
  approverId: string
  taskType: ApprovalTaskType
  status: ApprovalTaskStatus
  action: ApprovalTaskAction
  handledAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type ApprovalResourceInstance = Pick<
  ApprovalInstanceRuntime,
  'id' | 'tenantId' | 'module' | 'targetId' | 'executeTiming'
>
