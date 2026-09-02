import type {
  ApprovalFlowDetail,
  ApprovalFlowLinkInput,
  ApprovalFlowNodeInput,
  ApprovalFormType,
  FieldVO,
} from '@micromatrix/shared'

export function newFlowClientId(prefix: string) {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.random()}`
}

export function createDefaultApprovalGraph(): {
  createNodes: ApprovalFlowNodeInput[]
  createLinks: ApprovalFlowLinkInput[]
} {
  const start = newFlowClientId('start')
  const approver = newFlowClientId('approver')
  const end = newFlowClientId('end')
  return {
    createNodes: [
      { clientId: start, nodeType: 'START', name: '开始' },
      createApproverNode(approver, '审批节点 1'),
      { clientId: end, nodeType: 'END', name: '结束' },
    ],
    createLinks: [
      { fromNodeId: start, toNodeId: approver, sort: 0 },
      { fromNodeId: approver, toNodeId: end, sort: 0 },
    ],
  }
}

export function createApproverNode(clientId = newFlowClientId('approver'), name = '审批节点'):
  ApprovalFlowNodeInput {
  return {
    clientId,
    nodeType: 'APPROVER',
    name,
    approverType: 'DIRECT_LEADER',
    approverIds: ['1'],
    ccUserIds: [],
    mode: 'ANY',
    emptyApproverAction: 'AUTO_PASS',
    fallbackApprover: null,
    sameSubmitterAction: 'SKIP',
    approverDirection: 'BOTTOM_UP',
    fieldPermissions: [],
  }
}

export function detailGraphToWrite(source: ApprovalFlowDetail) {
  const createNodes: ApprovalFlowNodeInput[] = source.createNodes.map((node) => ({
    clientId: node.id,
    nodeType: node.nodeType,
    number: node.number,
    name: node.name,
    approverType: node.approverType,
    approverIds: [...(node.approverIds ?? [])],
    ccUserIds: [...(node.ccUserIds ?? [])],
    mode: node.mode,
    emptyApproverAction: node.emptyApproverAction,
    fallbackApprover: node.fallbackApprover,
    sameSubmitterAction: node.sameSubmitterAction,
    approverDirection: node.approverDirection,
    fieldPermissions: (node.fieldPermissions ?? []).map((item) => ({ ...item })),
    passPostConfig: node.passPostConfig ? structuredClone(node.passPostConfig) : undefined,
    rejectPostConfig: node.rejectPostConfig ? structuredClone(node.rejectPostConfig) : undefined,
    conditionConfig: node.conditionConfig ? structuredClone(node.conditionConfig) : undefined,
  }))
  const createLinks: ApprovalFlowLinkInput[] = source.createLinks.map((link) => ({
    fromNodeId: link.fromNodeId,
    toNodeId: link.toNodeId,
    sort: link.sort,
  }))
  return { createNodes, createLinks }
}

export function approvalConditionFieldName(field: FieldVO) {
  return field.system ? field.key : field.id
}

const EDITABLE_TYPES = new Set<FieldVO['type']>([
  'text',
  'textarea',
  'number',
  'currency',
  'percent',
  'select',
  'multiselect',
  'date',
  'datetime',
])

const EDITABLE_SYSTEM_KEYS: Record<ApprovalFormType, ReadonlySet<string>> = {
  quotation: new Set(['name', 'untilTime']),
  contract: new Set(['name', 'number', 'startTime', 'endTime']),
  invoice: new Set(['name', 'amount', 'invoiceType', 'taxRate']),
  order: new Set(['name', 'number']),
}

export function isApprovalEditableField(formType: ApprovalFormType, field: FieldVO) {
  if (field.hidden || !EDITABLE_TYPES.has(field.type)) return false
  if (!field.system) return true
  return EDITABLE_SYSTEM_KEYS[formType].has(field.key)
}

export function validateApprovalGraph(
  nodes: ApprovalFlowNodeInput[],
  links: ApprovalFlowLinkInput[],
): string | null {
  if (nodes.length > 100) return '审批节点不能超过 100 个'
  const ids = nodes.map((node) => node.clientId?.trim() || '')
  if (ids.some((id) => !id)) return '流程图每个节点都必须有稳定 ID'
  if (new Set(ids).size !== ids.length) return '流程图存在重复节点 ID'
  const nodeMap = new Map(nodes.map((node) => [node.clientId!, node]))
  const starts = nodes.filter((node) => node.nodeType === 'START')
  const ends = nodes.filter((node) => node.nodeType === 'END')
  if (starts.length !== 1 || ends.length !== 1) return '流程图必须且只能包含一个开始和一个结束节点'
  if (!nodes.some((node) => node.nodeType === 'APPROVER')) return '流程图至少需要一个审批节点'
  if (!links.length) return '流程图必须包含节点连接'

  const outgoing = new Map<string, ApprovalFlowLinkInput[]>()
  const incoming = new Map<string, ApprovalFlowLinkInput[]>()
  const pairs = new Set<string>()
  for (const [index, raw] of links.entries()) {
    if (!nodeMap.has(raw.fromNodeId) || !nodeMap.has(raw.toNodeId)) return '流程图存在指向未知节点的连接'
    if (raw.fromNodeId === raw.toNodeId) return '流程图不允许节点自环'
    const key = `${raw.fromNodeId}\u0000${raw.toNodeId}`
    if (pairs.has(key)) return '流程图存在重复连接'
    pairs.add(key)
    const link = { ...raw, sort: raw.sort ?? index }
    outgoing.set(raw.fromNodeId, [...(outgoing.get(raw.fromNodeId) ?? []), link])
    incoming.set(raw.toNodeId, [...(incoming.get(raw.toNodeId) ?? []), link])
  }

  const startId = starts[0].clientId!
  const endId = ends[0].clientId!
  for (const node of nodes) {
    const id = node.clientId!
    const next = [...(outgoing.get(id) ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    const prev = incoming.get(id) ?? []
    if (id === startId && prev.length) return '开始节点不能存在入边'
    if (id !== startId && prev.length === 0) return `节点「${node.name}」缺少入边`
    if (id === endId && next.length) return '结束节点不能存在出边'
    if (id !== endId && next.length === 0) return `节点「${node.name}」缺少出边`
    if (id === endId) continue
    const targetTypes = next.map((link) => nodeMap.get(link.toNodeId)?.nodeType ?? 'APPROVER')
    const hasCondition = targetTypes.some((type) => type === 'CONDITION')
    if (hasCondition) {
      if (targetTypes.some((type) => type !== 'CONDITION' && type !== 'DEFAULT')) {
        return '条件分支的同层后继只能是条件或默认分支'
      }
      if (targetTypes.filter((type) => type === 'DEFAULT').length !== 1) {
        return '条件分支必须且只能包含一个默认分支'
      }
      const sorts = next.map((link) => link.sort ?? 0)
      if (new Set(sorts).size !== sorts.length) return '同一条件分支的优先级必须唯一'
    } else if (targetTypes.some((type) => type === 'DEFAULT')) {
      return '默认分支必须与至少一个条件分支同层出现'
    } else if (next.length !== 1) {
      return `节点「${node.name}」存在不受支持的并行后继`
    }
  }

  for (const node of nodes) {
    if (!node.name.trim()) return '节点名称不能为空'
    if (node.nodeType === 'CONDITION') {
      const config = node.conditionConfig
      if (!config || !['AND', 'OR'].includes(config.searchMode) || !config.conditions.length) {
        return `条件节点「${node.name}」至少需要一个有效条件`
      }
      for (const condition of config.conditions) {
        if (!condition.name?.trim() || !condition.operator) return `条件节点「${node.name}」存在无效条件`
        if (['EMPTY', 'NOT_EMPTY', 'NOT_EQUAL_ORIGINAL'].includes(condition.operator)) continue
        if (
          condition.value === undefined ||
          condition.value === null ||
          (typeof condition.value === 'string' && !condition.value.trim()) ||
          (Array.isArray(condition.value) && condition.value.length === 0)
        ) return `条件节点「${node.name}」存在缺少比较值的条件`
      }
    }
    if (node.nodeType !== 'APPROVER') continue
    if (!node.approverType || !node.mode) return `节点「${node.name}」缺少审批人配置`
    if (['USER', 'ROLE'].includes(node.approverType) && !(node.approverIds?.length)) {
      return `节点「${node.name}」尚未选择审批对象`
    }
    if ((node.emptyApproverAction ?? 'AUTO_PASS') !== 'AUTO_PASS' && !node.fallbackApprover?.trim()) {
      return `节点「${node.name}」尚未选择空审批人兜底成员`
    }
  }

  const visited = new Set<string>()
  const active = new Set<string>()
  const walk = (id: string): boolean => {
    if (active.has(id)) return false
    if (visited.has(id)) return true
    active.add(id)
    for (const link of outgoing.get(id) ?? []) if (!walk(link.toNodeId)) return false
    active.delete(id)
    visited.add(id)
    return true
  }
  if (!walk(startId)) return '流程图不允许循环连接'
  if (visited.size !== nodes.length) return '流程图存在开始节点不可达的节点'

  const reachesEnd = new Set<string>()
  const reverse = (id: string) => {
    if (reachesEnd.has(id)) return
    reachesEnd.add(id)
    for (const link of incoming.get(id) ?? []) reverse(link.fromNodeId)
  }
  reverse(endId)
  if (reachesEnd.size !== nodes.length) return '流程图存在无法到达结束节点的分支'
  return null
}
