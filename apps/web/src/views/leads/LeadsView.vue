<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import {
  DEFAULT_LEAD_STAGES,
  type HomeFilterPayload,
  isCustomFieldKey,
  type FieldVO,
  type ModuleFormProp,
  type FilterCondition,
  type ModuleQuickSearchConfig,
  type QuickSearchQueryGroup,
  type LeadStageConfig,
  type LeadVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi, type LeadListParams, type ResourcePoolVO } from '@/api/sales'
import type { ImportType } from '@/api/import-export'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmResourceImportDialog from '@/components/resource-import/CrmResourceImportDialog.vue'
import LeadListTable from '@/components/leads/LeadListTable.vue'
import LeadListToolbar from '@/components/leads/LeadListToolbar.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import ModuleQuickSearch from '@/components/ModuleQuickSearch.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useLeadBatchActions } from '@/composables/useLeadBatchActions'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import LeadOverviewDrawer from '@/components/leads/LeadOverviewDrawer.vue'
import LeadMoveToPoolDialog from '@/components/leads/LeadMoveToPoolDialog.vue'
import LeadTransferDialog from '@/components/leads/LeadTransferDialog.vue'
import LeadTransformDialog from '@/components/leads/LeadTransformDialog.vue'
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
const formProp = ref<ModuleFormProp>({})
const formDialogWidth = computed(
  () => ({ small: '640px', medium: '840px', large: '1080px' })[formProp.value.viewSize ?? 'small'],
)
const leadStages = ref<LeadStageConfig[]>([])
const loading = ref(false)
const items = ref<LeadVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })
const filters = ref<FilterCondition[]>([])
const quickSearch = ref<ModuleQuickSearchConfig | null>(null)
const quickFilters = ref<FilterCondition[]>([])
const quickGroups = ref<QuickSearchQueryGroup[]>([])
const showQuickSearchPanel = computed(() => quickSearch.value?.enabled === true)
const showLegacySearch = computed(() => !showQuickSearchPanel.value)
const showAdvanced = computed(() => quickSearch.value?.showAdvancedFilter !== false)
const showSavedViews = computed(() => quickSearch.value?.showSavedViews !== false)
const activeHomeFilter = ref<HomeFilterPayload | null>(null)
const activeSavedViewId = ref('')
const visibleColumnKeys = ref<string[]>([])
const selectedRows = ref<LeadVO[]>([])
const batchInvalidLoading = ref(false)
const leadListTableRef = ref<InstanceType<typeof LeadListTable>>()
const batchEditVisible = ref(false)
const batchTransferVisible = ref(false)
const transferVisible = ref(false)
const transferTarget = ref<LeadVO | null>(null)
const transferSaving = ref(false)
const batchPoolAssignVisible = ref(false)
const moveToPoolVisible = ref(false)
const moveToPoolTarget = ref<LeadVO | null>(null)
const moveToPoolBatch = ref(false)
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
const canManualConvert = computed(
  () =>
    auth.hasPerm('lead:convert') && auth.hasPerm('lead:update') && auth.hasPerm('customer:create'),
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
  const ordered = keys.map((key) => fieldMap.get(key)).filter((field): field is FieldVO => !!field)
  const nameField = fieldMap.get('name')
  if (isPoolMode.value && nameField && !ordered.some((field) => field.key === 'name')) {
    ordered.unshift(nameField)
  }
  return ordered
})

async function loadFields() {
  const { data } = await metadataApi.formConfig('lead')
  fields.value = data.fields
  formProp.value = data.formProp
  quickSearch.value = data.formProp.quickSearch ?? null
  if (quickSearch.value?.enabled) query.status = ''
  if (!showSavedViews.value) activeSavedViewId.value = ''
  if (quickSearch.value && !quickSearch.value.showAdvancedFilter) filters.value = []
  leadStages.value = (
    data.formProp.leadStages?.length ? data.formProp.leadStages : DEFAULT_LEAD_STAGES
  ).map((stage) => ({ ...stage, enabled: stage.enabled !== false }))
}

