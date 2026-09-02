<script setup lang="ts">
import {
  APPROVAL_MODE_LABELS,
  APPROVER_TYPE_LABELS,
  type ApprovalFlowNodeInput,
  type ApprovalMode,
  type ApproverType,
} from '@micromatrix/shared'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MarkerType, VueFlow, type Edge, type Node, type NodeDragEvent } from '@vue-flow/core'
import { GitBranch, Play, Plus, Square, Trash2 } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import type { MemberOption, RoleOption } from '@/api/system'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

interface CanvasNodeData {
  kind: 'start' | 'approver' | 'end'
  label: string
  detail: string
  clientId?: string
  index?: number
}

const props = defineProps<{
  readonly?: boolean
  members: MemberOption[]
  roles: RoleOption[]
}>()

const model = defineModel<ApprovalFlowNodeInput[]>({ required: true })
const selectedClientId = ref<string | null>(null)

function clientId() {
  return globalThis.crypto?.randomUUID?.() ?? `flow-node-${Date.now()}-${Math.random()}`
}

watch(
  model,
  (nodes) => {
    let changed = false
    const next = nodes.map((node) => {
      if (node.clientId) return node
      changed = true
      return { ...node, clientId: clientId() }
    })
    if (changed) model.value = next
    if (selectedClientId.value && !next.some((node) => node.clientId === selectedClientId.value)) {
      selectedClientId.value = null
    }
  },
  { immediate: true, deep: true },
)

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
  return APPROVER_TYPE_LABELS[approverType]
}

const graphNodes = computed<Node<CanvasNodeData>[]>(() => {
  const result: Node<CanvasNodeData>[] = [
    {
      id: 'start',
      type: 'process',
      position: { x: 80, y: 24 },
      draggable: !props.readonly,
      selectable: false,
      data: { kind: 'start', label: '开始', detail: '提交单据后进入流程' },
    },
  ]
  model.value.forEach((node, index) => {
    result.push({
      id: node.clientId ?? `node-${index}`,
      type: 'process',
      position: { x: 80, y: 164 + index * 154 },
      draggable: false,
      selectable: false,
      data: {
        kind: 'approver',
        label: node.name || `审批节点 ${index + 1}`,
        detail: `${approverSummary(node)} · ${APPROVAL_MODE_LABELS[node.mode ?? 'ANY']}`,
        clientId: node.clientId,
        index,
      },
    })
  })
  result.push({
    id: 'end',
    type: 'process',
    position: { x: 80, y: 164 + model.value.length * 154 },
    draggable: false,
    selectable: false,
    data: { kind: 'end', label: '结束', detail: '所有节点完成后通过' },
  })
  return result
})

