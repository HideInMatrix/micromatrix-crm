<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { opportunityApi } from '@/api/sales'
import {
  opportunityRuleApi,
  type OpportunityRuleConditionVO,
  type OpportunityRulePayload,
  type OpportunityRuleVO,
} from '@/api/system'
import { useFieldRefs } from '@/composables/useFieldRefs'

interface ConditionDraft {
  column: 'createTime' | 'opportunityStage'
  operator: 'DYNAMICS' | 'FIXED' | 'IN' | 'NOT_IN'
  stageIds: string[]
  dynamicCount: number
  dynamicUnit: 'BEFORE_DAY' | 'BEFORE_WEEK' | 'BEFORE_MONTH'
  fixedRange: [number, number] | null
}

const visible = defineModel<boolean>({ required: true })
const refs = useFieldRefs()
const loading = ref(false)
const saving = ref(false)
const rows = ref<OpportunityRuleVO[]>([])
const stages = ref<Array<{ id: string; name: string }>>([])
const dialogVisible = ref(false)
const editingId = ref('')
const conditions = ref<ConditionDraft[]>([])
const form = reactive({
  name: '',
  scopeIds: [] as string[],
  ownerIds: [] as string[],
  enable: true,
  auto: false,
  operator: 'AND' as 'AND' | 'OR',
})

const scopeOptions = computed(() => [
  ...refs.members.value.map((item) => ({ label: `成员：${item.name}`, value: `user:${item.id}` })),
  ...[...refs.deptMap.value.entries()].map(([id, name]) => ({ label: `部门：${name}`, value: `dept:${id}` })),
  ...refs.roles.value.map((item) => ({ label: `角色：${item.name}`, value: `role:${item.id}` })),
])

function emptyCondition(): ConditionDraft {
  return {
    column: 'createTime',
    operator: 'DYNAMICS',
    stageIds: [],
    dynamicCount: 30,
    dynamicUnit: 'BEFORE_DAY',
    fixedRange: null,
  }
}

function canonical(token: string) {
  if (token === '*' || /^(user|dept|role):/.test(token)) return token
  if (refs.memberMap.value.has(token)) return `user:${token}`
  if (refs.deptMap.value.has(token)) return `dept:${token}`
  if (refs.roleMap.value.has(token)) return `role:${token}`
  return token
}

function reset() {
  editingId.value = ''
  Object.assign(form, { name: '', scopeIds: [], ownerIds: [], enable: true, auto: false, operator: 'AND' })
  conditions.value = [emptyCondition()]
}