async function handleStageChange(row: LeadVO, stageKey: string) {
  if (!stageKey || row.status === stageKey) return
  try {
    const { data } = await leadApi.updateStage(row.id, stageKey)
    row.status = data.stage
    ElMessage.success('线索状态已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchInvalid() {
  if (batchInvalidLoading.value || isPoolMode.value || !auth.hasPerm('lead:update')) return
  const selected = [...selectedRows.value]
  if (!selected.length) return

  // 与服务端 markInvalid 保持一致：状态由租户启用的失败类阶段决定。
  const invalidStage = leadStages.value.find(
    (stage) => stage.enabled !== false && stage.kind === 'FAILURE',
  )
  if (!invalidStage) {
    ElMessage.warning('尚未配置启用的失败类线索状态，请先在线索状态设置中配置')
    return
  }

  const needUpdate = selected.filter((row) => row.status !== invalidStage.key)
  if (!needUpdate.length) {
    ElMessage.info(`已选 ${selected.length} 条线索均处于「${invalidStage.name}」状态`)
    return
  }

  const confirmed = await ElMessageBox.confirm(
    `确定将选中的 ${needUpdate.length} 条线索状态修改为「${invalidStage.name}」？`,
    '批量无效',
    { type: 'warning', confirmButtonText: '确认修改', cancelButtonText: '取消' },
  ).catch(() => false)
  if (!confirmed) return

  batchInvalidLoading.value = true
  try {
    let success = 0
    let failed = 0
    // 复用单条更新状态的权限、事件审计及历史记录处理，限制并发避免请求突增。
    for (let index = 0; index < needUpdate.length; index += 5) {
      const batch = needUpdate.slice(index, index + 5)
      const results = await Promise.allSettled(
        batch.map((row) => leadApi.updateStage(row.id, invalidStage.key)),
      )
      for (const result of results) {
        if (result.status === 'fulfilled') success += 1
        else failed += 1
      }
    }
    if (failed) ElMessage.warning(`批量无效：成功 ${success} 条，失败 ${failed} 条`)
    else ElMessage.success(`已将 ${success} 条线索状态修改为「${invalidStage.name}」`)
    if (success) await loadData()
  } finally {
    batchInvalidLoading.value = false
  }
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

function currentListParams(): LeadListParams {
  return {
    page: query.page,
    pageSize: query.pageSize,
    keyword: query.keyword.trim() || undefined,
    scope: isPoolMode.value ? 'pool' : 'mine',
    poolId: isPoolMode.value ? selectedPoolId.value || undefined : undefined,
    status: query.status || undefined,
    filters: [...filters.value, ...quickFilters.value].length
      ? JSON.stringify([...filters.value, ...quickFilters.value])
      : undefined,
    quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
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

function handleQuickSearch(value: {
  filters: FilterCondition[]
  quickGroups: QuickSearchQueryGroup[]
}) {
  query.keyword = ''
  quickFilters.value = value.filters
  quickGroups.value = value.quickGroups
  handleSearch()
}
function resetQuickSearch() {
  query.keyword = ''
  quickFilters.value = []
  quickGroups.value = []
  handleSearch()
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
    quickFilters.value = []
    quickGroups.value = []
    query.keyword = ''
    selectedRows.value = []
    if (isPoolMode.value) await loadPoolOptions()
    if (generation !== routeGeneration) return
    pageReady.value = true
    await loadData()
    if (generation !== routeGeneration) return
    await consumeRouteLeadDeepLink()
  },
  { flush: 'sync' },
)

function handleSelectionChange(rows: LeadVO[]) {
  selectedRows.value = rows
}

function clearSelection() {
  leadListTableRef.value?.clearSelection()
  selectedRows.value = []
}

const {
  handleBatchEdit,
  openBatchTransfer,
  handleBatchTransferConfirm,
  handleBatchToPool,
  confirmMoveToPool,
  handleBatchPick,
  openBatchPoolAssign,
  handleBatchPoolAssignConfirm,
} = useLeadBatchActions({
  selectedRows,
  isPoolMode,
  selectedPoolId,
  batchEditVisible,
  batchTransferVisible,
  transferSaving,
  moveToPoolTarget,
  moveToPoolBatch,
  moveToPoolVisible,
  batchPoolAssignVisible,
  loadData,
})

function handleSavedViewChange(viewId?: string) {
  activeSavedViewId.value = showSavedViews.value ? (viewId ?? '') : ''
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

function handleToPool(row: LeadVO) {
  moveToPoolTarget.value = row
  moveToPoolBatch.value = false
  moveToPoolVisible.value = true
}

async function handleDelete(row: LeadVO) {
  const confirmed = await ElMessageBox.confirm(
    `确定删除「${row.name}」？此操作不可恢复。`,
    '删除线索',
    {
      type: 'warning',
      confirmButtonText: '删除',
    },
  ).catch(() => false)
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

/** 将导入接口调用留在 script 中，避免 Vue 模板内联箭头函数的自动解包类型误判。 */
function currentImportPoolId(): string | undefined {
  return isPoolMode.value ? selectedPoolId.value || undefined : undefined
}

function downloadLeadImportTemplate(type: ImportType) {
  return leadApi.importTemplate(type, currentImportPoolId())
}

function precheckLeadImport(file: File, type: ImportType) {
  return leadApi.importPrecheck(file, type, currentImportPoolId())
}

function downloadLeadImportErrorRows(file: File, rowNumbers: number[]) {
  return leadApi.downloadImportErrorRows(file, rowNumbers, currentImportPoolId())
}

function executeLeadImport(file: File, type: ImportType) {
  return leadApi.importXlsx(file, type, currentImportPoolId())
}

function transferParams(): LeadListParams {
  return {
    keyword: query.keyword.trim() || undefined,
    scope: isPoolMode.value ? 'pool' : 'mine',
    poolId: isPoolMode.value ? selectedPoolId.value || undefined : undefined,
    status: query.status || undefined,
    filters: [...filters.value, ...quickFilters.value].length
      ? JSON.stringify([...filters.value, ...quickFilters.value])
      : undefined,
    quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
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
  if (!isPoolMode.value) {
    transferTarget.value = row
    transferVisible.value = true
    return
  }
  assignTarget.value = row
  assignVisible.value = true
}

async function handleAssignConfirm(userId: string) {
  if (!assignTarget.value) return
  try {
    await leadApi.poolAssign(assignTarget.value.id, userId)
    ElMessage.success('已分配')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleTransferConfirm(userId: string, note: string) {
  if (!transferTarget.value || transferSaving.value) return
  transferSaving.value = true
  try {
    await leadApi.transfer(transferTarget.value.id, userId, note)
    transferVisible.value = false
    ElMessage.success('线索转移成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    transferSaving.value = false
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
  if (!canManualConvert.value) return
  convertTarget.value = row
  convertVisible.value = true
}

const homeFilterSummary = computed(() => {
  if (!activeHomeFilter.value) return ''
  const periodLabel = activeHomeFilter.value.period
    ? {
        TODAY: '今天',
        THIS_WEEK: '本周',
        THIS_MONTH: '本月',
        THIS_YEAR: '本年',
      }[activeHomeFilter.value.period]
    : '工作台筛选'
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
  filters.value = []
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
  filters.value = [...(payload.filters ?? [])]
  query.page = 1
}

async function consumeRouteLeadDeepLink() {
  const id = typeof route.query.id === 'string' ? route.query.id : ''
  if (!id) return
  if (isPoolMode.value) {
    const queryPoolId = typeof route.query.poolId === 'string' ? route.query.poolId : ''
    if (queryPoolId && pools.value.some((pool) => pool.id === queryPoolId)) {
      selectedPoolId.value = queryPoolId
    }
  }
  try {
    const { data } = await leadApi.get(id, isPoolMode.value)
    if (isPoolMode.value && data.poolId && pools.value.some((pool) => pool.id === data.poolId)) {
      selectedPoolId.value = data.poolId
    }
    overviewTarget.value = data
    overviewVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    const nextQuery = { ...route.query }
    delete nextQuery.id
    delete nextQuery.name
    delete nextQuery.poolId
    delete nextQuery.transitionType
    await router.replace({ path: route.path, query: nextQuery })
  }
}

watch(
  () => [route.query.id, route.query.poolId] as const,
  () => {
    if (pageReady.value) void consumeRouteLeadDeepLink()
  },
)

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
  if (generation !== routeGeneration) return
  await consumeRouteLeadDeepLink()
  if (
    route.query.import === '1' &&
    canImport.value &&
    (!isPoolMode.value || selectedPoolId.value)
  ) {
    importVisible.value = true
    const nextQuery = { ...route.query }
    delete nextQuery.import
    await router.replace({ path: route.path, query: nextQuery })
  }
})
</script>

<template>
  <div class="lead-list-workspace">
    <section v-if="quickSearch && showQuickSearchPanel" data-testid="module-search-panel">
      <el-card shadow="never">
        <div class="mb-4 flex items-center gap-2">
          <h2 class="text-base font-semibold text-[var(--el-text-color-primary)]">
            {{ isPoolMode ? '线索池查询' : '招生线索' }}
          </h2>
          <span class="text-xs text-[var(--el-text-color-secondary)]">按配置条件筛选线索</span>
        </div>
        <el-alert
          v-if="activeHomeFilter"
          :title="homeFilterSummary"
          type="info"
          show-icon
          class="mb-4"
          @close="clearHomeFilter"
        />
        <ModuleQuickSearch
          :config="quickSearch"
          :fields="contextFields"
          :lead-stages="leadStages"
          @search="handleQuickSearch"
          @reset="resetQuickSearch"
        />
        <div v-if="showAdvanced" class="mt-3 flex justify-end">
          <AdvancedFilter
            v-model="filters"
            :fields="contextFields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
            @apply="(c) => ((filters = c), handleSearch())"
          />
        </div>
      </el-card>
    </section>

    <el-card shadow="never" class="lead-table-panel" data-testid="module-table-panel">
      <el-alert
        v-if="activeHomeFilter && !showQuickSearchPanel"
        :title="homeFilterSummary"
        type="info"
        show-icon
        class="mb-4"
        @close="clearHomeFilter"
      />

      <LeadListToolbar
        v-model:selected-pool-id="selectedPoolId"
        v-model:keyword-value="query.keyword"
        v-model:status-value="query.status"
        v-model:filters-value="filters"
        :is-pool-mode="isPoolMode"
        :can-import="canImport"
        :can-export="canExport"
        :pools="pools"
        :items-count="items.length"
        :total-count="total"
        :loading="loading"
        :show-legacy-search="showLegacySearch"
        :show-advanced="showAdvanced"
        :show-quick-search-panel="showQuickSearchPanel"
        :show-saved-views="showSavedViews"
        :lead-stages="leadStages"
        :context-fields="contextFields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
        :saved-view-module="savedViewModule"
        :default-column-keys="defaultColumnKeys"
        :selected-rows="selectedRows"
        :batch-invalid-loading="batchInvalidLoading"
        @open-import="importVisible = true"
        @open-create="openCreate"
        @open-batch-transfer="openBatchTransfer"
        @open-batch-to-pool="handleBatchToPool"
        @open-batch-pool-assign="openBatchPoolAssign"
        @open-export="openExport"
        @batch-invalid="handleBatchInvalid"
        @search="handleSearch"
        @pool-change="handlePoolChange"
        @refresh="loadData"
        @saved-view-change="handleSavedViewChange"
        @clear-temporary-filters="clearTemporaryFilters"
        @saved-columns="handleSavedColumns"
        @batch-pick="handleBatchPick"
        @clear-selection="clearSelection"
      />

      <LeadListTable
        ref="leadListTableRef"
        v-model:page="query.page"
        v-model:page-size="query.pageSize"
        :items="items"
        :loading="loading"
        :is-pool-mode="isPoolMode"
        :can-export="canExport"
        :can-manual-convert="canManualConvert"
        :list-columns="listColumns"
        :lead-stages="leadStages"
        :member-map="fieldRefs.memberMap.value"
        :dept-map="fieldRefs.deptMap.value"
        :total="total"
        @selection-change="handleSelectionChange"
        @stage-change="handleStageChange"
        @open-overview="openOverview"
        @claim="handleClaim"
        @assign="handleAssign"
        @remove="handleDelete"
        @edit="openEdit"
        @follow="openFollow"
        @convert="openConvert"
        @to-pool="handleToPool"
        @page-change="loadData"
        @size-change="handleSearch"
      />

      <CrmDialog
        v-model="dialogVisible"
        :title="editingId ? '编辑线索' : '新建线索'"
        :width="formDialogWidth"
        destroy-on-close
      >
        <DynamicForm
          ref="dynamicFormRef"
          v-model="formModel"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          :form-prop="formProp"
        />
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
        </template>
      </CrmDialog>

      <LeadOverviewDrawer
        v-model="overviewVisible"
        :mode="isPoolMode ? 'pool' : 'lead'"
        :lead="overviewTarget"
        :fields="contextFields"
        :lead-stages="leadStages"
        :can-convert="canManualConvert"
        @edit="handleOverviewEdit"
        @convert="handleOverviewConvert"
        @to-pool="handleOverviewToPool"
        @transfer="handleOverviewTransfer"
        @delete="handleOverviewDelete"
        @claim="handleOverviewClaim"
        @assign="handleOverviewAssign"
        @changed="loadData"
      />

      <LeadTransformDialog
        v-model="convertVisible"
        :lead="convertTarget"
        @success="loadData"
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

      <LeadTransferDialog
        v-model="transferVisible"
        :count="1"
        :members="fieldRefs.members.value"
        :loading="transferSaving"
        @confirm="handleTransferConfirm"
      />

      <LeadTransferDialog
        v-model="batchTransferVisible"
        :count="selectedRows.length"
        :members="fieldRefs.members.value"
        :loading="transferSaving"
        @confirm="handleBatchTransferConfirm"
      />

      <MemberSelectDialog
        v-model="batchPoolAssignVisible"
        :title="`批量分配 ${selectedRows.length} 条线索`"
        :members="fieldRefs.members.value"
        @confirm="handleBatchPoolAssignConfirm"
      />

      <LeadMoveToPoolDialog
        v-model="moveToPoolVisible"
        :title="moveToPoolBatch ? '批量移入线索池' : '移入线索池'"
        :description="
          moveToPoolBatch
            ? `确定将已选择的 ${selectedRows.length} 条线索移入线索池？`
            : `将「${moveToPoolTarget?.name ?? ''}」移入线索池？`
        "
        @confirm="confirmMoveToPool"
      />

      <CrmResourceImportDialog
        v-model="importVisible"
        :module-label="isPoolMode ? '线索池' : '线索'"
        :download-template="downloadLeadImportTemplate"
        :download-error-rows="downloadLeadImportErrorRows"
        :precheck="precheckLeadImport"
        :execute="executeLeadImport"
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
  </div>
</template>

<style scoped>
/* 列表工作区填满 el-main 的可视高度，由表格内部承担纵向滚动。 */
.lead-list-workspace {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: min-content;
  min-width: 0;
}

.lead-list-workspace > [data-testid='module-search-panel'] {
  flex: none;
}

.lead-table-panel {
  --el-card-border-radius: 8px;
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  min-height: 260px;
  border-radius: 8px;
}
.lead-table-panel :deep(.el-card__body) {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 16px 20px;
}
</style>
