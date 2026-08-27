<script setup lang="ts">
import {
  type HomeFilterPayload,
  LEAD_STATUS_LABELS,
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type LeadVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi, type LeadListParams, type ResourcePoolVO } from '@/api/sales'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import LeadModuleNav from '@/components/leads/LeadModuleNav.vue'
import LeadOverviewDrawer from '@/components/leads/LeadOverviewDrawer.vue'
import LeadPoolQuickSettingDrawer from '@/components/leads/LeadPoolQuickSettingDrawer.vue'
import LeadTransformDialog from '@/components/leads/LeadTransformDialog.vue'
import LeadTransitionCustomerDrawer from '@/components/leads/LeadTransitionCustomerDrawer.vue'
import { consumeHomeFilter } from '@/utils/home-filter'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const homeQuickCreate = useHomeQuickCreate()
const route = useRoute()
const router = useRouter()

const isPoolMode = computed(() => route.name === 'lead-pool')
const pools = ref<ResourcePoolVO[]>([])
const selectedPoolId = ref('')
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<LeadVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })
const filters = ref<FilterCondition[]>([])
const activeHomeFilter = ref<HomeFilterPayload | null>(null)
const activeSavedViewId = ref('')
const visibleColumnKeys = ref<string[]>([])
const selectedRows = ref<LeadVO[]>([])
const batchEditVisible = ref(false)
const batchTransferVisible = ref(false)
const batchPoolAssignVisible = ref(false)
const poolSettingVisible = ref(false)
const exportVisible = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})

const followVisible = ref(false)
const followTarget = ref<LeadVO | null>(null)
const overviewVisible = ref(false)
const overviewTarget = ref<LeadVO | null>(null)
const pageReady = ref(false)
let routeGeneration = 0
let activeListRequestKey = ''
let activeListRequest: Promise<void> | null = null
let listRequestGeneration = 0

const convertVisible = ref(false)
const convertTarget = ref<LeadVO | null>(null)
const transitionCustomerVisible = ref(false)
const transitionClueIds = ref<string[]>([])

const savedViewModule = computed(() => (isPoolMode.value ? 'lead_pool' : 'lead'))
const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const canImport = computed(() =>
  isPoolMode.value ? auth.hasPerm('leadPool:import') : auth.hasPerm('lead:import'),
)
const canExport = computed(() =>
  isPoolMode.value ? auth.hasPerm('leadPool:export') : auth.hasPerm('lead:export'),
)
const contextFields = computed(() => {
  const hiddenIds = isPoolMode.value
    ? new Set(currentPool.value?.hiddenFieldIds ?? [])
    : new Set<string>()
  return fields.value.filter(
    (field) => !field.hidden && (field.key === 'name' || !hiddenIds.has(field.id)),
  )
})
const defaultColumnKeys = computed(() =>
  contextFields.value.filter((field) => field.showInList).map((field) => field.key),
)
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const fieldMap = new Map(contextFields.value.map((field) => [field.key, field]))
  const ordered = keys
    .map((key) => fieldMap.get(key))
    .filter((field): field is FieldVO => !!field)
  const nameField = fieldMap.get('name')
  if (isPoolMode.value && nameField && !ordered.some((field) => field.key === 'name')) {
    ordered.unshift(nameField)
  }
  return ordered
})

async function loadFields() {
  const { data } = await metadataApi.fields('lead')
  fields.value = data
}

