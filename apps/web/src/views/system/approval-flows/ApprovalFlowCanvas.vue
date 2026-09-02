<script setup lang="ts">
import {
  APPROVAL_MODE_LABELS,
  APPROVER_TYPE_LABELS,
  type ApprovalConditionConfig,
  type ApprovalConditionOperator,
  type ApprovalFieldPermissionMode,
  type ApprovalFlowLinkInput,
  type ApprovalFlowNodeInput,
  type ApprovalFormType,
  type ApprovalMode,
  type ApprovalPostConfig,
  type ApprovalWebhookConfig,
  type ApproverDirection,
  type ApproverType,
  type EmptyApproverAction,
  type FieldVO,
  type SameSubmitterAction,
} from '@micromatrix/shared'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import {
  Handle,
  MarkerType,
  Position,
  VueFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeDragEvent,
} from '@vue-flow/core'
import {
  GitBranch,
  GitFork,
  Link2Off,
  Play,
  Plus,
  RefreshCw,
  Route,
  Square,
  Trash2,
  Webhook,
} from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { approvalApi } from '@/api/approvals'
import { extractErrorMessage } from '@/api/http'
import type { MemberOption, RoleOption } from '@/api/system'
import {
  approvalConditionFieldName,
  createApproverNode,
  isApprovalEditableField,
  newFlowClientId,
} from './approval-flow-graph'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

interface CanvasNodeData {
  kind: 'start' | 'approver' | 'condition' | 'default' | 'end'
  label: string
  detail: string
  clientId: string
}

type PostAction = 'pass' | 'reject'

const props = defineProps<{
  readonly?: boolean
  formType: ApprovalFormType
  members: MemberOption[]
  roles: RoleOption[]
  fields: FieldVO[]
}>()

const nodesModel = defineModel<ApprovalFlowNodeInput[]>('nodes', { required: true })
const linksModel = defineModel<ApprovalFlowLinkInput[]>('links', { required: true })
const selectedClientId = ref<string | null>(null)
const positions = ref<Record<string, { x: number; y: number }>>({})
const postAction = ref<PostAction>('pass')
const testingWebhook = ref(false)

const hierarchyTypes = new Set<ApproverType>([
  'DIRECT_LEADER',
  'DEPT_LEADER',
  'MULTIPLE_DIRECT_LEADER',
  'MULTIPLE_DEPT_LEADER',
])

const conditionOperatorOptions: Array<{ value: ApprovalConditionOperator; label: string }> = [
  { value: 'EQUALS', label: '等于' },
  { value: 'NOT_EQUALS', label: '不等于' },
  { value: 'IN', label: '属于任一值' },
  { value: 'NOT_IN', label: '不属于任一值' },
  { value: 'BETWEEN', label: '介于' },
  { value: 'GT', label: '大于' },
  { value: 'GE', label: '大于等于' },
  { value: 'LT', label: '小于' },
  { value: 'LE', label: '小于等于' },
  { value: 'CONTAINS', label: '包含' },
  { value: 'NOT_CONTAINS', label: '不包含' },
  { value: 'EMPTY', label: '为空' },
  { value: 'NOT_EMPTY', label: '不为空' },
  { value: 'NOT_EQUAL_ORIGINAL', label: '本次编辑发生变化' },
]

const noValueOperators = new Set<ApprovalConditionOperator>([
  'EMPTY',
  'NOT_EMPTY',
  'NOT_EQUAL_ORIGINAL',
])

function nodeType(node: ApprovalFlowNodeInput) {
  return node.nodeType ?? 'APPROVER'
}

function nodeMap() {
  return new Map(nodesModel.value.map((node) => [node.clientId!, node]))
}

function approverSummary(node: ApprovalFlowNodeInput) {
  const approverType = node.approverType ?? 'USER'
  const approverIds = node.approverIds ?? []
  if (approverType === 'USER') {
    const names = approverIds
      .map((id) => props.members.find((item) => item.id === id)?.name)
      .filter(Boolean)
    return names.length ? names.join('、') : '未选择成员'
  }
  if (approverType === 'ROLE') {
    const names = approverIds
      .map((id) => props.roles.find((item) => item.id === id)?.name)
      .filter(Boolean)
    return names.length ? names.join('、') : '未选择角色'
  }
  const level = node.approverIds?.[0] ?? '1'
  return `${APPROVER_TYPE_LABELS[approverType]} · ${level} 级`
}

function nodeDetail(node: ApprovalFlowNodeInput) {
  const type = nodeType(node)
  if (type === 'START') return '提交单据后进入流程'
  if (type === 'END') return '所有命中路径完成后结束'
  if (type === 'DEFAULT') return '条件均未命中时进入'
  if (type === 'CONDITION') {
    const count = node.conditionConfig?.conditions.length ?? 0
    return `${node.conditionConfig?.searchMode ?? 'AND'} · ${count} 条条件`
  }
  return `${approverSummary(node)} · ${APPROVAL_MODE_LABELS[node.mode ?? 'ANY']}`
}

