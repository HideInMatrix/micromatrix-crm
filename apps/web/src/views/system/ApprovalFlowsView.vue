<script setup lang="ts">
import {
  APPROVAL_MODE_LABELS,
  APPROVAL_MODULE_LABELS,
  APPROVER_TYPE_LABELS,
  type ApprovalFlowVO,
  type ApprovalModule,
  type ApprovalNodeConfig,
} from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { approvalApi } from '@/api/approvals'
import { extractErrorMessage } from '@/api/http'
import { memberApi, roleApi, type MemberOption, type RoleOption } from '@/api/system'

const MODULES = Object.keys(APPROVAL_MODULE_LABELS) as ApprovalModule[]

const activeModule = ref<ApprovalModule>('contract')
const flows = ref<ApprovalFlowVO[]>([])
const members = ref<MemberOption[]>([])
const roles = ref<RoleOption[]>([])
const loading = ref(false)
const saving = ref(false)

const form = reactive<{
  name: string
  enabled: boolean
  amountGte?: number
  nodes: ApprovalNodeConfig[]
}>({ name: '', enabled: false, amountGte: undefined, nodes: [] })

function loadForm() {
  const flow = flows.value.find((f) => f.module === activeModule.value)
  form.name = flow?.name ?? `${APPROVAL_MODULE_LABELS[activeModule.value]}审批`
  form.enabled = flow?.enabled ?? false
  form.amountGte = flow?.condition?.amountGte
  form.nodes = flow?.nodes.map((n) => ({
    name: n.name,
    approverType: n.approverType,
    approverIds: [...n.approverIds],
    mode: n.mode,
  })) ?? []
}

async function loadData() {
  loading.value = true
  try {
    const [{ data: flowList }, { data: memberList }, { data: roleList }] = await Promise.all([
      approvalApi.flows(),
      memberApi.options(),
      roleApi.options(),
    ])
    flows.value = flowList
    members.value = memberList
    roles.value = roleList
    loadForm()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function addNode() {
  form.nodes.push({ name: `审批节点 ${form.nodes.length + 1}`, approverType: 'DIRECT_LEADER', approverIds: [], mode: 'ANY' })
}

function moveNode(index: number, direction: -1 | 1) {
  const target = index + direction
  if (target < 0 || target >= form.nodes.length) return
  const nodes = [...form.nodes]
  ;[nodes[index], nodes[target]] = [nodes[target], nodes[index]]
  form.nodes = nodes
}

async function handleSave() {
  if (form.enabled && form.nodes.length === 0) {
    ElMessage.warning('启用的流程至少需要一个审批节点')
    return
  }
  for (const node of form.nodes) {
    if ((node.approverType === 'USER' || node.approverType === 'ROLE') && node.approverIds.length === 0) {
      ElMessage.warning(`节点「${node.name}」需要选择${node.approverType === 'USER' ? '成员' : '角色'}`)
      return
    }
  }
  saving.value = true
  try {
    await approvalApi.saveFlow({
      module: activeModule.value,
      name: form.name.trim() || `${APPROVAL_MODULE_LABELS[activeModule.value]}审批`,
      enabled: form.enabled,
      condition: form.amountGte !== undefined && form.amountGte !== null ? { amountGte: form.amountGte } : undefined,
      nodes: form.nodes,
    })
    ElMessage.success('审批流已保存')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <el-card v-loading="loading" shadow="never">
    <div class="flex-between mb-4">
      <el-radio-group v-model="activeModule" @change="loadForm">
        <el-radio-button v-for="m in MODULES" :key="m" :value="m">
          {{ APPROVAL_MODULE_LABELS[m] }}
        </el-radio-button>
      </el-radio-group>
      <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
    </div>

    <el-form label-width="110px" class="max-w-3xl">
      <el-form-item label="流程名称">
        <el-input v-model="form.name" class="!w-72" />
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="form.enabled" />
        <span class="text-xs text-[var(--el-text-color-secondary)] ml-3">
          启用后，相关单据的确认/生效操作必须走审批
        </span>
      </el-form-item>
      <el-form-item label="触发条件">
        <div class="flex items-center gap-2">
          <span class="text-sm">金额 ≥</span>
          <el-input-number
            v-model="form.amountGte"
            :min="0"
            :precision="2"
            controls-position="right"
            placeholder="留空则全部"
          />
          <span class="text-xs text-[var(--el-text-color-secondary)]">
            低于该金额的单据无需审批（留空表示全部需审批）
          </span>
        </div>
      </el-form-item>

      <el-form-item label="审批节点">
        <div class="w-full space-y-3">
          <div
            v-for="(node, index) in form.nodes"
            :key="index"
            class="border border-[var(--el-border-color)] rounded-lg p-3"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <el-tag size="small" type="info">{{ index + 1 }}</el-tag>
              <el-input v-model="node.name" class="!w-40" placeholder="节点名称" />
              <el-select v-model="node.approverType" class="!w-32" @change="node.approverIds = []">
                <el-option
                  v-for="(label, value) in APPROVER_TYPE_LABELS"
                  :key="value"
                  :label="label"
                  :value="value"
                />
              </el-select>
              <el-select
                v-if="node.approverType === 'USER'"
                v-model="node.approverIds"
                multiple
                filterable
                class="!w-56"
                placeholder="选择成员"
              >
                <el-option v-for="m in members" :key="m.id" :label="m.name" :value="m.id" />
              </el-select>
              <el-select
                v-else-if="node.approverType === 'ROLE'"
                v-model="node.approverIds"
                multiple
                class="!w-56"
                placeholder="选择角色"
              >
                <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
              </el-select>
              <el-select v-model="node.mode" class="!w-40">
                <el-option
                  v-for="(label, value) in APPROVAL_MODE_LABELS"
                  :key="value"
                  :label="label"
                  :value="value"
                />
              </el-select>
              <div class="ml-auto flex gap-1">
                <el-button link :disabled="index === 0" @click="moveNode(index, -1)">上移</el-button>
                <el-button link :disabled="index === form.nodes.length - 1" @click="moveNode(index, 1)">
                  下移
                </el-button>
                <el-button link type="danger" @click="form.nodes.splice(index, 1)">删除</el-button>
              </div>
            </div>
          </div>
          <el-button link type="primary" @click="addNode">+ 添加审批节点</el-button>
        </div>
      </el-form-item>
    </el-form>
  </el-card>
</template>
