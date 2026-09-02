import { randomUUID } from 'node:crypto'

const APPROVER_KEYS = [
  'approverType',
  'approverIds',
  'ccUserIds',
  'mode',
  'emptyApproverAction',
  'fallbackApprover',
  'sameSubmitterAction',
  'approverDirection',
  'fieldPermissions',
  'passPostConfig',
  'rejectPostConfig',
]

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function explicitNodeFromDetail(node) {
  const result = {
    clientId: node.id ?? node.clientId,
    nodeType: node.nodeType ?? 'APPROVER',
    number: node.number,
    name: node.name,
  }
  if (result.nodeType === 'APPROVER') {
    for (const key of APPROVER_KEYS) {
      if (node[key] !== undefined) result[key] = clone(node[key])
    }
  } else if (result.nodeType === 'CONDITION') {
    result.conditionConfig = clone(node.conditionConfig)
  }
  return result
}

export function approvalFlowWriteFromDetail(detail, enabled = detail.enabled) {
  return {
    name: detail.name,
    description: detail.description ?? null,
    enabled,
    createExecute: detail.createExecute,
    updateExecute: detail.updateExecute,
    deleteExecute: detail.deleteExecute,
    submitterCanRevoke: detail.submitterCanRevoke,
    allowBatchProcess: detail.allowBatchProcess,
    allowWithdraw: detail.allowWithdraw,
    allowAddSign: detail.allowAddSign,
    duplicateApproverRule: detail.duplicateApproverRule,
    requireComment: detail.requireComment,
    condition: clone(detail.condition ?? null),
    createNodes: (detail.createNodes ?? []).map(explicitNodeFromDetail),
    createLinks: (detail.createLinks ?? []).map((link) => ({
      fromNodeId: link.fromNodeId,
      toNodeId: link.toNodeId,
      sort: link.sort,
    })),
  }
}

/**
 * 测试夹具可继续用紧凑的审批节点数组描述线性意图，但在真正发 HTTP 前
 * 必须由调用端转换成 START/APPROVER/END + links。服务端不再提供该兼容。
 */
export function explicitApprovalFlow(input) {
  if (
    Array.isArray(input.createLinks) &&
    input.createNodes?.some((node) => node.nodeType === 'START') &&
    input.createNodes?.some((node) => node.nodeType === 'END')
  ) {
    return clone(input)
  }

  const approvers = (input.createNodes ?? []).map((node, index) => ({
    ...clone(node),
    clientId: node.clientId ?? `approver-${index + 1}-${randomUUID()}`,
    nodeType: 'APPROVER',
  }))
  const startId = `start-${randomUUID()}`
  const endId = `end-${randomUUID()}`
  const nodes = [
    { clientId: startId, nodeType: 'START', name: '开始' },
    ...approvers,
    { clientId: endId, nodeType: 'END', name: '结束' },
  ]
  const orderedIds = nodes.map((node) => node.clientId)
  const links = orderedIds.slice(1).map((toNodeId, index) => ({
    fromNodeId: orderedIds[index],
    toNodeId,
    sort: 0,
  }))
  return { ...clone(input), createNodes: nodes, createLinks: links }
}

export function explicitApprovalFlowRequest(path, method, body) {
  if (!body || typeof body !== 'object') return body
  if (method === 'POST' && path === '/approvals/flows') return explicitApprovalFlow(body)
  if (method === 'PUT' && /^\/approvals\/flows\/[^/]+$/.test(path)) return explicitApprovalFlow(body)
  return body
}
