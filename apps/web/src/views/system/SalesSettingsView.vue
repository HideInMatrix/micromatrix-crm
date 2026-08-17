<script setup lang="ts">
import type { FieldVO, OpportunityStageVO, PoolRuleVO } from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import {
  opportunityApi,
  poolRuleApi,
  resourceCapacityApi,
  resourcePoolApi,
  type ResourcePoolRecycleCondition,
  type ResourceCapacityVO,
  type ResourcePoolVO,
} from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'

const fieldRefs = useFieldRefs()

// ===== 商机阶段 =====

const stages = ref<OpportunityStageVO[]>([])
const stageLoading = ref(false)
const stageDialogVisible = ref(false)
const editingStage = ref<OpportunityStageVO | null>(null)
const stageForm = reactive({ name: '', probability: 10 })

async function loadStages() {
  stageLoading.value = true
  try {
    const { data } = await opportunityApi.stages()
    stages.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    stageLoading.value = false
  }
}

function openStageCreate() {
  editingStage.value = null
  Object.assign(stageForm, { name: '', probability: 10 })
  stageDialogVisible.value = true
}

function openStageEdit(stage: OpportunityStageVO) {
  editingStage.value = stage
  Object.assign(stageForm, { name: stage.name, probability: stage.probability })
  stageDialogVisible.value = true
}