const graphEdges = computed<Edge[]>(() =>
  graphNodes.value.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${graphNodes.value[index + 1].id}`,
    source: node.id,
    target: graphNodes.value[index + 1].id,
    markerEnd: MarkerType.ArrowClosed,
    style: { stroke: '#94a3b8', strokeWidth: 2 },
  })),
)

const selectedIndex = computed(() =>
  model.value.findIndex((node) => node.clientId === selectedClientId.value),
)
const selectedNode = computed(() =>
  selectedIndex.value >= 0 ? model.value[selectedIndex.value] : null,
)

function updateSelected(patch: Partial<ApprovalFlowNodeInput>) {
  if (selectedIndex.value < 0) return
  const next = [...model.value]
  next[selectedIndex.value] = { ...next[selectedIndex.value], ...patch }
  model.value = next
}

function changeApproverType(value: string) {
  updateSelected({ approverType: value as ApproverType, approverIds: [] })
}

function changeMode(value: string) {
  updateSelected({ mode: value as ApprovalMode })
}

function addNode() {
  const id = clientId()
  model.value = [
    ...model.value,
    {
      clientId: id,
      name: `审批节点 ${model.value.length + 1}`,
      approverType: 'DIRECT_LEADER',
      approverIds: [],
      ccUserIds: [],
      mode: 'ANY',
    },
  ]
  selectedClientId.value = id
}

function moveNode(direction: -1 | 1) {
  const source = selectedIndex.value
  const target = source + direction
  if (source < 0 || target < 0 || target >= model.value.length) return
  const next = [...model.value]
  ;[next[source], next[target]] = [next[target], next[source]]
  model.value = next
}

function handleNodeDragStop({ node }: NodeDragEvent) {
  if (props.readonly || node.id === 'start' || node.id === 'end') return
  const source = model.value.findIndex((item) => item.clientId === node.id)
  if (source < 0) return
  const target = Math.max(
    0,
    Math.min(model.value.length - 1, Math.round((node.position.y - 164) / 154)),
  )
  if (source === target) return
  const next = [...model.value]
  const [moved] = next.splice(source, 1)
  next.splice(target, 0, moved)
  model.value = next
}

function removeSelected() {
  if (selectedIndex.value < 0) return
  model.value = model.value.filter((_, index) => index !== selectedIndex.value)
  selectedClientId.value = null
}
</script>

<template>
  <div class="flow-editor" data-testid="approval-flow-canvas">
    <div class="flow-toolbar">
      <div>
        <div class="font-medium">新建时审批流程</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          当前阶段为受控顺序流；条件分支将在后续运行时接入后开放。
        </div>
      </div>
      <el-button v-if="!readonly" type="primary" plain :icon="Plus" @click="addNode">
        添加审批节点
      </el-button>
    </div>

    <div class="flow-workspace">
      <VueFlow
        :nodes="graphNodes"
        :edges="graphEdges"
        :nodes-connectable="false"
        :nodes-draggable="!readonly"
        :elements-selectable="false"
        fit-view-on-init
        :min-zoom="0.45"
        :max-zoom="1.4"
        class="flow-canvas"
        @node-drag-stop="handleNodeDragStop"
      >
        <Background :gap="18" :size="1" pattern-color="#d9dee8" />
        <Controls :show-interactive="false" position="bottom-left" />
        <template #node-process="{ data }">
          <button
            type="button"
            class="process-node"
            :class="[
              `process-node--${data.kind}`,
              { 'is-selected': data.clientId && data.clientId === selectedClientId },
            ]"
            :disabled="data.kind !== 'approver'"
            @click="data.clientId && (selectedClientId = data.clientId)"
          >
            <span class="process-node__icon">
              <Play v-if="data.kind === 'start'" :size="16" />
              <GitBranch v-else-if="data.kind === 'approver'" :size="16" />
              <Square v-else :size="15" />
            </span>
            <span class="min-w-0 text-left">
              <strong>{{ data.label }}</strong>
              <small>{{ data.detail }}</small>
            </span>
          </button>
        </template>
      </VueFlow>

      <aside class="node-inspector">
        <template v-if="selectedNode">
          <div class="flex items-center justify-between">
            <div class="font-medium">节点配置</div>
            <el-tag size="small">第 {{ selectedIndex + 1 }} 级</el-tag>
          </div>
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
              <el-select
                :model-value="selectedNode.approverType"
                :disabled="readonly"
                class="w-full"
                @change="changeApproverType"
              >
                <el-option
                  v-for="(label, value) in APPROVER_TYPE_LABELS"
                  :key="value"
                  :label="label"
                  :value="value"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-if="selectedNode.approverType === 'USER'" label="指定成员">
              <el-select
                :model-value="selectedNode.approverIds"
                :disabled="readonly"
                multiple
                filterable
                class="w-full"
                @update:model-value="(value: string[]) => updateSelected({ approverIds: value })"
              >
                <el-option
                  v-for="item in members"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item v-else-if="selectedNode.approverType === 'ROLE'" label="指定角色">
              <el-select
                :model-value="selectedNode.approverIds"
                :disabled="readonly"
                multiple
                class="w-full"
                @update:model-value="(value: string[]) => updateSelected({ approverIds: value })"
              >
                <el-option
                  v-for="item in roles"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="多人审批方式">
              <el-select
                :model-value="selectedNode.mode"
                :disabled="readonly"
                class="w-full"
                @change="changeMode"
              >
                <el-option
                  v-for="(label, value) in APPROVAL_MODE_LABELS"
                  :key="value"
                  :label="label"
                  :value="value"
                />
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
                placeholder="可选；进入该节点时抄送"
                @update:model-value="(value: string[]) => updateSelected({ ccUserIds: value })"
              >
                <el-option
                  v-for="item in members"
                  :key="item.id"
                  :label="item.name"
                  :value="item.id"
                />
              </el-select>
            </el-form-item>
          </el-form>
          <div v-if="!readonly" class="node-actions">
            <el-button :disabled="selectedIndex === 0" @click="moveNode(-1)">上移</el-button>
            <el-button :disabled="selectedIndex === model.length - 1" @click="moveNode(1)"
              >下移</el-button
            >
            <el-button type="danger" plain :icon="Trash2" @click="removeSelected">删除</el-button>
          </div>
        </template>
        <el-empty v-else :image-size="72" description="选择一个审批节点进行配置" />
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
  padding: 14px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  background: var(--el-fill-color-extra-light);
}

.flow-workspace {
  display: grid;
  grid-template-columns: minmax(420px, 1fr) 300px;
  height: 610px;
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
  display: flex;
  width: 270px;
  align-items: center;
  gap: 11px;
  padding: 13px 14px;
  color: var(--el-text-color-primary);
  border: 1px solid #cbd5e1;
  border-radius: 9px;
  background: white;
  box-shadow: 0 3px 12px rgb(15 23 42 / 8%);
}

.process-node:disabled {
  cursor: default;
}

.process-node--approver {
  cursor: pointer;
}

.process-node--approver:hover,
.process-node.is-selected {
  border-color: var(--el-color-primary);
  box-shadow: 0 0 0 2px var(--el-color-primary-light-8);
}

.process-node--start,
.process-node--end {
  background: #f1f5f9;
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

.process-node strong,
.process-node small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.process-node small {
  max-width: 195px;
  margin-top: 3px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.node-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (max-width: 1180px) {
  .flow-workspace {
    grid-template-columns: minmax(360px, 1fr) 260px;
  }
}
</style>