async function load() {
  loading.value = true
  try {
    if (!refs.members.value.length) await refs.load()
    const [{ data }, { data: stageRows }] = await Promise.all([
      opportunityRuleApi.page(1, 100),
      opportunityApi.stages(),
    ])
    rows.value = data.list
    stages.value = stageRows.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function conditionFromVO(condition: OpportunityRuleConditionVO): ConditionDraft {
  if (condition.column === 'opportunityStage') {
    return {
      ...emptyCondition(),
      column: 'opportunityStage',
      operator: condition.operator === 'NOT_IN' ? 'NOT_IN' : 'IN',
      stageIds: condition.value.split(',').filter(Boolean),
    }
  }
  if (condition.operator === 'FIXED') {
    const [start, end] = condition.value.split(',').map(Number)
    return {
      ...emptyCondition(),
      operator: 'FIXED',
      fixedRange: Number.isFinite(start) && Number.isFinite(end) ? [start, end] : null,
    }
  }
  const parts = condition.value.split(',')
  return {
    ...emptyCondition(),
    operator: 'DYNAMICS',
    dynamicCount: Number(parts.length === 3 ? parts[1] : parts[0]) || 30,
    dynamicUnit: (parts.length === 3 ? parts[2] : `BEFORE_${(parts[1] ?? 'day').toUpperCase()}`) as ConditionDraft['dynamicUnit'],
  }
}

function openCreate() {
  reset()
  dialogVisible.value = true
}

function openEdit(row: OpportunityRuleVO) {
  editingId.value = row.id
  conditions.value = (() => {
    try {
      const value = row.condition ? JSON.parse(row.condition) : []
      return Array.isArray(value) && value.length
        ? (value as OpportunityRuleConditionVO[]).map(conditionFromVO)
        : [emptyCondition()]
    } catch {
      return [emptyCondition()]
    }
  })()
  Object.assign(form, {
    name: row.name,
    scopeIds: row.members.map((item) => canonical(item.id)),
    ownerIds: row.owners.map((item) => canonical(item.id)),
    enable: row.enable,
    auto: row.auto,
    operator: row.operator === 'OR' ? 'OR' : 'AND',
  })
  dialogVisible.value = true
}

function serializeConditions(): OpportunityRuleConditionVO[] {
  if (!form.auto) return []
  return conditions.value.map((condition) => {
    if (condition.column === 'opportunityStage') {
      return {
        column: 'opportunityStage',
        operator: condition.operator === 'NOT_IN' ? 'NOT_IN' : 'IN',
        value: condition.stageIds.join(','),
        scope: [],
      }
    }
    return {
      column: 'createTime',
      operator: condition.operator === 'FIXED' ? 'FIXED' : 'DYNAMICS',
      value:
        condition.operator === 'FIXED'
          ? (condition.fixedRange?.join(',') ?? '')
          : `CUSTOM,${condition.dynamicCount},${condition.dynamicUnit}`,
      scope: [],
    }
  })
}

async function save() {
  if (!form.name.trim()) return ElMessage.warning('请输入规则名称')
  if (!form.scopeIds.length) return ElMessage.warning('请选择规则成员')
  if (!form.ownerIds.length) return ElMessage.warning('请选择规则管理员')
  const ruleConditions = serializeConditions()
  if (form.auto && ruleConditions.some((condition) => !condition.value)) {
    return ElMessage.warning('请完整填写自动关闭条件')
  }
  const payload: OpportunityRulePayload = {
    name: form.name.trim(),
    scopeIds: form.scopeIds,
    ownerIds: form.ownerIds,
    enable: form.enable,
    auto: form.auto,
    operator: form.operator,
    conditions: ruleConditions,
  }
  saving.value = true
  try {
    if (editingId.value) await opportunityRuleApi.update(editingId.value, payload)
    else await opportunityRuleApi.add(payload)
    dialogVisible.value = false
    ElMessage.success(editingId.value ? '规则已更新' : '规则已添加')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function toggle(row: OpportunityRuleVO) {
  try {
    await opportunityRuleApi.toggle(row.id)
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(row: OpportunityRuleVO) {
  const ok = await ElMessageBox.confirm(`确定删除关闭规则「${row.name}」吗？`, '删除规则', { type: 'warning' }).catch(() => false)
  if (!ok) return
  try {
    await opportunityRuleApi.remove(row.id)
    ElMessage.success('规则已删除')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function conditionSummary(row: OpportunityRuleVO) {
  if (!row.auto) return '不自动关闭'
  try {
    const list = JSON.parse(row.condition ?? '[]') as OpportunityRuleConditionVO[]
    return list
      .map((item) => {
        if (item.column === 'opportunityStage') {
          const names = item.value.split(',').map((id) => stages.value.find((stage) => stage.id === id)?.name ?? id)
          return `阶段${item.operator === 'IN' ? '属于' : '不属于'} ${names.join('、')}`
        }
        return item.operator === 'FIXED' ? `创建时间 ${item.value}` : `创建时间 ${item.value.replace('CUSTOM,', '')}`
      })
      .join(row.operator === 'OR' ? ' 或 ' : ' 且 ')
  } catch {
    return '-'
  }
}

watch(visible, (open) => { if (open) void load() })
</script>

<template>
  <el-drawer v-model="visible" title="商机关闭规则" size="920px" destroy-on-close data-testid="opportunity-close-rule-settings-drawer">
    <div class="mb-4 flex items-center justify-between">
      <el-alert class="mr-4 flex-1" type="info" :closable="false" title="同一负责人命中多条 Scope 时，创建时间最新的规则优先；自动规则每天 03:00 执行。" />
      <el-button type="primary" @click="openCreate">添加规则</el-button>
    </div>
    <el-table v-loading="loading" :data="rows" border>
      <el-table-column prop="name" label="规则名称" min-width="150" />
      <el-table-column label="成员" min-width="180" show-overflow-tooltip><template #default="{ row }">{{ row.members.map((item: { name: string }) => item.name).join('、') || '-' }}</template></el-table-column>
      <el-table-column label="管理员" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.owners.map((item: { name: string }) => item.name).join('、') || '-' }}</template></el-table-column>
      <el-table-column label="自动关闭条件" min-width="280" show-overflow-tooltip><template #default="{ row }">{{ conditionSummary(row as OpportunityRuleVO) }}</template></el-table-column>
      <el-table-column label="自动" width="80"><template #default="{ row }">{{ row.auto ? '是' : '否' }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-switch :model-value="row.enable" @change="toggle(row as OpportunityRuleVO)" /></template></el-table-column>
      <el-table-column label="操作" width="130"><template #default="{ row }"><el-button link type="primary" @click="openEdit(row as OpportunityRuleVO)">编辑</el-button><el-button link type="danger" @click="remove(row as OpportunityRuleVO)">删除</el-button></template></el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑关闭规则' : '添加关闭规则'" width="760px" append-to-body destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="规则名称" required><el-input v-model="form.name" maxlength="255" /></el-form-item>
        <el-form-item label="成员" required><el-select v-model="form.scopeIds" multiple filterable class="w-full"><el-option v-for="item in scopeOptions" :key="`scope-${item.value}`" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="管理员" required><el-select v-model="form.ownerIds" multiple filterable class="w-full"><el-option v-for="item in scopeOptions" :key="`owner-${item.value}`" :label="item.label" :value="item.value" /></el-select></el-form-item>
        <el-form-item label="状态"><el-switch v-model="form.enable" active-text="启用" /></el-form-item>
        <el-form-item label="自动关闭"><el-switch v-model="form.auto" /></el-form-item>
        <template v-if="form.auto">
          <el-form-item label="条件关系"><el-radio-group v-model="form.operator"><el-radio-button value="AND">全部满足</el-radio-button><el-radio-button value="OR">任一满足</el-radio-button></el-radio-group></el-form-item>
          <el-form-item label="关闭条件" required>
            <div class="w-full space-y-2">
              <div v-for="(condition, index) in conditions" :key="index" class="grid grid-cols-[130px_130px_1fr_auto] items-center gap-2">
                <el-select v-model="condition.column" @change="condition.operator = condition.column === 'opportunityStage' ? 'IN' : 'DYNAMICS'">
                  <el-option label="创建时间" value="createTime" /><el-option label="商机阶段" value="opportunityStage" />
                </el-select>
                <el-select v-model="condition.operator">
                  <template v-if="condition.column === 'createTime'"><el-option label="动态时间" value="DYNAMICS" /><el-option label="固定时间" value="FIXED" /></template>
                  <template v-else><el-option label="属于" value="IN" /><el-option label="不属于" value="NOT_IN" /></template>
                </el-select>
                <template v-if="condition.column === 'opportunityStage'">
                  <el-select v-model="condition.stageIds" multiple filterable><el-option v-for="stage in stages" :key="stage.id" :label="stage.name" :value="stage.id" /></el-select>
                </template>
                <template v-else-if="condition.operator === 'FIXED'">
                  <el-date-picker v-model="condition.fixedRange" type="datetimerange" value-format="x" class="!w-full" />
                </template>
                <template v-else>
                  <div class="grid grid-cols-[100px_1fr] gap-2"><el-input-number v-model="condition.dynamicCount" :min="1" :max="3650" class="!w-full" /><el-select v-model="condition.dynamicUnit"><el-option label="天前" value="BEFORE_DAY" /><el-option label="周前" value="BEFORE_WEEK" /><el-option label="月前" value="BEFORE_MONTH" /></el-select></div>
                </template>
                <el-button link type="danger" :disabled="conditions.length <= 1" @click="conditions.splice(index, 1)">删除</el-button>
              </div>
              <el-button link type="primary" @click="conditions.push(emptyCondition())">+ 添加条件</el-button>
            </div>
          </el-form-item>
        </template>
      </el-form>
      <template #footer><el-button @click="dialogVisible = false">取消</el-button><el-button type="primary" :loading="saving" @click="save">保存</el-button></template>
    </el-dialog>
  </el-drawer>
</template>