async function loadPoolOptions() {
  try {
    const { data } = await leadApi.poolOptions()
    pools.value = data
    if (!selectedPoolId.value || !data.some((pool) => pool.id === selectedPoolId.value)) {
      selectedPoolId.value = data[0]?.id ?? ''
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handlePoolSettingSaved() {
  await loadPoolOptions()
  handleSearch()
}

function currentListParams(): LeadListParams {
  return {
    page: query.page,
    pageSize: query.pageSize,
    keyword: query.keyword.trim() || undefined,
    scope: isPoolMode.value ? 'pool' : 'mine',
    poolId: isPoolMode.value ? selectedPoolId.value || undefined : undefined,
    status: query.status || undefined,
    filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
    viewId: activeSavedViewId.value || undefined,
    homeFilter: activeHomeFilter.value ? JSON.stringify(activeHomeFilter.value) : undefined,
  }
}

async function loadData() {
  if (!pageReady.value) return
  if (isPoolMode.value && !selectedPoolId.value) {
    items.value = []
    total.value = 0
    selectedRows.value = []
    return
  }

  const params = currentListParams()
  const requestKey = JSON.stringify(params)
  if (activeListRequest && activeListRequestKey === requestKey) {
    return activeListRequest
  }

  const requestGeneration = ++listRequestGeneration
  const request = (async () => {
    loading.value = true
    try {
      const { data } = await leadApi.list(params)
      if (requestGeneration !== listRequestGeneration) return
      items.value = data.items
      total.value = data.total
      selectedRows.value = []
    } catch (error) {
      if (requestGeneration !== listRequestGeneration) return
      ElMessage.error(extractErrorMessage(error))
    } finally {
      if (requestGeneration === listRequestGeneration) loading.value = false
    }
  })()

  activeListRequestKey = requestKey
  activeListRequest = request
  try {
    await request
  } finally {
    if (activeListRequest === request) {
      activeListRequest = null
      activeListRequestKey = ''
    }
  }
}

function handleSearch() {
  query.page = 1
  loadData()
}

function handlePoolChange() {
  query.page = 1
  activeSavedViewId.value = ''
  visibleColumnKeys.value = []
  filters.value = []
  selectedRows.value = []
  loadData()
}

watch(
  () => route.name,
  async () => {
    const generation = ++routeGeneration
    pageReady.value = false
    query.page = 1
    activeHomeFilter.value = null
    activeSavedViewId.value = ''
    visibleColumnKeys.value = []
    filters.value = []
    selectedRows.value = []
    if (isPoolMode.value) await loadPoolOptions()
    if (generation !== routeGeneration) return
    pageReady.value = true
    await loadData()
  },
  { flush: 'sync' },
)

function handleSelectionChange(rows: LeadVO[]) {
  selectedRows.value = rows
}

async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  if (selectedRows.value.length === 0) return
  try {
    const ids = selectedRows.value.map((row) => row.id)
    if (isPoolMode.value) {
      if (!selectedPoolId.value) throw new Error('请先选择线索池')
      await leadApi.poolBatchUpdate({ poolId: selectedPoolId.value, ids, ...payload })
    } else {
      await leadApi.batchUpdate({ ids, ...payload })
    }
    ElMessage.success(`已修改 ${selectedRows.value.length} 条线索`)
    batchEditVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchDelete() {
  if (selectedRows.value.length === 0) return
  const confirmed = await ElMessageBox.confirm(
    `确定删除已选择的 ${selectedRows.value.length} 条线索？此操作不可恢复。`,
    '批量删除线索',
    { type: 'warning', confirmButtonText: '删除' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    const ids = selectedRows.value.map((row) => row.id)
    if (isPoolMode.value) {
      if (!selectedPoolId.value) throw new Error('请先选择线索池')
      await leadApi.poolBatchDelete(selectedPoolId.value, ids)
    } else {
      await leadApi.batchDelete(ids)
    }
    ElMessage.success('批量删除成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openBatchTransfer() {
  if (selectedRows.value.length === 0) return
  batchTransferVisible.value = true
}

async function handleBatchTransferConfirm(userId: string) {
  if (selectedRows.value.length === 0) return
  try {
    await leadApi.batchTransfer(
      selectedRows.value.map((row) => row.id),
      userId,
    )
    batchTransferVisible.value = false
    ElMessage.success(`已转移 ${selectedRows.value.length} 条线索`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchToPool() {
  if (selectedRows.value.length === 0) return
  const confirmed = await ElMessageBox.confirm(
    `确定将已选择的 ${selectedRows.value.length} 条线索移入匹配的线索池？`,
    '移入线索池',
    { type: 'warning', confirmButtonText: '移入' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    const { data } = await leadApi.batchToPool(selectedRows.value.map((row) => row.id))
    if (data.fail > 0) ElMessage.warning(`成功 ${data.success} 条，失败 ${data.fail} 条`)
    else ElMessage.success(`已将 ${data.success} 条线索移入线索池`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchPick() {
  if (!selectedPoolId.value || selectedRows.value.length === 0) return
  const confirmed = await ElMessageBox.confirm(
    `确定领取已选择的 ${selectedRows.value.length} 条线索？`,
    '批量领取',
    { type: 'warning', confirmButtonText: '领取' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    const { data } = await leadApi.poolBatchPick(
      selectedPoolId.value,
      selectedRows.value.map((row) => row.id),
    )
    if (data.fail > 0) ElMessage.warning(`成功 ${data.success} 条，失败 ${data.fail} 条`)
    else ElMessage.success(`已领取 ${data.success} 条线索`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openBatchPoolAssign() {
  if (!selectedPoolId.value || selectedRows.value.length === 0) return
  batchPoolAssignVisible.value = true
}

async function handleBatchPoolAssignConfirm(userId: string) {
  if (!selectedPoolId.value || selectedRows.value.length === 0) return
  try {
    const { data } = await leadApi.poolBatchAssign(
      selectedPoolId.value,
      selectedRows.value.map((row) => row.id),
      userId,
    )
    batchPoolAssignVisible.value = false
    if (data.fail > 0) ElMessage.warning(`成功 ${data.success} 条，失败 ${data.fail} 条`)
    else ElMessage.success(`已分配 ${data.success} 条线索`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function handleSavedViewChange(viewId?: string) {
  activeSavedViewId.value = viewId ?? ''
  query.page = 1
  if (!pageReady.value) return
  loadData()
}

function handleSavedColumns(keys: string[]) {
  visibleColumnKeys.value = keys
}

function clearTemporaryFilters() {
  filters.value = []
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  dialogVisible.value = true
}

function openEdit(row: LeadVO) {
  editingId.value = row.id
  formModel.value = Object.fromEntries(
    fields.value
      .filter((f) => f.type !== 'formula')
      .map((f) => [
        f.key,
        isCustomFieldKey(f.key)
          ? row.customData[f.key]
          : f.key === 'contact'
            ? row.contactName
            : f.key === 'owner'
              ? row.ownerId
              : (row as unknown as Record<string, unknown>)[f.key],
      ]),
  )
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  const isCreate = !editingId.value
  saving.value = true
  try {
    const payload: Record<string, unknown> = { moduleFields: [] }
    const fieldMap = new Map(fields.value.map((field) => [field.key, field]))
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      const field = fieldMap.get(key)
      if (isCustomFieldKey(key)) {
        if (!field) continue
        ;(payload.moduleFields as Array<{ fieldId: string; fieldValue: unknown }>).push({
          fieldId: field.id,
          fieldValue: value,
        })
      } else if (key === 'owner') payload.owner = value
      else if (key === 'contact') payload.contact = value
      else payload[key] = value
    }
    if (editingId.value) {
      await leadApi.update(editingId.value, payload)
      ElMessage.success('线索已更新')
    } else {
      await leadApi.create(payload)
      ElMessage.success('线索已创建')
    }
    dialogVisible.value = false
    if (isCreate && (await homeQuickCreate.completeCreated())) return
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleClaim(row: LeadVO) {
  try {
    const poolId = row.poolId ?? selectedPoolId.value
    if (!poolId) throw new Error('请选择线索池')
    await leadApi.claim(row.id, poolId)
    ElMessage.success(`已领取「${row.name}」`)
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleToPool(row: LeadVO) {
  const confirmed = await ElMessageBox.confirm(`将「${row.name}」退回线索池？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await leadApi.toPool(row.id, selectedPoolId.value || undefined)
    ElMessage.success('已退回线索池')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: LeadVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除「${row.name}」？此操作不可恢复。`, '删除线索', {
    type: 'warning',
    confirmButtonText: '删除',
  }).catch(() => false)
  if (!confirmed) return
  try {
    if (isPoolMode.value) {
      const poolId = row.poolId ?? selectedPoolId.value
      if (!poolId) throw new Error('请选择线索池')
      await leadApi.poolBatchDelete(poolId, [row.id])
    } else {
      await leadApi.remove(row.id)
    }
    ElMessage.success('线索已删除')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

const assignVisible = ref(false)
const assignTarget = ref<LeadVO | null>(null)
const importVisible = ref(false)

function transferParams(): LeadListParams {
  return {
    keyword: query.keyword.trim() || undefined,
    scope: isPoolMode.value ? 'pool' : 'mine',
    poolId: isPoolMode.value ? selectedPoolId.value || undefined : undefined,
    status: query.status || undefined,
    filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
    viewId: activeSavedViewId.value || undefined,
  }
}

function openExport(mode: 'all' | 'selected') {
  if (mode === 'selected' && selectedRows.value.length === 0) {
    ElMessage.warning('请先选择要导出的线索')
    return
  }
  exportMode.value = mode
  exportVisible.value = true
}

async function handleExportConfirm(payload: { fileName: string; headList: string[] }) {
  exportLoading.value = true
  try {
    const poolId = isPoolMode.value ? selectedPoolId.value || undefined : undefined
    if (isPoolMode.value && !poolId) throw new Error('请先选择线索池')
    if (exportMode.value === 'selected') {
      await leadApi.exportSelected(
        transferParams(),
        { ...payload, ids: selectedRows.value.map((row) => row.id) },
        poolId,
      )
      selectedRows.value = []
    } else {
      await leadApi.exportAll(transferParams(), payload, poolId)
    }
    exportVisible.value = false
    ElMessage.success('导出任务已创建，可在页面顶部“导出任务”中下载')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    exportLoading.value = false
  }
}

function handleAssign(row: LeadVO) {
  assignTarget.value = row
  assignVisible.value = true
}

async function handleAssignConfirm(userId: string) {
  if (!assignTarget.value) return
  try {
    if (isPoolMode.value) await leadApi.poolAssign(assignTarget.value.id, userId)
    else await leadApi.transfer(assignTarget.value.id, userId)
    ElMessage.success('已分配')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openFollow(row: LeadVO) {
  followTarget.value = row
  followVisible.value = true
}

function openOverview(row: LeadVO) {
  overviewTarget.value = row
  overviewVisible.value = true
}

function handleOverviewEdit(row: LeadVO) {
  overviewVisible.value = false
  if (isPoolMode.value) {
    selectedRows.value = [row]
    batchEditVisible.value = true
    return
  }
  openEdit(row)
}

function handleOverviewFollow(row: LeadVO) {
  overviewVisible.value = false
  openFollow(row)
}

function handleOverviewConvert(row: LeadVO) {
  overviewVisible.value = false
  openConvert(row)
}

async function handleOverviewToPool(row: LeadVO) {
  await handleToPool(row)
  overviewVisible.value = false
}

function handleOverviewTransfer(row: LeadVO) {
  overviewVisible.value = false
  handleAssign(row)
}

async function handleOverviewDelete(row: LeadVO) {
  await handleDelete(row)
  overviewVisible.value = false
}

async function handleOverviewClaim(row: LeadVO) {
  await handleClaim(row)
  overviewVisible.value = false
}

function handleOverviewAssign(row: LeadVO) {
  overviewVisible.value = false
  handleAssign(row)
}

function openConvert(row: LeadVO) {
  convertTarget.value = row
  convertVisible.value = true
}

function openTransitionCustomer(ids: string[]) {
  transitionClueIds.value = ids
  transitionCustomerVisible.value = true
}

const homeFilterSummary = computed(() => {
  if (!activeHomeFilter.value) return ''
  const periodLabel = {
    TODAY: '今天',
    THIS_WEEK: '本周',
    THIS_MONTH: '本月',
    THIS_YEAR: '本年',
  }[activeHomeFilter.value.period]
  const scopeLabel =
    activeHomeFilter.value.searchType === 'SELF'
      ? '本人'
      : activeHomeFilter.value.searchType === 'ALL'
        ? '全部有权数据'
        : '指定部门'
  return `来自首页：${periodLabel} · ${scopeLabel}`
})

function clearHomeFilter() {
  activeHomeFilter.value = null
  query.page = 1
  loadData()
}

async function consumeRouteHomeFilter() {
  const token = route.query.homeFilter
  if (!token) return
  const payload = consumeHomeFilter(token, 'lead')
  const nextQuery = { ...route.query }
  delete nextQuery.homeFilter
  await router.replace({ path: route.path, query: nextQuery })
  if (!payload) {
    ElMessage.warning('首页筛选已失效或格式不正确')
    return
  }
  if (isPoolMode.value) {
    await router.replace('/leads')
  }
  activeHomeFilter.value = payload
  query.page = 1
}

onMounted(async () => {
  const generation = ++routeGeneration
  pageReady.value = false
  await consumeRouteHomeFilter()
  if (generation !== routeGeneration) return
  await Promise.all([
    loadFields(),
    fieldRefs.load(),
    ...(isPoolMode.value ? [loadPoolOptions()] : []),
  ])
  if (generation !== routeGeneration) return
  if (!isPoolMode.value) await homeQuickCreate.consume(openCreate)
  if (generation !== routeGeneration) return
  pageReady.value = true
  await loadData()
})
</script>

<template>
  <el-card shadow="never">
    <LeadModuleNav :active="isPoolMode ? 'pool' : 'lead'" />

    <el-alert
      v-if="activeHomeFilter"
      :title="homeFilterSummary"
      type="info"
      show-icon
      class="mb-4"
      @close="clearHomeFilter"
    />

    <SavedViewBar
      :module="savedViewModule"
      :fields="contextFields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      @change="handleSavedViewChange"
      @clear-filters="clearTemporaryFilters"
      @columns-change="handleSavedColumns"
    />

    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="!isPoolMode">
          <el-button v-if="auth.hasPerm('lead:create')" type="primary" @click="openCreate">
            新建线索
          </el-button>
          <el-button v-if="canImport" @click="importVisible = true">导入</el-button>
          <el-button v-if="canExport" :disabled="items.length === 0" @click="openExport('all')">
            导出全部
          </el-button>
        </template>
        <template v-else>
          <el-select
            v-model="selectedPoolId"
            class="!w-52"
            placeholder="选择线索池"
            @change="handlePoolChange"
          >
            <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
          </el-select>
          <el-button
            v-if="currentPool?.editable"
            title="设置当前线索池"
            @click="poolSettingVisible = true"
          >
            设置
          </el-button>
          <el-button v-if="canImport" :disabled="!selectedPoolId" @click="importVisible = true">
            导入
          </el-button>
          <el-button v-if="canExport" :disabled="items.length === 0" @click="openExport('all')">
            导出全部
          </el-button>
        </template>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="搜索名称 / 联系人 / 电话"
          clearable
          class="!w-60"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select
          v-model="query.status"
          clearable
          placeholder="状态"
          class="!w-28"
          @change="handleSearch"
        >
          <el-option
            v-for="(label, value) in LEAD_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <AdvancedFilter
          v-model="filters"
          :fields="contextFields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>
    </div>

    <div v-if="selectedRows.length > 0" class="mb-4 flex flex-wrap items-center gap-2">
      <el-button v-if="canExport" @click="openExport('selected')">
        导出选中（{{ selectedRows.length }}）
      </el-button>

      <template v-if="!isPoolMode">
        <el-button v-if="auth.hasPerm('lead:transfer')" @click="openBatchTransfer">
          批量转移
        </el-button>
        <el-button v-if="auth.hasPerm('lead:recycle')" @click="handleBatchToPool">
          移入线索池
        </el-button>
        <el-button
          v-if="auth.hasPerm('lead:update')"
          @click="openTransitionCustomer(selectedRows.map((row) => row.id))"
        >
          关联客户
        </el-button>
        <el-button v-if="auth.hasPerm('lead:update')" @click="batchEditVisible = true">
          批量修改
        </el-button>
        <el-button
          v-if="auth.hasPerm('lead:delete')"
          type="danger"
          plain
          @click="handleBatchDelete"
        >
          批量删除
        </el-button>
      </template>

      <template v-else>
        <el-button v-if="auth.hasPerm('leadPool:pick')" @click="handleBatchPick">批量领取</el-button>
        <el-button v-if="auth.hasPerm('leadPool:assign')" @click="openBatchPoolAssign">
          批量分配
        </el-button>
        <el-button v-if="auth.hasPerm('leadPool:update')" @click="batchEditVisible = true">
          批量修改
        </el-button>
        <el-button
          v-if="auth.hasPerm('leadPool:delete')"
          type="danger"
          plain
          @click="handleBatchDelete"
        >
          批量删除
        </el-button>
      </template>
    </div>

    <el-table
      v-loading="loading"
      :data="items"
      row-key="id"
      stripe
      class="w-full"
      @selection-change="handleSelectionChange"
    >
      <el-table-column
        v-if="
          (!isPoolMode &&
            (canExport ||
              auth.hasPerm('lead:transfer') ||
              auth.hasPerm('lead:recycle') ||
              auth.hasPerm('lead:update') ||
              auth.hasPerm('lead:delete'))) ||
          (isPoolMode &&
            (canExport ||
              auth.hasPerm('leadPool:pick') ||
              auth.hasPerm('leadPool:assign') ||
              auth.hasPerm('leadPool:update') ||
              auth.hasPerm('leadPool:delete')))
        "
        type="selection"
        width="46"
      />
      <el-table-column
        v-for="column in listColumns"
        :key="column.key"
        :label="column.label"
        :min-width="column.listWidth ?? 140"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-button
            v-if="column.key === 'name'"
            link
            type="primary"
            @click="openOverview(row as LeadVO)"
          >
            {{
              formatFieldValue(column, row, {
                memberMap: fieldRefs.memberMap.value,
                deptMap: fieldRefs.deptMap.value,
              })
            }}
          </el-button>
          <template v-else>
            {{
              formatFieldValue(column, row, {
                memberMap: fieldRefs.memberMap.value,
                deptMap: fieldRefs.deptMap.value,
              })
            }}
          </template>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag
            :type="
              row.status === 'SUCCESS'
                ? 'success'
                : row.status === 'FAIL'
                  ? 'info'
                  : row.status === 'INTERESTED'
                    ? 'warning'
                    : 'primary'
            "
            size="small"
          >
            {{ LEAD_STATUS_LABELS[row.status as keyof typeof LEAD_STATUS_LABELS] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最近跟进" width="110">
        <template #default="{ row }">
          {{ row.lastFollowedAt ? new Date(row.lastFollowedAt).toLocaleDateString() : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <template v-if="isPoolMode">
            <el-button
              v-if="auth.hasPerm('leadPool:pick')"
              link
              type="primary"
              @click="handleClaim(row as LeadVO)"
            >
              领取
            </el-button>
            <el-button
              v-if="auth.hasPerm('leadPool:assign')"
              link
              @click="handleAssign(row as LeadVO)"
            >
              分配
            </el-button>
            <el-button
              v-if="auth.hasPerm('leadPool:delete')"
              link
              type="danger"
              @click="handleDelete(row as LeadVO)"
            >
              删除
            </el-button>
          </template>
          <template v-else-if="!['CUSTOMER', 'OPPORTUNITY'].includes(row.transitionType ?? '')">
            <el-button v-if="auth.hasPerm('lead:update')" link @click="openEdit(row as LeadVO)">
              编辑
            </el-button>
            <el-button v-if="auth.hasPerm('lead:update')" link @click="openFollow(row as LeadVO)">
              跟进
            </el-button>
            <el-button
              v-if="auth.hasPerm('lead:update')"
              link
              type="primary"
              @click="openConvert(row as LeadVO)"
            >
              转换
            </el-button>
            <el-dropdown trigger="click">
              <el-button link>更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="auth.hasPerm('lead:recycle')" @click="handleToPool(row as LeadVO)">
                    移入线索池
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:transfer')"
                    @click="handleAssign(row as LeadVO)"
                  >
                    转移
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:delete')"
                    divided
                    @click="handleDelete(row as LeadVO)"
                  >
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @current-change="loadData"
        @size-change="handleSearch"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑线索' : '新建线索'"
      width="640px"
      destroy-on-close
    >
      <DynamicForm
        ref="dynamicFormRef"
        v-model="formModel"
        :fields="fields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <LeadOverviewDrawer
      v-model="overviewVisible"
      :mode="isPoolMode ? 'pool' : 'lead'"
      :lead="overviewTarget"
      :fields="contextFields"
      @edit="handleOverviewEdit"
      @follow="handleOverviewFollow"
      @convert="handleOverviewConvert"
      @to-pool="handleOverviewToPool"
      @transfer="handleOverviewTransfer"
      @delete="handleOverviewDelete"
      @claim="handleOverviewClaim"
      @assign="handleOverviewAssign"
    />

    <LeadTransformDialog
      v-model="convertVisible"
      :lead="convertTarget"
      @success="loadData"
      @finish="loadData"
    />

    <LeadTransitionCustomerDrawer
      v-model="transitionCustomerVisible"
      :clue-ids="transitionClueIds"
      @finish="loadData"
    />

    <FollowUpDrawer
      v-model="followVisible"
      target-type="lead"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="loadData"
    />

    <MemberSelectDialog
      v-model="assignVisible"
      :title="`分配线索「${assignTarget?.name ?? ''}」`"
      :members="fieldRefs.members.value"
      @confirm="handleAssignConfirm"
    />

    <MemberSelectDialog
      v-model="batchTransferVisible"
      :title="`批量转移 ${selectedRows.length} 条线索`"
      :members="fieldRefs.members.value"
      @confirm="handleBatchTransferConfirm"
    />

    <MemberSelectDialog
      v-model="batchPoolAssignVisible"
      :title="`批量分配 ${selectedRows.length} 条线索`"
      :members="fieldRefs.members.value"
      @confirm="handleBatchPoolAssignConfirm"
    />

    <LeadPoolQuickSettingDrawer
      v-model="poolSettingVisible"
      :pool="currentPool"
      :fields="fields"
      @saved="handlePoolSettingSaved"
    />

    <CrmImportDialog
      v-model="importVisible"
      :module-label="isPoolMode ? '线索池' : '线索'"
      :download-template="
        (type) =>
          leadApi.importTemplate(
            type,
            isPoolMode ? selectedPoolId || undefined : undefined,
          )
      "
      :precheck="
        (file, type) =>
          leadApi.importPrecheck(
            file,
            type,
            isPoolMode ? selectedPoolId || undefined : undefined,
          )
      "
      :execute="
        (file, type) =>
          leadApi.importXlsx(
            file,
            type,
            isPoolMode ? selectedPoolId || undefined : undefined,
          )
      "
      @success="loadData"
    />

    <CrmExportDrawer
      v-model="exportVisible"
      :module-label="isPoolMode ? '线索池' : '线索'"
      :cache-key="isPoolMode ? `lead-pool:${selectedPoolId}` : 'lead'"
      :fields="contextFields"
      :display-fields="[
        { key: 'status', label: '状态' },
        { key: 'lastFollowedAt', label: '最近跟进' },
        { key: 'createdAt', label: '创建时间' },
        { key: 'updatedAt', label: '更新时间' },
      ]"
      :mode="exportMode"
      :selected-count="selectedRows.length"
      :loading="exportLoading"
      @confirm="handleExportConfirm"
    />

    <BatchFieldEditDialog
      v-model="batchEditVisible"
      title="批量修改线索"
      :fields="contextFields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :selected-count="selectedRows.length"
      @confirm="handleBatchEdit"
    />

  </el-card>
</template>