function calculateLayout() {
  const nodes = nodesModel.value
  const ids = nodes.map((node) => node.clientId!).filter(Boolean)
  const indegree = new Map(ids.map((id) => [id, 0]))
  const outgoing = new Map<string, ApprovalFlowLinkInput[]>()
  for (const link of linksModel.value) {
    indegree.set(link.toNodeId, (indegree.get(link.toNodeId) ?? 0) + 1)
    outgoing.set(link.fromNodeId, [...(outgoing.get(link.fromNodeId) ?? []), link])
  }
  const start = nodes.find((node) => node.nodeType === 'START')?.clientId
  const levels = new Map<string, number>()
  if (start) levels.set(start, 0)
  const queue = start ? [start] : ids.filter((id) => (indegree.get(id) ?? 0) === 0)
  while (queue.length) {
    const id = queue.shift()!
    const level = levels.get(id) ?? 0
    for (const link of outgoing.get(id) ?? []) {
      levels.set(link.toNodeId, Math.max(levels.get(link.toNodeId) ?? 0, level + 1))
      indegree.set(link.toNodeId, (indegree.get(link.toNodeId) ?? 1) - 1)
      if ((indegree.get(link.toNodeId) ?? 0) <= 0) queue.push(link.toNodeId)
    }
  }
  ids.forEach((id) => {
    if (!levels.has(id)) levels.set(id, 0)
  })
  const byLevel = new Map<number, string[]>()
  for (const id of ids) {
    const level = levels.get(id) ?? 0
    byLevel.set(level, [...(byLevel.get(level) ?? []), id])
  }
  const next: Record<string, { x: number; y: number }> = {}
  for (const [level, levelIds] of [...byLevel.entries()].sort(([a], [b]) => a - b)) {
    const width = Math.max(0, levelIds.length - 1) * 300
    levelIds.forEach((id, index) => {
      next[id] = { x: 120 + index * 300 - width / 2, y: 40 + level * 165 }
    })
  }
  positions.value = next
}

watch(
  () => `${nodesModel.value.map((node) => node.clientId).join('|')}::${linksModel.value.length}`,
  () => {
    const known = new Set(Object.keys(positions.value))
    const current = new Set(nodesModel.value.map((node) => node.clientId!).filter(Boolean))
    if (!current.size || [...current].some((id) => !known.has(id)) || [...known].some((id) => !current.has(id))) {
      calculateLayout()
    }
    if (selectedClientId.value && !current.has(selectedClientId.value)) selectedClientId.value = null
  },
  { immediate: true },
)

const graphNodes = computed<Node<CanvasNodeData>[]>(() =>
  nodesModel.value.map((node, index) => {
    const type = nodeType(node)
    const id = node.clientId ?? `node-${index}`
    return {
      id,
      type: 'process',
      position: positions.value[id] ?? { x: 80, y: 40 + index * 150 },
      draggable: !props.readonly,
      selectable: false,
      data: {
        kind: type.toLowerCase() as CanvasNodeData['kind'],
        label: node.name || type,
        detail: nodeDetail(node),
        clientId: id,
      },
    }
  }),
)

const graphEdges = computed<Edge[]>(() => {
  const map = nodeMap()
  return linksModel.value.map((link, index) => {
    const targetType = nodeType(map.get(link.toNodeId) ?? { name: '' })
    const sourceBranches = linksModel.value
      .filter((item) => item.fromNodeId === link.fromNodeId)
      .some((item) => {
        const type = nodeType(map.get(item.toNodeId) ?? { name: '' })
        return type === 'CONDITION' || type === 'DEFAULT'
      })
    return {
      id: `edge-${link.fromNodeId}-${link.toNodeId}-${index}`,
      source: link.fromNodeId,
      target: link.toNodeId,
      markerEnd: MarkerType.ArrowClosed,
      label: sourceBranches ? (targetType === 'DEFAULT' ? '默认' : `条件 ${(link.sort ?? 0) + 1}`) : undefined,
    }
  })
})

const selectedIndex = computed(() =>
  nodesModel.value.findIndex((node) => node.clientId === selectedClientId.value),
)
const selectedNode = computed(() =>
  selectedIndex.value >= 0 ? nodesModel.value[selectedIndex.value] : null,
)
const selectedIncoming = computed(() =>
  linksModel.value.filter((link) => link.toNodeId === selectedClientId.value),
)
const selectedOutgoing = computed(() =>
  linksModel.value.filter((link) => link.fromNodeId === selectedClientId.value),
)

function updateSelected(patch: Partial<ApprovalFlowNodeInput>) {
  if (selectedIndex.value < 0) return
  const next = [...nodesModel.value]
  next[selectedIndex.value] = { ...next[selectedIndex.value], ...patch }
  nodesModel.value = next
}

function selectNode(id: string) {
  selectedClientId.value = id
}

