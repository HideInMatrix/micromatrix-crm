<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import {
  opportunityApi,
  resourceCapacityApi,
  type ResourceCapacityVO,
} from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'

type CapacityFilterOperator = 'IN' | 'NOT_IN'

interface CapacityFilter {
  column: 'stage'
  operator: CapacityFilterOperator
  value: string[]
}

const visible = defineModel<boolean>({ required: true })
const refs = useFieldRefs()
const loading = ref(false)
const saving = ref(false)
const rows = ref<ResourceCapacityVO[]>([])
const stages = ref<Array<{ id: string; name: string }>>([])
const editingId = ref('')
const form = reactive({
  scopeIds: [] as string[],
  capacity: null as number | null,
  excludeStage: false,
  operator: 'IN' as CapacityFilterOperator,
  stageIds: [] as string[],
})

const scopeOptions = computed(() => [
  ...refs.members.value.map((item) => ({ label: `成员：${item.name}`, value: `user:${item.id}` })),
  ...[...refs.deptMap.value.entries()].map(([id, name]) => ({
    label: `部门：${name}`,
    value: `dept:${id}`,
  })),
  ...refs.roles.value.map((item) => ({ label: `角色：${item.name}`, value: `role:${item.id}` })),
])

const canExclude = computed(() => form.capacity !== null && form.capacity > 0)

function canonical(token: string) {
  if (token.startsWith('user:') || token.startsWith('dept:') || token.startsWith('role:')) return token
  if (refs.memberMap.value.has(token)) return `user:${token}`
  if (refs.deptMap.value.has(token)) return `dept:${token}`
  if (refs.roleMap.value.has(token)) return `role:${token}`
  return token
}

function scopeLabel(tokens: string[]) {
  return (
    tokens
      .map((token) => {
        const normalized = canonical(token)
        return scopeOptions.value.find((item) => item.value === normalized)?.label ?? token
      })
      .join('、') || '-'
  )
}

function parseFilter(row: ResourceCapacityVO): CapacityFilter | null {
  const value = row.filters?.[0]
  if (!value || value.column !== 'stage') return null
  if (value.operator !== 'IN' && value.operator !== 'NOT_IN') return null
  if (!Array.isArray(value.value) || !value.value.every((item) => typeof item === 'string')) return null
  return {
    column: 'stage',
    operator: value.operator,
    value: value.value,
  }
}

function reset() {
  editingId.value = ''
  form.scopeIds = []
  form.capacity = null
  form.excludeStage = false
  form.operator = 'IN'
  form.stageIds = []
}

function edit(row: ResourceCapacityVO) {
  const filter = parseFilter(row)
  editingId.value = row.id
  form.scopeIds = row.scopeIds.map(canonical)
  form.capacity = row.capacity
  form.excludeStage = Boolean(filter)
  form.operator = filter?.operator ?? 'IN'
  form.stageIds = [...(filter?.value ?? [])]
}

function filterSummary(row: ResourceCapacityVO) {
  const filter = parseFilter(row)
  if (!filter) return '-'
  const names = filter.value.map((id) => stages.value.find((stage) => stage.id === id)?.name ?? id)
  return `商机阶段 ${filter.operator === 'IN' ? '属于' : '不属于'} ${names.join('、')}`
}

async function load() {
  loading.value = true
  try {
    const [{ data: capacityRows }, { data: stageRows }] = await Promise.all([
      resourceCapacityApi.list('customer'),
      opportunityApi.stages(),
      refs.members.value.length ? Promise.resolve(null) : refs.load(),
    ])
    rows.value = capacityRows
    stages.value = stageRows
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function save() {
  if (!form.scopeIds.length) return ElMessage.warning('请选择部门、成员或角色')
  if (canExclude.value && form.excludeStage && !form.stageIds.length) {
    return ElMessage.warning('请选择要排除的商机阶段')
  }
  saving.value = true
  try {
    const filters: CapacityFilter[] =
      canExclude.value && form.excludeStage
        ? [{ column: 'stage', operator: form.operator, value: [...form.stageIds] }]
        : []
    const payload = {
      module: 'customer',
      scopeIds: form.scopeIds,
      capacity: form.capacity,
      filters,
    }
    if (editingId.value) await resourceCapacityApi.update(editingId.value, payload)
    else await resourceCapacityApi.create(payload)
    ElMessage.success(editingId.value ? '客户库容已更新' : '客户库容已添加')
    reset()
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function remove(row: ResourceCapacityVO) {
  const ok = await ElMessageBox.confirm('确定删除该客户库容规则吗？', '删除客户库容', {
    type: 'warning',
    confirmButtonText: '确认删除',
    cancelButtonText: '取消',
  }).catch(() => false)
  if (!ok) return
  try {
    await resourceCapacityApi.remove(row.id, 'customer')
    ElMessage.success('已删除')
    if (editingId.value === row.id) reset()
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

watch(
  () => form.capacity,
  (capacity) => {
    if (capacity === null || capacity === 0) {
      form.excludeStage = false
      form.stageIds = []
    }
  },
)

watch(visible, (open) => {
  if (open) {
    reset()
    void load()
  }
})
</script>

<template>
  <el-drawer
    v-model="visible"
    title="客户库容设置"
    size="1000px"
    destroy-on-close
    data-testid="customer-capacity-settings-drawer"
  >
    <el-alert
      class="mb-4"
      type="info"
      :closable="false"
      title="同一实际成员只能命中一条客户库容规则；部门包含下级部门，角色会展开为角色成员。库容留空表示不限制，0 表示不能再持有客户。"
    />

    <div class="mb-4 grid grid-cols-[minmax(280px,1fr)_130px_130px_130px_minmax(220px,1fr)_auto] items-center gap-3">
      <el-select v-model="form.scopeIds" multiple filterable placeholder="选择部门、成员或角色">
        <el-option
          v-for="item in scopeOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-input-number
        v-model="form.capacity"
        :min="0"
        :max="1000000"
        placeholder="不限制"
        class="!w-full"
      />
      <el-select v-model="form.excludeStage" :disabled="!canExclude">
        <el-option label="不排除" :value="false" />
        <el-option label="排除商机阶段" :value="true" />
      </el-select>
      <el-select v-model="form.operator" :disabled="!canExclude || !form.excludeStage">
        <el-option label="属于" value="IN" />
        <el-option label="不属于" value="NOT_IN" />
      </el-select>
      <el-select
        v-model="form.stageIds"
        multiple
        filterable
        collapse-tags
        collapse-tags-tooltip
        placeholder="选择商机阶段"
        :disabled="!canExclude || !form.excludeStage"
      >
        <el-option v-for="stage in stages" :key="stage.id" :label="stage.name" :value="stage.id" />
      </el-select>
      <div class="whitespace-nowrap">
        <el-button v-if="editingId" @click="reset">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">
          {{ editingId ? '更新' : '添加' }}
        </el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="rows" border>
      <el-table-column label="部门或成员" min-width="320">
        <template #default="{ row }">{{ scopeLabel(row.scopeIds) }}</template>
      </el-table-column>
      <el-table-column label="客户库容" width="130">
        <template #default="{ row }">{{ row.capacity === null ? '不限制' : row.capacity }}</template>
      </el-table-column>
      <el-table-column label="不计入库容" min-width="320" show-overflow-tooltip>
        <template #default="{ row }">{{ filterSummary(row as ResourceCapacityVO) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="edit(row as ResourceCapacityVO)">编辑</el-button>
          <el-button link type="danger" @click="remove(row as ResourceCapacityVO)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-drawer>
</template>