async function handleStageSave() {
  if (!stageForm.name.trim()) {
    ElMessage.warning('请输入阶段名称')
    return
  }
  try {
    if (editingStage.value) {
      await opportunityApi.updateStage(editingStage.value.id, { ...stageForm })
      ElMessage.success('阶段已更新')
    } else {
      await opportunityApi.createStage({ ...stageForm })
      ElMessage.success('阶段已创建')
    }
    stageDialogVisible.value = false
    loadStages()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleStageDelete(stage: OpportunityStageVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除阶段「${stage.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await opportunityApi.removeStage(stage.id)
    ElMessage.success('已删除')
    loadStages()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

// ===== 回收规则 =====

const rules = ref<PoolRuleVO[]>([])
const ruleSaving = ref(false)
const running = ref(false)

async function loadRules() {
  const { data } = await poolRuleApi.list()
  rules.value = data
}

async function saveRule(rule: PoolRuleVO) {
  ruleSaving.value = true
  try {
    await poolRuleApi.update(rule)
    ElMessage.success('规则已保存')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    ruleSaving.value = false
  }
}

async function runNow() {
  running.value = true
  try {
    const { data } = await poolRuleApi.runNow()
    ElMessage.success(`执行完成：回收线索 ${data.recycledLeads} 条、客户 ${data.recycledCustomers} 个`)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    running.value = false
  }
}

// ===== 多公海 / 多线索池 =====

const poolModule = ref<'lead' | 'customer'>('lead')
const pools = ref<ResourcePoolVO[]>([])
const capacities = ref<ResourceCapacityVO[]>([])
const poolFields = ref<FieldVO[]>([])
const poolLoading = ref(false)

const poolDialogVisible = ref(false)
const editingPool = ref<ResourcePoolVO | null>(null)
const poolSaving = ref(false)
type RecycleConditionForm = ResourcePoolRecycleCondition & { fixedRange: string[] }

const dynamicRecycleOptions = [
  { label: '今天', value: 'TODAY' },
  { label: '昨天', value: 'YESTERDAY' },
  { label: '本周', value: 'WEEK' },
  { label: '上周', value: 'LAST_WEEK' },
  { label: '本月', value: 'MONTH' },
  { label: '上月', value: 'LAST_MONTH' },
  { label: '过去 7 天', value: 'LAST_SEVEN' },
  { label: '过去 30 天', value: 'LAST_THIRTY' },
  { label: '早于 7 天前', value: 'CUSTOM,7,BEFORE_DAY' },
  { label: '早于 30 天前', value: 'CUSTOM,30,BEFORE_DAY' },
  { label: '早于 90 天前', value: 'CUSTOM,90,BEFORE_DAY' },
]

const poolForm = reactive({
  name: '',
  enabled: true,
  autoRecycle: false,
  scopeAll: true,
  scopeUsers: [] as string[],
  scopeDepts: [] as string[],
  managerAll: false,
  managerUsers: [] as string[],
  managerDepts: [] as string[],
  hiddenFieldIds: [] as string[],
  limitDailyPick: false,
  dailyPickLimit: 10,
  limitPreviousOwner: false,
  previousOwnerCooldownDays: 7,
  limitNewData: false,
  newDataCooldownDays: 1,
  recycleMode: 'AND' as 'AND' | 'OR',
  recycleConditions: [] as RecycleConditionForm[],
})

const capacityDialogVisible = ref(false)
const editingCapacity = ref<ResourceCapacityVO | null>(null)
const capacitySaving = ref(false)
const capacityForm = reactive({
  scopeAll: false,
  scopeUsers: [] as string[],
  scopeDepts: [] as string[],
  capacity: 100,
})

function parseScopes(tokens: string[]) {
  const users: string[] = []
  const depts: string[] = []
  let all = false
  for (const token of tokens) {
    if (token === '*') all = true
    else if (token.startsWith('user:')) users.push(token.slice(5))
    else if (token.startsWith('dept:')) depts.push(token.slice(5))
    else if (fieldRefs.memberMap.value.has(token)) users.push(token)
    else if (fieldRefs.deptMap.value.has(token)) depts.push(token)
  }
  return { all, users, depts }
}

function makeScopes(all: boolean, users: string[], depts: string[]) {
  if (all) return ['*']
  return [...users.map((id) => `user:${id}`), ...depts.map((id) => `dept:${id}`)]
}

function toRecycleConditionForm(condition: ResourcePoolRecycleCondition): RecycleConditionForm {
  const fixedRange =
    condition.operator === 'FIXED' && condition.value
      ? condition.value.split(',').filter(Boolean)
      : []
  return {
    ...condition,
    scope: [...(condition.scope ?? [])],
    fixedRange,
  }
}

function addRecycleCondition() {
  poolForm.recycleConditions.push({
    column: 'storageTime',
    operator: 'DYNAMICS',
    value: 'CUSTOM,30,BEFORE_DAY',
    scope: ['Created', 'Picked'],
    fixedRange: [],
  })
}

function removeRecycleCondition(index: number) {
  poolForm.recycleConditions.splice(index, 1)
}

function buildRecycleConditions(): ResourcePoolRecycleCondition[] {
  return poolForm.recycleConditions.map((condition) => ({
    column: condition.column,
    operator: condition.operator,
    value:
      condition.operator === 'FIXED'
        ? condition.fixedRange.join(',')
        : condition.value.trim(),
    ...(condition.column === 'storageTime'
      ? { scope: condition.scope?.length ? condition.scope : ['Created', 'Picked'] }
      : {}),
  }))
}

function scopeLabel(tokens: string[]) {
  if (tokens.includes('*')) return '全部成员'
  const labels = tokens.map((token) => {
    const value = token.includes(':') ? token.slice(token.indexOf(':') + 1) : token
    if (token.startsWith('dept:') || fieldRefs.deptMap.value.has(value)) {
      return `部门：${fieldRefs.deptMap.value.get(value) ?? value}`
    }
    return fieldRefs.memberMap.value.get(value) ?? value
  })
  return labels.length ? labels.join('、') : '未配置'
}

async function loadPoolConfig() {
  poolLoading.value = true
  try {
    const [{ data: poolList }, { data: capacityList }, { data: fields }] = await Promise.all([
      resourcePoolApi.list(poolModule.value),
      resourceCapacityApi.list(poolModule.value),
      metadataApi.fields(poolModule.value),
    ])
    pools.value = poolList
    capacities.value = capacityList
    poolFields.value = fields
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    poolLoading.value = false
  }
}

function openPoolCreate() {
  editingPool.value = null
  Object.assign(poolForm, {
    name: '',
    enabled: true,
    autoRecycle: false,
    scopeAll: true,
    scopeUsers: [],
    scopeDepts: [],
    managerAll: false,
    managerUsers: [],
    managerDepts: [],
    hiddenFieldIds: [],
    limitDailyPick: false,
    dailyPickLimit: 10,
    limitPreviousOwner: false,
    previousOwnerCooldownDays: 7,
    limitNewData: false,
    newDataCooldownDays: 1,
    recycleMode: 'AND',
    recycleConditions: [],
  })
  poolDialogVisible.value = true
}

function openPoolEdit(pool: ResourcePoolVO) {
  editingPool.value = pool
  const scope = parseScopes(pool.scopeIds)
  const manager = parseScopes(pool.managerIds)
  Object.assign(poolForm, {
    name: pool.name,
    enabled: pool.enabled,
    autoRecycle: pool.autoRecycle,
    scopeAll: scope.all,
    scopeUsers: scope.users,
    scopeDepts: scope.depts,
    managerAll: manager.all,
    managerUsers: manager.users,
    managerDepts: manager.depts,
    hiddenFieldIds: [...pool.hiddenFieldIds],
    limitDailyPick: pool.pickRule?.limitDailyPick ?? false,
    dailyPickLimit: pool.pickRule?.dailyPickLimit ?? 10,
    limitPreviousOwner: pool.pickRule?.limitPreviousOwner ?? false,
    previousOwnerCooldownDays: pool.pickRule?.previousOwnerCooldownDays ?? 7,
    limitNewData: pool.pickRule?.limitNewData ?? false,
    newDataCooldownDays: pool.pickRule?.newDataCooldownDays ?? 1,
    recycleMode: pool.recycleRule?.operator ?? 'AND',
    recycleConditions: (pool.recycleRule?.conditions ?? []).map(toRecycleConditionForm),
  })
  poolDialogVisible.value = true
}

async function savePool() {
  if (!poolForm.name.trim()) {
    ElMessage.warning('请输入池名称')
    return
  }
  const scopeIds = makeScopes(poolForm.scopeAll, poolForm.scopeUsers, poolForm.scopeDepts)
  if (scopeIds.length === 0) {
    ElMessage.warning('请配置至少一个可用成员或部门')
    return
  }
  const recycleConditions = buildRecycleConditions()
  if (
    poolForm.autoRecycle &&
    (recycleConditions.length === 0 || recycleConditions.some((condition) => !condition.value))
  ) {
    ElMessage.warning('启用自动回收时请至少配置一条完整回收条件')
    return
  }
  poolSaving.value = true
  try {
    const payload = {
      module: poolModule.value,
      name: poolForm.name.trim(),
      enabled: poolForm.enabled,
      autoRecycle: poolForm.autoRecycle,
      scopeIds,
      managerIds: makeScopes(poolForm.managerAll, poolForm.managerUsers, poolForm.managerDepts),
      hiddenFieldIds: poolForm.hiddenFieldIds.filter(
        (id) => poolFields.value.some((field) => field.id === id && field.key !== 'name'),
      ),
      pickRule: {
        limitDailyPick: poolForm.limitDailyPick,
        dailyPickLimit: poolForm.limitDailyPick ? poolForm.dailyPickLimit : undefined,
        limitPreviousOwner: poolForm.limitPreviousOwner,
        previousOwnerCooldownDays: poolForm.limitPreviousOwner
          ? poolForm.previousOwnerCooldownDays
          : undefined,
        limitNewData: poolForm.limitNewData,
        newDataCooldownDays: poolForm.limitNewData ? poolForm.newDataCooldownDays : undefined,
      },
      recycleRule: {
        operator: poolForm.recycleMode,
        conditions: recycleConditions,
      },
    }
    if (editingPool.value) await resourcePoolApi.update(editingPool.value.id, payload)
    else await resourcePoolApi.create(payload)
    ElMessage.success('池配置已保存')
    poolDialogVisible.value = false
    loadPoolConfig()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    poolSaving.value = false
  }
}

async function deletePool(pool: ResourcePoolVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除「${pool.name}」吗？池内有数据时不会删除。`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await resourcePoolApi.remove(pool.id)
    ElMessage.success('已删除')
    loadPoolConfig()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openCapacityCreate() {
  editingCapacity.value = null
  Object.assign(capacityForm, { scopeAll: false, scopeUsers: [], scopeDepts: [], capacity: 100 })
  capacityDialogVisible.value = true
}

function openCapacityEdit(capacity: ResourceCapacityVO) {
  editingCapacity.value = capacity
  const scope = parseScopes(capacity.scopeIds)
  Object.assign(capacityForm, {
    scopeAll: scope.all,
    scopeUsers: scope.users,
    scopeDepts: scope.depts,
    capacity: capacity.capacity,
  })
  capacityDialogVisible.value = true
}

async function saveCapacity() {
  const scopeIds = makeScopes(capacityForm.scopeAll, capacityForm.scopeUsers, capacityForm.scopeDepts)
  if (scopeIds.length === 0) {
    ElMessage.warning('请配置库容适用范围')
    return
  }
  capacitySaving.value = true
  try {
    const payload = {
      module: poolModule.value,
      scopeIds,
      capacity: capacityForm.capacity,
      ...(editingCapacity.value?.filters ? { filters: editingCapacity.value.filters } : {}),
    }
    if (editingCapacity.value) await resourceCapacityApi.update(editingCapacity.value.id, payload)
    else await resourceCapacityApi.create(payload)
    ElMessage.success('库容配置已保存')
    capacityDialogVisible.value = false
    loadPoolConfig()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    capacitySaving.value = false
  }
}

async function deleteCapacity(capacity: ResourceCapacityVO) {
  const confirmed = await ElMessageBox.confirm('确定删除这条库容规则吗？', '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await resourceCapacityApi.remove(capacity.id)
    loadPoolConfig()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  await fieldRefs.load()
  loadStages()
  loadRules()
  loadPoolConfig()
})
</script>

<template>
  <div class="space-y-4">
    <el-card shadow="never">
      <div class="flex-between mb-4">
        <div>
          <div class="font-medium">商机阶段</div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            自定义销售流程阶段与赢率；赢单/输单为系统阶段不可删除
          </div>
        </div>
        <el-button type="primary" @click="openStageCreate">新建阶段</el-button>
      </div>

      <el-table v-loading="stageLoading" :data="stages">
        <el-table-column label="阶段名称" min-width="180">
          <template #default="{ row }">
            {{ row.name }}
            <el-tag v-if="row.isWon" type="success" size="small" class="ml-1">赢单</el-tag>
            <el-tag v-else-if="row.isLost" type="danger" size="small" class="ml-1">输单</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="赢率" width="120">
          <template #default="{ row }">{{ row.probability }}%</template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button link type="primary" @click="openStageEdit(row as OpportunityStageVO)">
              编辑
            </el-button>
            <el-button
              link
              type="danger"
              :disabled="row.system"
              @click="handleStageDelete(row as OpportunityStageVO)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <div class="flex-between mb-4">
        <div>
          <div class="font-medium">多公海 / 多线索池</div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            配置可用范围、池管理员、领取限制与成员库容；业务规则按 CordysCRM 语义迁移
          </div>
        </div>
        <el-radio-group v-model="poolModule" @change="loadPoolConfig">
          <el-radio-button value="lead">线索池</el-radio-button>
          <el-radio-button value="customer">客户公海</el-radio-button>
        </el-radio-group>
      </div>

      <div class="flex-between mb-2">
        <span class="text-sm font-medium">池配置</span>
        <el-button type="primary" size="small" @click="openPoolCreate">新建池</el-button>
      </div>
      <el-table v-loading="poolLoading" :data="pools" class="mb-6">
        <el-table-column prop="name" label="名称" min-width="150" />
        <el-table-column label="可用范围" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ scopeLabel(row.scopeIds) }}</template>
        </el-table-column>
        <el-table-column label="管理员范围" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ scopeLabel(row.managerIds) }}</template>
        </el-table-column>
        <el-table-column label="领取限制" min-width="210">
          <template #default="{ row }">
            <div class="text-xs leading-5">
              <span v-if="row.pickRule?.limitDailyPick">每日 {{ row.pickRule.dailyPickLimit }} 条</span>
              <span v-if="row.pickRule?.limitPreviousOwner" class="ml-2">
                前负责人 {{ row.pickRule.previousOwnerCooldownDays }} 天
              </span>
              <span v-if="row.pickRule?.limitNewData" class="ml-2">
                新数据 {{ row.pickRule.newDataCooldownDays }} 天
              </span>
              <span
                v-if="!row.pickRule?.limitDailyPick && !row.pickRule?.limitPreviousOwner && !row.pickRule?.limitNewData"
                class="text-[var(--el-text-color-secondary)]"
              >
                无
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="自动回收" width="130">
          <template #default="{ row }">
            <span v-if="row.autoRecycle">
              {{ row.recycleRule?.conditions?.length ?? 0 }} 条 / {{ row.recycleRule?.operator ?? 'AND' }}
            </span>
            <span v-else class="text-[var(--el-text-color-secondary)]">关闭</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">
              {{ row.enabled ? '启用' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openPoolEdit(row as ResourcePoolVO)">编辑</el-button>
            <el-button link type="danger" @click="deletePool(row as ResourcePoolVO)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="flex-between mb-2">
        <div>
          <span class="text-sm font-medium">库容</span>
          <span class="text-xs text-[var(--el-text-color-secondary)] ml-2">
            同一成员/部门只允许命中一条库容规则
          </span>
        </div>
        <el-button size="small" @click="openCapacityCreate">新增库容</el-button>
      </div>
      <el-table :data="capacities">
        <el-table-column label="适用范围" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">{{ scopeLabel(row.scopeIds) }}</template>
        </el-table-column>
        <el-table-column prop="capacity" label="最大持有量" width="130" />
        <el-table-column label="不计入过滤" min-width="160">
          <template #default="{ row }">
            {{ row.filters?.length ? `${row.filters.length} 条条件` : '无' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130">
          <template #default="{ row }">
            <el-button link type="primary" @click="openCapacityEdit(row as ResourceCapacityVO)">
              编辑
            </el-button>
            <el-button link type="danger" @click="deleteCapacity(row as ResourceCapacityVO)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-card shadow="never">
      <div class="flex-between mb-4">
        <div>
          <div class="font-medium">公海 / 线索池回收规则</div>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            兼容旧规则：仅当对应模块没有配置有效的多池自动回收条件时才生效；新配置请在上方具体池中设置
          </div>
        </div>
        <el-button :loading="running" @click="runNow">立即执行一次</el-button>
      </div>

      <div v-for="rule in rules" :key="rule.module" class="flex items-center gap-4 py-3 border-b border-[var(--el-border-color-lighter)] last:border-b-0">
        <span class="w-20 text-sm font-medium">{{ rule.module === 'lead' ? '线索池' : '客户公海' }}</span>
        <el-switch v-model="rule.enabled" active-text="启用" />
        <div class="flex items-center gap-2 text-sm">
          <span>超过</span>
          <el-input-number v-model="rule.recycleDays" :min="1" :max="365" size="small" />
          <span>天未跟进回收，提前</span>
          <el-input-number v-model="rule.notifyDays" :min="0" :max="30" size="small" />
          <span>天提醒</span>
        </div>
        <el-button size="small" type="primary" :loading="ruleSaving" @click="saveRule(rule)">
          保存
        </el-button>
      </div>
    </el-card>

    <el-dialog
      v-model="poolDialogVisible"
      :title="editingPool ? '编辑池' : '新建池'"
      width="680px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="名称">
          <el-input v-model="poolForm.name" placeholder="例如：华东客户公海" />
        </el-form-item>
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="状态">
            <el-switch v-model="poolForm.enabled" active-text="启用" />
          </el-form-item>
          <el-form-item label="自动回收">
            <el-switch v-model="poolForm.autoRecycle" active-text="启用" />
          </el-form-item>
        </div>

        <el-divider content-position="left">可用范围</el-divider>
        <el-checkbox v-model="poolForm.scopeAll" class="mb-3">全部成员</el-checkbox>
        <div v-if="!poolForm.scopeAll" class="grid grid-cols-2 gap-4">
          <el-form-item label="指定成员">
            <el-select v-model="poolForm.scopeUsers" multiple filterable class="w-full">
              <el-option
                v-for="member in fieldRefs.members.value"
                :key="member.id"
                :label="member.name"
                :value="member.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="指定部门（含下级）">
            <el-tree-select
              v-model="poolForm.scopeDepts"
              :data="fieldRefs.deptTree.value"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              multiple
              show-checkbox
              check-strictly
              class="w-full"
            />
          </el-form-item>
        </div>

        <el-divider content-position="left">池管理员</el-divider>
        <el-checkbox v-model="poolForm.managerAll" class="mb-3">全部成员均为池管理员</el-checkbox>
        <div v-if="!poolForm.managerAll" class="grid grid-cols-2 gap-4">
          <el-form-item label="管理员成员">
            <el-select v-model="poolForm.managerUsers" multiple filterable class="w-full">
              <el-option
                v-for="member in fieldRefs.members.value"
                :key="member.id"
                :label="member.name"
                :value="member.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="管理员部门（含下级）">
            <el-tree-select
              v-model="poolForm.managerDepts"
              :data="fieldRefs.deptTree.value"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              multiple
              show-checkbox
              check-strictly
              class="w-full"
            />
          </el-form-item>
        </div>

        <el-divider content-position="left">池列表隐藏字段</el-divider>
        <el-form-item label="隐藏字段">
          <el-select
            v-model="poolForm.hiddenFieldIds"
            multiple
            filterable
            clearable
            class="w-full"
            placeholder="选择在当前池列表中隐藏的字段"
          >
            <el-option
              v-for="field in poolFields.filter((item) => !item.hidden)"
              :key="field.id"
              :label="field.label"
              :value="field.id"
              :disabled="field.key === 'name'"
            />
          </el-select>
          <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
            仅控制当前线索池/客户公海的表格列显示；名称字段始终显示，不属于数据脱敏。
          </div>
        </el-form-item>

        <el-divider content-position="left">领取规则</el-divider>
        <div class="space-y-3">
          <div class="flex items-center gap-3">
            <el-switch v-model="poolForm.limitDailyPick" />
            <span class="w-32 text-sm">每日领取上限</span>
            <el-input-number
              v-model="poolForm.dailyPickLimit"
              :disabled="!poolForm.limitDailyPick"
              :min="1"
              :max="10000"
            />
            <span class="text-sm">条</span>
          </div>
          <div class="flex items-center gap-3">
            <el-switch v-model="poolForm.limitPreviousOwner" />
            <span class="w-32 text-sm">前负责人冷却</span>
            <el-input-number
              v-model="poolForm.previousOwnerCooldownDays"
              :disabled="!poolForm.limitPreviousOwner"
              :min="1"
              :max="3650"
            />
            <span class="text-sm">天</span>
          </div>
          <div class="flex items-center gap-3">
            <el-switch v-model="poolForm.limitNewData" />
            <span class="w-32 text-sm">新入池数据冷却</span>
            <el-input-number
              v-model="poolForm.newDataCooldownDays"
              :disabled="!poolForm.limitNewData"
              :min="1"
              :max="3650"
            />
            <span class="text-sm">天</span>
          </div>
        </div>

        <el-divider content-position="left">自动回收规则</el-divider>
        <div v-if="poolForm.autoRecycle" class="space-y-3">
          <div class="flex-between">
            <div class="flex items-center gap-2">
              <span class="text-sm">条件关系</span>
              <el-radio-group v-model="poolForm.recycleMode" size="small">
                <el-radio-button value="AND">全部满足</el-radio-button>
                <el-radio-button value="OR">任一满足</el-radio-button>
              </el-radio-group>
            </div>
            <el-button size="small" @click="addRecycleCondition">添加条件</el-button>
          </div>

          <el-alert
            v-if="poolForm.recycleConditions.length === 0"
            type="warning"
            :closable="false"
            title="启用自动回收后至少需要一条回收条件。"
          />

          <div
            v-for="(condition, index) in poolForm.recycleConditions"
            :key="index"
            class="rounded border border-[var(--el-border-color)] p-3"
          >
            <div class="grid grid-cols-[150px_130px_1fr_auto] gap-3 items-center">
              <el-select v-model="condition.column">
                <el-option label="入库时间" value="storageTime" />
                <el-option label="最后跟进时间" value="followUpTime" />
              </el-select>
              <el-select v-model="condition.operator">
                <el-option label="动态时间" value="DYNAMICS" />
                <el-option label="固定时间" value="FIXED" />
              </el-select>

              <el-select
                v-if="condition.operator === 'DYNAMICS'"
                v-model="condition.value"
                filterable
                allow-create
                default-first-option
                placeholder="选择或输入动态时间表达式"
              >
                <el-option
                  v-for="option in dynamicRecycleOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <el-date-picker
                v-else
                v-model="condition.fixedRange"
                type="datetimerange"
                value-format="x"
                range-separator="至"
                start-placeholder="开始时间"
                end-placeholder="结束时间"
                class="!w-full"
              />

              <el-button link type="danger" @click="removeRecycleCondition(index)">删除</el-button>
            </div>

            <div v-if="condition.column === 'storageTime'" class="mt-3 flex items-center gap-3">
              <span class="text-xs text-[var(--el-text-color-secondary)]">入库时间按：</span>
              <el-checkbox-group v-model="condition.scope">
                <el-checkbox value="Created">创建时间</el-checkbox>
                <el-checkbox value="Picked">最近领取时间</el-checkbox>
              </el-checkbox-group>
            </div>
            <div class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
              动态表达式兼容 Cordys：例如 CUSTOM,30,BEFORE_DAY 表示早于 30 天前；也可选择今天、上周、过去 30 天等预设。
            </div>
          </div>
        </div>
        <el-alert
          v-else
          type="info"
          :closable="false"
          title="关闭自动回收后，本池不会参与新条件引擎。若模块仍启用旧回收规则，则仅在没有任何有效新规则时使用旧规则。"
        />
      </el-form>
      <template #footer>
        <el-button @click="poolDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="poolSaving" @click="savePool">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="capacityDialogVisible"
      :title="editingCapacity ? '编辑库容' : '新增库容'"
      width="600px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="最大持有量">
          <el-input-number v-model="capacityForm.capacity" :min="1" :max="1000000" />
        </el-form-item>
        <el-form-item label="适用范围">
          <el-checkbox v-model="capacityForm.scopeAll">全部成员</el-checkbox>
        </el-form-item>
        <div v-if="!capacityForm.scopeAll" class="grid grid-cols-2 gap-4">
          <el-form-item label="成员">
            <el-select v-model="capacityForm.scopeUsers" multiple filterable class="w-full">
              <el-option
                v-for="member in fieldRefs.members.value"
                :key="member.id"
                :label="member.name"
                :value="member.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="部门（含下级）">
            <el-tree-select
              v-model="capacityForm.scopeDepts"
              :data="fieldRefs.deptTree.value"
              :props="{ label: 'name', children: 'children' }"
              node-key="id"
              multiple
              show-checkbox
              check-strictly
              class="w-full"
            />
          </el-form-item>
        </div>
        <el-alert
          v-if="poolModule === 'customer'"
          type="info"
          :closable="false"
          title="客户库容已支持“不计入库容”过滤条件；本轮先保留已有条件，条件编辑器将在 SavedView/高级筛选复用组件完成后接入。"
        />
      </el-form>
      <template #footer>
        <el-button @click="capacityDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="capacitySaving" @click="saveCapacity">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="stageDialogVisible"
      :title="editingStage ? '编辑阶段' : '新建阶段'"
      width="400px"
    >
      <el-form label-width="80px">
        <el-form-item label="阶段名称">
          <el-input v-model="stageForm.name" :disabled="Boolean(editingStage?.system)" />
        </el-form-item>
        <el-form-item label="赢率 %">
          <el-input-number v-model="stageForm.probability" :min="0" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stageDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleStageSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