function addNode(type: 'APPROVER' | 'CONDITION' | 'DEFAULT') {
  if (props.readonly) return
  const id = newFlowClientId(type.toLowerCase())
  let node: ApprovalFlowNodeInput
  if (type === 'APPROVER') {
    const count = nodesModel.value.filter((item) => nodeType(item) === 'APPROVER').length + 1
    node = createApproverNode(id, `审批节点 ${count}`)
  } else if (type === 'CONDITION') {
    node = {
      clientId: id,
      nodeType: 'CONDITION',
      name: '条件分支',
      conditionConfig: {
        searchMode: 'AND',
        conditions: [{
          name: props.fields[0] ? approvalConditionFieldName(props.fields[0]) : '',
          operator: 'EQUALS',
          value: '',
        }],
      },
    }
  } else {
    node = { clientId: id, nodeType: 'DEFAULT', name: '默认分支' }
  }
  nodesModel.value = [...nodesModel.value, node]
  selectedClientId.value = id
  calculateLayout()
}

function wouldCreateCycle(source: string, target: string) {
  const outgoing = new Map<string, string[]>()
  for (const link of linksModel.value) {
    outgoing.set(link.fromNodeId, [...(outgoing.get(link.fromNodeId) ?? []), link.toNodeId])
  }
  const stack = [target]
  const visited = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === source) return true
    if (visited.has(id)) continue
    visited.add(id)
    stack.push(...(outgoing.get(id) ?? []))
  }
  return false
}

function normalizeOutgoingSort(sourceId: string) {
  const own = linksModel.value
    .filter((link) => link.fromNodeId === sourceId)
    .sort((left, right) => (left.sort ?? 0) - (right.sort ?? 0))
  const sortMap = new Map(own.map((link, index) => [link.toNodeId, index]))
  linksModel.value = linksModel.value.map((link) =>
    link.fromNodeId === sourceId ? { ...link, sort: sortMap.get(link.toNodeId) ?? 0 } : link,
  )
}

function handleConnect(connection: Connection) {
  if (props.readonly || !connection.source || !connection.target) return
  const source = connection.source
  const target = connection.target
  const map = nodeMap()
  const sourceNode = map.get(source)
  const targetNode = map.get(target)
  if (!sourceNode || !targetNode) return
  if (source === target) return ElMessage.warning('流程节点不能连接到自身')
  if (nodeType(sourceNode) === 'END') return ElMessage.warning('结束节点不能创建出边')
  if (nodeType(targetNode) === 'START') return ElMessage.warning('开始节点不能创建入边')
  if (linksModel.value.some((link) => link.fromNodeId === source && link.toNodeId === target)) {
    return ElMessage.warning('该连接已存在')
  }
  if (wouldCreateCycle(source, target)) return ElMessage.warning('流程图不允许形成循环')

  const outgoing = linksModel.value.filter((link) => link.fromNodeId === source)
  const existingTypes = outgoing.map((link) => nodeType(map.get(link.toNodeId) ?? { name: '' }))
  const targetType = nodeType(targetNode)
  const branchTypes = new Set(['CONDITION', 'DEFAULT'])
  if (outgoing.length) {
    const isBranchSet = existingTypes.every((type) => branchTypes.has(type))
    if (!isBranchSet || !branchTypes.has(targetType)) {
      return ElMessage.warning('普通节点只能有一个后继；多分支只能连接 CONDITION / DEFAULT')
    }
    if (targetType === 'DEFAULT' && existingTypes.includes('DEFAULT')) {
      return ElMessage.warning('同一条件组只能有一个默认分支')
    }
  }
  linksModel.value = [...linksModel.value, { fromNodeId: source, toNodeId: target, sort: outgoing.length }]
  normalizeOutgoingSort(source)
  calculateLayout()
}

function deleteLink(link: ApprovalFlowLinkInput) {
  if (props.readonly) return
  linksModel.value = linksModel.value.filter(
    (item) => !(item.fromNodeId === link.fromNodeId && item.toNodeId === link.toNodeId),
  )
  normalizeOutgoingSort(link.fromNodeId)
}

function removeSelected() {
  const node = selectedNode.value
  if (!node || props.readonly) return
  const type = nodeType(node)
  if (type === 'START' || type === 'END') return ElMessage.warning('开始/结束节点不能删除')
  const id = node.clientId!
  nodesModel.value = nodesModel.value.filter((item) => item.clientId !== id)
  linksModel.value = linksModel.value.filter((link) => link.fromNodeId !== id && link.toNodeId !== id)
  selectedClientId.value = null
  calculateLayout()
}

function handleNodeDragStop({ node }: NodeDragEvent) {
  positions.value = { ...positions.value, [node.id]: { ...node.position } }
}

function changeApproverType(value: string) {
  const approverType = value as ApproverType
  updateSelected({ approverType, approverIds: hierarchyTypes.has(approverType) ? ['1'] : [] })
}

function changeMode(value: string) {
  updateSelected({ mode: value as ApprovalMode })
}

function changeHierarchyLevel(value: number) {
  updateSelected({ approverIds: [String(value)] })
}

function fieldPermission(field: FieldVO): ApprovalFieldPermissionMode {
  if (field.hidden) return 'HIDDEN'
  return selectedNode.value?.fieldPermissions?.find((item) => item.fieldId === field.id)?.permissionType ?? 'VIEW'
}

function setFieldPermission(field: FieldVO, permissionType: ApprovalFieldPermissionMode) {
  const current = (selectedNode.value?.fieldPermissions ?? []).filter((item) => item.fieldId !== field.id)
  if (permissionType !== 'VIEW' || field.hidden) current.push({ fieldId: field.id, permissionType })
  updateSelected({ fieldPermissions: current })
}

function postKey(action: PostAction): 'passPostConfig' | 'rejectPostConfig' {
  return action === 'pass' ? 'passPostConfig' : 'rejectPostConfig'
}

function defaultWebhook(): ApprovalWebhookConfig {
  return {
    webHookEnable: false,
    webHookUrl: '',
    webHookMethod: 'POST',
    webHookHeader: '{"Content-Type":"application/json"}',
    webHookBody: '{}',
    webHookDescribe: '',
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function currentPostConfig(action = postAction.value): ApprovalPostConfig {
  const key = postKey(action)
  const value = selectedNode.value?.[key]
  return value ? cloneJson(value) : { fieldUpdateConfigs: [] }
}

function setPostConfig(action: PostAction, config: ApprovalPostConfig) {
  const key = postKey(action)
  updateSelected(key === 'passPostConfig' ? { passPostConfig: config } : { rejectPostConfig: config })
}

function addPostField() {
  const editable = props.fields.find((field) => isApprovalEditableField(props.formType, field))
  if (!editable) return ElMessage.warning('当前表单没有可用于审批后置更新的字段')
  const config = currentPostConfig()
  config.fieldUpdateConfigs.push({ fieldId: editable.id, fieldValue: '', enable: true })
  setPostConfig(postAction.value, config)
}

function updatePostField(index: number, patch: Partial<ApprovalPostConfig['fieldUpdateConfigs'][number]>) {
  const config = currentPostConfig()
  config.fieldUpdateConfigs[index] = { ...config.fieldUpdateConfigs[index], ...patch }
  setPostConfig(postAction.value, config)
}

function removePostField(index: number) {
  const config = currentPostConfig()
  config.fieldUpdateConfigs.splice(index, 1)
  setPostConfig(postAction.value, config)
}

function webhookConfig(): ApprovalWebhookConfig {
  return currentPostConfig().webHookConfig ?? defaultWebhook()
}

function updateWebhook(patch: Partial<ApprovalWebhookConfig>) {
  const config = currentPostConfig()
  config.webHookConfig = { ...(config.webHookConfig ?? defaultWebhook()), ...patch }
  setPostConfig(postAction.value, config)
}

async function testWebhook() {
  const config = webhookConfig()
  if (!config.webHookEnable) return ElMessage.warning('请先启用 Webhook')
  testingWebhook.value = true
  try {
    const { data } = await approvalApi.testWebhook(config)
    ElMessage.success(`连接成功 · HTTP ${data.httpStatus} · ${data.durationMs}ms`)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    testingWebhook.value = false
  }
}

function conditionField(fieldName: string) {
  return props.fields.find((field) => approvalConditionFieldName(field) === fieldName)
}

function parseConditionValue(fieldName: string, operator: ApprovalConditionOperator, raw: string) {
  if (noValueOperators.has(operator)) return undefined
  const field = conditionField(fieldName)
  const parseScalar = (value: string): unknown => {
    const trimmed = value.trim()
    if (field && ['number', 'currency', 'percent'].includes(field.type)) {
      const number = Number(trimmed)
      return Number.isFinite(number) ? number : trimmed
    }
    return trimmed
  }
  if (operator === 'IN' || operator === 'NOT_IN') {
    return raw.split(',').map(parseScalar).filter((item) => item !== '')
  }
  if (operator === 'BETWEEN') return raw.split(',').slice(0, 2).map(parseScalar)
  return parseScalar(raw)
}

function conditionValueText(value: unknown) {
  return Array.isArray(value) ? value.join(',') : value === undefined || value === null ? '' : String(value)
}

function clonedConditionConfig(): ApprovalConditionConfig {
  return cloneJson(
    selectedNode.value?.conditionConfig ?? { searchMode: 'AND', conditions: [] },
  )
}

function updateConditionSearchMode(searchMode: 'AND' | 'OR') {
  const config = clonedConditionConfig()
  config.searchMode = searchMode
  updateSelected({ conditionConfig: config })
}

function updateCondition(index: number, patch: Partial<{ name: string; operator: ApprovalConditionOperator; value: unknown }>) {
  const config = clonedConditionConfig()
  config.conditions[index] = { ...config.conditions[index], ...patch }
  if (patch.operator && noValueOperators.has(patch.operator)) delete config.conditions[index].value
  updateSelected({ conditionConfig: config })
}

function updateConditionValue(index: number, raw: string) {
  const condition = selectedNode.value?.conditionConfig?.conditions[index]
  if (!condition) return
  updateCondition(index, { value: parseConditionValue(condition.name, condition.operator, raw) })
}

function addCondition() {
  const field = props.fields[0]
  const config = clonedConditionConfig()
  config.conditions.push({
    name: field ? approvalConditionFieldName(field) : '',
    operator: 'EQUALS',
    value: '',
  })
  updateSelected({ conditionConfig: config })
}

function removeCondition(index: number) {
  const config = clonedConditionConfig()
  config.conditions.splice(index, 1)
  updateSelected({ conditionConfig: config })
}

function moveBranch(direction: -1 | 1) {
  const node = selectedNode.value
  if (!node || !['CONDITION', 'DEFAULT'].includes(nodeType(node)) || selectedIncoming.value.length !== 1) return
  const incoming = selectedIncoming.value[0]
  const siblings = linksModel.value
    .filter((link) => link.fromNodeId === incoming.fromNodeId)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  const index = siblings.findIndex((link) => link.toNodeId === node.clientId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= siblings.length) return
  ;[siblings[index], siblings[target]] = [siblings[target], siblings[index]]
  const order = new Map(siblings.map((link, sort) => [link.toNodeId, sort]))
  linksModel.value = linksModel.value.map((link) =>
    link.fromNodeId === incoming.fromNodeId ? { ...link, sort: order.get(link.toNodeId) ?? 0 } : link,
  )
}

function connectionName(id: string) {
  return nodesModel.value.find((node) => node.clientId === id)?.name ?? id
}
</script>

<template>
  <div class="flow-editor" data-testid="approval-flow-canvas">
    <div class="flow-toolbar">
      <div>
        <div class="font-medium">审批流程图</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          拖动节点调整布局；从节点底部连接点拖到目标顶部连接点。保存时校验完整可执行图。
        </div>
      </div>
      <div v-if="!readonly" class="flex flex-wrap gap-2">
        <el-button :icon="Plus" data-testid="flow-add-approver" @click="addNode('APPROVER')">审批节点</el-button>
        <el-button :icon="GitFork" data-testid="flow-add-condition" @click="addNode('CONDITION')">条件分支</el-button>
        <el-button :icon="Route" data-testid="flow-add-default" @click="addNode('DEFAULT')">默认分支</el-button>
        <el-button :icon="RefreshCw" @click="calculateLayout">自动布局</el-button>
      </div>
    </div>

    <div class="flow-workspace">
      <VueFlow
        :nodes="graphNodes"
        :edges="graphEdges"
        :nodes-connectable="!readonly"
        :nodes-draggable="!readonly"
        :elements-selectable="false"
        fit-view-on-init
        :min-zoom="0.35"
        :max-zoom="1.6"
        class="flow-canvas"
        @connect="handleConnect"
        @node-drag-stop="handleNodeDragStop"
      >
        <Background :gap="18" :size="1" pattern-color="#d9dee8" />
        <Controls :show-interactive="false" position="bottom-left" />
        <template #node-process="{ data }">
          <div
            class="process-node"
            :class="[`process-node--${data.kind}`, { 'is-selected': data.clientId === selectedClientId }]"
            :data-node-id="data.clientId"
            @click="selectNode(data.clientId)"
          >
            <Handle v-if="data.kind !== 'start'" type="target" :position="Position.Top" />
            <span class="process-node__icon">
              <Play v-if="data.kind === 'start'" :size="16" />
              <GitBranch v-else-if="data.kind === 'approver'" :size="16" />
              <GitFork v-else-if="data.kind === 'condition'" :size="16" />
              <Route v-else-if="data.kind === 'default'" :size="16" />
              <Square v-else :size="15" />
            </span>
            <span class="min-w-0 text-left">
              <strong>{{ data.label }}</strong>
              <small>{{ data.detail }}</small>
            </span>
            <Handle v-if="data.kind !== 'end'" type="source" :position="Position.Bottom" />
          </div>
        </template>
      </VueFlow>

      <aside class="node-inspector">
        <template v-if="selectedNode">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="font-medium">节点配置</div>
              <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">{{ selectedNode.nodeType }}</div>
            </div>
            <el-button
              v-if="!readonly && !['START', 'END'].includes(selectedNode.nodeType ?? 'APPROVER')"
              type="danger"
              plain
              :icon="Trash2"
              circle
              @click="removeSelected"
            />
          </div>

          <template v-if="selectedNode.nodeType === 'START' || selectedNode.nodeType === 'END'">
            <el-empty
              :image-size="64"
              :description="selectedNode.nodeType === 'START' ? '开始节点固定为流程唯一入口' : '结束节点固定为流程唯一出口'"
            />
          </template>

          <template v-else-if="selectedNode.nodeType === 'CONDITION'">
            <el-form label-position="top" class="mt-4">
              <el-form-item label="分支名称">
                <el-input
                  :model-value="selectedNode.name"
                  :disabled="readonly"
                  maxlength="255"
                  @update:model-value="(value: string) => updateSelected({ name: value })"
                />
              </el-form-item>
              <el-form-item label="条件关系">
                <el-radio-group
                  :model-value="selectedNode.conditionConfig?.searchMode ?? 'AND'"
                  :disabled="readonly"
                  @update:model-value="(value) => updateConditionSearchMode(value as 'AND' | 'OR')"
                >
                  <el-radio-button value="AND">全部满足</el-radio-button>
                  <el-radio-button value="OR">任一满足</el-radio-button>
                </el-radio-group>
              </el-form-item>
              <div class="condition-list">
                <div
                  v-for="(condition, index) in selectedNode.conditionConfig?.conditions ?? []"
                  :key="index"
                  class="condition-row"
                >
                  <el-select
                    :model-value="condition.name"
                    :disabled="readonly"
                    filterable
                    @change="(value: string) => updateCondition(index, { name: value })"
                  >
                    <el-option
                      v-for="field in fields"
                      :key="field.id"
                      :label="field.label"
                      :value="approvalConditionFieldName(field)"
                    />
                  </el-select>
                  <el-select
                    :model-value="condition.operator"
                    :disabled="readonly"
                    @change="(value: ApprovalConditionOperator) => updateCondition(index, { operator: value })"
                  >
                    <el-option v-for="item in conditionOperatorOptions" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                  <el-input
                    v-if="!noValueOperators.has(condition.operator)"
                    :model-value="conditionValueText(condition.value)"
                    :disabled="readonly"
                    :placeholder="condition.operator === 'BETWEEN' ? '起始值,结束值' : ['IN','NOT_IN'].includes(condition.operator) ? '多个值用逗号分隔' : '比较值'"
                    @update:model-value="(value: string) => updateConditionValue(index, value)"
                  />
                  <el-button v-if="!readonly" type="danger" text :icon="Trash2" @click="removeCondition(index)" />
                </div>
              </div>
              <el-button v-if="!readonly" class="mt-2" :icon="Plus" @click="addCondition">添加条件</el-button>
              <div v-if="selectedIncoming.length === 1" class="mt-4 flex items-center gap-2 text-sm">
                <span>分支优先级：{{ (selectedIncoming[0].sort ?? 0) + 1 }}</span>
                <el-button size="small" :disabled="readonly || (selectedIncoming[0].sort ?? 0) === 0" @click="moveBranch(-1)">上移</el-button>
                <el-button size="small" :disabled="readonly" @click="moveBranch(1)">下移</el-button>
              </div>
            </el-form>
          </template>

          <template v-else-if="selectedNode.nodeType === 'DEFAULT'">
            <el-form label-position="top" class="mt-4">
              <el-form-item label="分支名称">
                <el-input
                  :model-value="selectedNode.name"
                  :disabled="readonly"
                  maxlength="255"
                  @update:model-value="(value: string) => updateSelected({ name: value })"
                />
              </el-form-item>
              <el-alert
                type="info"
                :closable="false"
                title="默认分支没有条件"
                description="同级 CONDITION 均不命中时进入该分支；同一条件组必须且只能存在一个 DEFAULT。"
              />
              <div v-if="selectedIncoming.length === 1" class="mt-4 flex items-center gap-2 text-sm">
                <span>分支优先级：{{ (selectedIncoming[0].sort ?? 0) + 1 }}</span>
                <el-button size="small" :disabled="readonly || (selectedIncoming[0].sort ?? 0) === 0" @click="moveBranch(-1)">上移</el-button>
                <el-button size="small" :disabled="readonly" @click="moveBranch(1)">下移</el-button>
              </div>
            </el-form>
          </template>

          <template v-else>
            <el-form label-position="top" class="mt-4">
              <el-form-item label="节点名称">
                <el-input
                  :model-value="selectedNode.name"
                  :disabled="readonly"
                  maxlength="255"
                  @update:model-value="(value: string) => updateSelected({ name: value })"
                />
              </el-form-item>
              <el-form-item label="审批人类型">
                <el-select :model-value="selectedNode.approverType" :disabled="readonly" class="w-full" @change="changeApproverType">
                  <el-option v-for="(label, value) in APPROVER_TYPE_LABELS" :key="value" :label="label" :value="value" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="selectedNode.approverType === 'USER'" label="指定成员">
                <el-select
                  :model-value="selectedNode.approverIds ?? []"
                  :disabled="readonly"
                  multiple
                  filterable
                  class="w-full"
                  @update:model-value="(value: string[]) => updateSelected({ approverIds: value })"
                >
                  <el-option v-for="item in members" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item v-else-if="selectedNode.approverType === 'ROLE'" label="指定角色">
                <el-select
                  :model-value="selectedNode.approverIds ?? []"
                  :disabled="readonly"
                  multiple
                  class="w-full"
                  @update:model-value="(value: string[]) => updateSelected({ approverIds: value })"
                >
                  <el-option v-for="item in roles" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <template v-else-if="selectedNode.approverType && hierarchyTypes.has(selectedNode.approverType)">
                <div class="grid grid-cols-2 gap-2">
                  <el-form-item label="审批方向">
                    <el-select
                      :model-value="selectedNode.approverDirection ?? 'BOTTOM_UP'"
                      :disabled="readonly"
                      @change="(value: ApproverDirection) => updateSelected({ approverDirection: value })"
                    >
                      <el-option label="由近到远" value="BOTTOM_UP" />
                      <el-option label="由远到近" value="TOP_DOWN" />
                    </el-select>
                  </el-form-item>
                  <el-form-item label="层级">
                    <el-select
                      :model-value="Number(selectedNode.approverIds?.[0] ?? 1)"
                      :disabled="readonly"
                      @change="changeHierarchyLevel"
                    >
                      <el-option v-for="level in 10" :key="level" :label="`${level} 级`" :value="level" />
                    </el-select>
                  </el-form-item>
                </div>
              </template>
              <el-form-item label="多人审批方式">
                <el-select :model-value="selectedNode.mode ?? 'ANY'" :disabled="readonly" class="w-full" @change="changeMode">
                  <el-option v-for="(label, value) in APPROVAL_MODE_LABELS" :key="value" :label="label" :value="value" />
                </el-select>
              </el-form-item>
              <el-form-item label="抄送成员">
                <el-select
                  :model-value="selectedNode.ccUserIds ?? []"
                  :disabled="readonly"
                  multiple
                  filterable
                  clearable
                  class="w-full"
                  @update:model-value="(value: string[]) => updateSelected({ ccUserIds: value })"
                >
                  <el-option v-for="item in members" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="审批人为空时">
                <el-select
                  :model-value="selectedNode.emptyApproverAction ?? 'AUTO_PASS'"
                  :disabled="readonly"
                  class="w-full"
                  @change="(value: EmptyApproverAction) => updateSelected({ emptyApproverAction: value, ...(value === 'AUTO_PASS' ? { fallbackApprover: null } : {}) })"
                >
                  <el-option label="自动通过" value="AUTO_PASS" />
                  <el-option label="转指定成员" value="ASSIGN_SPECIFIC" />
                  <el-option label="转指定管理员" value="ASSIGN_ADMIN" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="(selectedNode.emptyApproverAction ?? 'AUTO_PASS') !== 'AUTO_PASS'" label="兜底成员">
                <el-select
                  :model-value="selectedNode.fallbackApprover"
                  :disabled="readonly"
                  filterable
                  class="w-full"
                  @update:model-value="(value: string) => updateSelected({ fallbackApprover: value })"
                >
                  <el-option v-for="item in members" :key="item.id" :label="item.name" :value="item.id" />
                </el-select>
              </el-form-item>
              <el-form-item label="审批人与提交人相同时">
                <el-select
                  :model-value="selectedNode.sameSubmitterAction ?? 'SKIP'"
                  :disabled="readonly"
                  class="w-full"
                  @change="(value: SameSubmitterAction) => updateSelected({ sameSubmitterAction: value })"
                >
                  <el-option label="自动通过" value="SKIP" />
                  <el-option label="允许本人审批" value="ALLOW" />
                  <el-option label="转直属上级" value="ASSIGN_SUPERIOR" />
                </el-select>
              </el-form-item>
            </el-form>

            <div class="inspector-section-title">字段权限</div>
            <div class="field-permission-list">
              <div v-for="field in fields" :key="field.id" class="field-permission-row">
                <div class="min-w-0">
                  <strong>{{ field.label }}</strong><small>{{ field.key }}</small>
                </div>
                <el-radio-group
                  :model-value="fieldPermission(field)"
                  :disabled="readonly"
                  size="small"
                  @update:model-value="(value) => setFieldPermission(field, value as ApprovalFieldPermissionMode)"
                >
                  <el-radio-button value="HIDDEN">隐藏</el-radio-button>
                  <el-radio-button value="VIEW" :disabled="field.hidden">只读</el-radio-button>
                  <el-radio-button value="EDIT" :disabled="!isApprovalEditableField(formType, field)">编辑</el-radio-button>
                </el-radio-group>
              </div>
            </div>

            <div class="inspector-section-title mt-5">审批后动作</div>
            <el-segmented
              v-model="postAction"
              :options="[{ label: '通过后', value: 'pass' }, { label: '驳回后', value: 'reject' }]"
              class="w-full"
            />
            <div class="mt-4 flex items-center justify-between">
              <span class="text-sm font-medium">字段更新</span>
              <el-button v-if="!readonly" size="small" :icon="Plus" @click="addPostField">添加</el-button>
            </div>
            <div class="post-field-list mt-2">
              <div v-for="(item, index) in currentPostConfig().fieldUpdateConfigs" :key="index" class="post-field-row">
                <el-switch
                  :model-value="item.enable"
                  :disabled="readonly"
                  @update:model-value="(value) => updatePostField(index, { enable: Boolean(value) })"
                />
                <el-select
                  :model-value="item.fieldId"
                  :disabled="readonly"
                  filterable
                  @change="(value: string) => updatePostField(index, { fieldId: value })"
                >
                  <el-option
                    v-for="field in fields.filter((field) => isApprovalEditableField(formType, field))"
                    :key="field.id"
                    :label="field.label"
                    :value="field.id"
                  />
                </el-select>
                <el-input
                  :model-value="item.fieldValue == null ? '' : String(item.fieldValue)"
                  :disabled="readonly"
                  placeholder="更新值"
                  @update:model-value="(value: string) => updatePostField(index, { fieldValue: value })"
                />
                <el-button v-if="!readonly" type="danger" text :icon="Trash2" @click="removePostField(index)" />
              </div>
              <el-empty v-if="currentPostConfig().fieldUpdateConfigs.length === 0" :image-size="48" description="未配置字段更新" />
            </div>

            <div class="mt-5 flex items-center justify-between">
              <span class="flex items-center gap-2 text-sm font-medium"><Webhook :size="15" />Webhook</span>
              <el-switch
                :model-value="webhookConfig().webHookEnable"
                :disabled="readonly"
                @update:model-value="(value) => updateWebhook({ webHookEnable: Boolean(value) })"
              />
            </div>
            <el-form label-position="top" class="mt-3">
              <div class="grid grid-cols-[110px_1fr] gap-2">
                <el-form-item label="Method">
                  <el-select
                    :model-value="webhookConfig().webHookMethod"
                    :disabled="readonly"
                    @change="(value: 'GET' | 'POST') => updateWebhook({ webHookMethod: value })"
                  >
                    <el-option label="GET" value="GET" />
                    <el-option label="POST" value="POST" />
                  </el-select>
                </el-form-item>
                <el-form-item label="URL">
                  <el-input
                    :model-value="webhookConfig().webHookUrl"
                    :disabled="readonly"
                    placeholder="https://..."
                    @update:model-value="(value: string) => updateWebhook({ webHookUrl: value })"
                  />
                </el-form-item>
              </div>
              <el-form-item label="请求头 JSON">
                <el-input
                  :model-value="webhookConfig().webHookHeader"
                  :disabled="readonly"
                  type="textarea"
                  :rows="2"
                  @update:model-value="(value: string) => updateWebhook({ webHookHeader: value })"
                />
              </el-form-item>
              <el-form-item v-if="webhookConfig().webHookMethod === 'POST'" label="请求体 JSON">
                <el-input
                  :model-value="webhookConfig().webHookBody"
                  :disabled="readonly"
                  type="textarea"
                  :rows="3"
                  placeholder='{"id":"${order.id}"}'
                  @update:model-value="(value: string) => updateWebhook({ webHookBody: value })"
                />
              </el-form-item>
              <el-form-item label="说明">
                <el-input
                  :model-value="webhookConfig().webHookDescribe"
                  :disabled="readonly"
                  maxlength="500"
                  @update:model-value="(value: string) => updateWebhook({ webHookDescribe: value })"
                />
              </el-form-item>
              <el-button v-if="!readonly" :loading="testingWebhook" @click="testWebhook">测试连接</el-button>
            </el-form>
          </template>

          <div class="inspector-section-title mt-5">连接</div>
          <div class="connection-list">
            <div v-for="link in selectedIncoming" :key="`in-${link.fromNodeId}`" class="connection-row">
              <span>来自：{{ connectionName(link.fromNodeId) }}</span>
              <el-button v-if="!readonly" text type="danger" :icon="Link2Off" @click="deleteLink(link)" />
            </div>
            <div v-for="link in selectedOutgoing" :key="`out-${link.toNodeId}`" class="connection-row">
              <span>前往：{{ connectionName(link.toNodeId) }}</span>
              <el-button v-if="!readonly" text type="danger" :icon="Link2Off" @click="deleteLink(link)" />
            </div>
          </div>
        </template>
        <el-empty v-else :image-size="72" description="选择节点进行配置" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.flow-editor {
  overflow: hidden;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 10px;
}

.flow-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}

.flow-workspace {
  display: grid;
  grid-template-columns: minmax(520px, 1fr) 390px;
  height: 720px;
}

.flow-canvas {
  background: #f8fafc;
}

.node-inspector {
  overflow: auto;
  padding: 18px;
  border-left: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.process-node {
  position: relative;
  display: flex;
  width: 250px;
  align-items: center;
  gap: 11px;
  padding: 13px 14px;
  color: var(--el-text-color-primary);
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  background: white;
  box-shadow: 0 3px 12px rgb(15 23 42 / 8%);
  cursor: pointer;
}

.process-node:hover,
.process-node.is-selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.process-node--start,
.process-node--end {
  background: #f1f5f9;
}

.process-node--condition {
  border-color: #f59e0b;
}

.process-node--default {
  border-style: dashed;
}

.process-node__icon {
  display: grid;
  flex: 0 0 30px;
  height: 30px;
  place-items: center;
  color: white;
  border-radius: 50%;
  background: var(--el-color-primary);
}

.process-node--start .process-node__icon,
.process-node--end .process-node__icon {
  background: #64748b;
}

.process-node--condition .process-node__icon {
  background: #d97706;
}

.process-node--default .process-node__icon {
  background: #7c3aed;
}

.process-node strong,
.process-node small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-node small {
  max-width: 175px;
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.condition-list,
.post-field-list,
.field-permission-list,
.connection-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.condition-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  padding: 9px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.condition-row > :nth-child(3) {
  grid-column: 1 / -1;
}

.field-permission-list {
  max-height: 260px;
  overflow: auto;
}

.field-permission-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.field-permission-row small {
  display: block;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.post-field-row {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) minmax(100px, 1fr) auto;
  align-items: center;
  gap: 6px;
}

.connection-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
  font-size: 12px;
}

.inspector-section-title {
  padding-top: 12px;
  border-top: 1px solid var(--el-border-color-lighter);
  font-weight: 600;
}

@media (max-width: 1180px) {
  .flow-workspace {
    grid-template-columns: minmax(440px, 1fr) 340px;
  }
}
</style>
