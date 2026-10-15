<script setup lang="ts">
import {
  type CustomerVO,
  type FieldVO,
  type FilterCondition,
  type ModuleQuickSearchConfig,
  type QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { Columns3, Download, Upload, UserRoundCog, UserRoundPlus } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  customerTransferApi,
  listCustomers,
  poolBatchAssignCustomers,
  poolBatchPickCustomers,
  poolDeleteCustomer,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import type { ImportType } from '@/api/import-export'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi, resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmResourceImportDialog from '@/components/resource-import/CrmResourceImportDialog.vue'
import CrmListPagination from '@/components/CrmListPagination.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import ModuleQuickSearch from '@/components/ModuleQuickSearch.vue'
import CustomerOverviewDrawer from '@/components/customer/CustomerOverviewDrawer.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const fieldRefs = useFieldRefs()
const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()

const pools = ref<ResourcePoolVO[]>([])
const selectedPoolId = ref('')
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<CustomerVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10 })
const filters = ref<FilterCondition[]>([])
const quickSearch = ref<ModuleQuickSearchConfig | null>(null)
const quickFilters = ref<FilterCondition[]>([])
const quickGroups = ref<QuickSearchQueryGroup[]>([])
const showQuickSearchPanel = computed(() => quickSearch.value?.enabled === true)
const showAdvanced = computed(() => quickSearch.value?.showAdvancedFilter !== false)
const showSavedViews = computed(() => quickSearch.value?.showSavedViews !== false)
const activeSavedViewId = ref('')
const visibleColumnKeys = ref<string[]>([])
const selectedRows = ref<CustomerVO[]>([])
const customerPoolTableRef = ref<{ clearSelection: () => void } | null>(null)
const importVisible = ref(false)

function downloadPoolImportTemplate(type: ImportType) {
  return customerTransferApi.importTemplate(type, selectedPoolId.value || undefined)
}
function downloadPoolImportErrorRows(file: File, rowNumbers: number[]) {
  return customerTransferApi.downloadImportErrorRows(
    file,
    rowNumbers,
    selectedPoolId.value || undefined,
  )
}
function precheckPoolImport(file: File, type: ImportType) {
  return customerTransferApi.importPrecheck(file, type, selectedPoolId.value || undefined)
}
function executePoolImport(file: File, type: ImportType) {
  return customerTransferApi.importXlsx(file, type, selectedPoolId.value || undefined)
}
const exportVisible = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)
const detailVisible = ref(false)
const detailCustomerId = ref<string | null>(null)
const assignVisible = ref(false)
const assignTarget = ref<CustomerVO | null>(null)
const batchAssignVisible = ref(false)
const pageReady = ref(false)
const savedViewReady = ref(false)
const initialLoadDone = ref(false)
let activeListRequestKey = ''
let activeListRequest: Promise<void> | null = null
let listRequestGeneration = 0

const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const canImport = computed(() => auth.hasPerm('customerPool:import'))
const canExport = computed(() => auth.hasPerm('customerPool:export'))
const defaultColumnKeys = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden).map((field) => field.key),
)
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const fieldMap = new Map(
    fields.value.filter((field) => !field.hidden).map((field) => [field.key, field]),
  )
  const hiddenIds = new Set(currentPool.value?.hiddenFieldIds ?? [])
  const ordered = keys
    .map((key) => fieldMap.get(key))
    .filter(
      (field): field is FieldVO => !!field && (field.key === 'name' || !hiddenIds.has(field.id)),
    )
  const nameField = fieldMap.get('name')
  if (nameField && !ordered.some((field) => field.key === 'name')) ordered.unshift(nameField)
  return ordered
})

async function loadFields() {
  // 客户和客户公海共用客户模块的表单字段与搜索设置。
  const { data } = await metadataApi.formConfig('customer')
  fields.value = data.fields
  quickSearch.value = data.formProp.quickSearch ?? null
  if (!showSavedViews.value) activeSavedViewId.value = ''
  if (!showAdvanced.value) filters.value = []
}

async function loadPoolOptions() {
  try {
    const { data } = await resourcePoolApi.options('customer')
    pools.value = data
    if (!selectedPoolId.value || !data.some((pool) => pool.id === selectedPoolId.value)) {
      selectedPoolId.value = data[0]?.id ?? ''
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  if (!selectedPoolId.value) {
    listRequestGeneration += 1
    items.value = []
    total.value = 0
    selectedRows.value = []
    return
  }

  const params = {
    page: query.page,
    pageSize: query.pageSize,
    scope: 'sea' as const,
    poolId: selectedPoolId.value,
    filters: [...filters.value, ...quickFilters.value].length
      ? JSON.stringify([...filters.value, ...quickFilters.value])
      : undefined,
    quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
    viewId: showSavedViews.value ? activeSavedViewId.value || undefined : undefined,
  }
  const requestKey = JSON.stringify(params)
  if (activeListRequest && activeListRequestKey === requestKey) return activeListRequest

  const requestGeneration = ++listRequestGeneration
  const request = (async () => {
    loading.value = true
    try {
      const { data } = await listCustomers(params)
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

function tryInitialLoad() {
  if (initialLoadDone.value || !pageReady.value || !savedViewReady.value) return
  initialLoadDone.value = true
  loadData()
}

function handleQuickSearch(value: {
  filters: FilterCondition[]
  quickGroups: QuickSearchQueryGroup[]
}) {
  quickFilters.value = value.filters
  quickGroups.value = value.quickGroups
  handleSearch()
}

function resetQuickSearch() {
  quickFilters.value = []
  quickGroups.value = []
  handleSearch()
}

function handleSearch() {
  query.page = 1
  loadData()
}

function handleSavedViewChange(viewId?: string) {
  if (!showSavedViews.value) return
  activeSavedViewId.value = viewId ?? ''
  query.page = 1
  if (!initialLoadDone.value) return
  loadData()
}

function handleSavedViewReady() {
  savedViewReady.value = true
  tryInitialLoad()
}

function handleSavedColumns(keys: string[]) {
  visibleColumnKeys.value = keys
}

function clearTemporaryFilters() {
  filters.value = []
}

function handleSelectionChange(rows: CustomerVO[]) {
  selectedRows.value = rows
}

function clearSelection() {
  customerPoolTableRef.value?.clearSelection()
  selectedRows.value = []
}

async function handleBatchClaim() {
  if (!selectedPoolId.value || !selectedRows.value.length) return
  const confirmed = await ElMessageBox.confirm(
    `确定领取已选择的 ${selectedRows.value.length} 个客户？领取限制、冷却和库容规则仍会逐条校验。`,
    '批量领取客户',
    { confirmButtonText: '领取', cancelButtonText: '取消' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    const { data } = await poolBatchPickCustomers(
      selectedPoolId.value,
      selectedRows.value.map((row) => row.id),
    )
    if (data.fail > 0) ElMessage.warning(`领取完成：成功 ${data.success} 个，失败 ${data.fail} 个`)
    else ElMessage.success(`已领取 ${data.success} 个客户`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchAssignConfirm(userId: string) {
  if (!selectedRows.value.length) return
  try {
    const { data } = await poolBatchAssignCustomers(
      selectedRows.value.map((row) => row.id),
      userId,
    )
    if (data.fail > 0) ElMessage.warning(`分配完成：成功 ${data.success} 个，失败 ${data.fail} 个`)
    else ElMessage.success(`已分配 ${data.success} 个客户`)
    batchAssignVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleClaim(row: CustomerVO) {
  const confirmed = await ElMessageBox.confirm(
    `领取客户「${row.name}」后，该客户将进入你的客户列表。`,
    '领取客户',
    { confirmButtonText: '领取', cancelButtonText: '取消' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await customerExtraApi.claim(row.id, row.poolId ?? selectedPoolId.value)
    ElMessage.success(`已领取「${row.name}」`)
    await loadData()
    window.open(`${window.location.origin}/customers?id=${encodeURIComponent(row.id)}`, '_blank')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleAssignConfirm(userId: string) {
  if (!assignTarget.value) return
  try {
    await customerExtraApi.assign(assignTarget.value.id, userId, true)
    ElMessage.success('已分配')
    assignVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openDetail(row: CustomerVO) {
  detailCustomerId.value = row.id
  detailVisible.value = true
}

async function handleDelete(row: CustomerVO) {
  const confirmed = await ElMessageBox.confirm(
    `确定删除公海客户「${row.name}」吗？已关联联系人时会拒绝删除。`,
    '删除公海客户',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await poolDeleteCustomer(row.id)
    ElMessage.success('客户已删除')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function transferParams() {
  return {
    page: query.page,
    pageSize: query.pageSize,
    scope: 'sea' as const,
    poolId: selectedPoolId.value || undefined,
    filters: [...filters.value, ...quickFilters.value].length
      ? JSON.stringify([...filters.value, ...quickFilters.value])
      : undefined,
    quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
    viewId: showSavedViews.value ? activeSavedViewId.value || undefined : undefined,
  }
}

function openExport(mode: 'all' | 'selected') {
  if (mode === 'selected' && selectedRows.value.length === 0) {
    ElMessage.warning('请先选择要导出的客户')
    return
  }
  exportMode.value = mode
  exportVisible.value = true
}

async function handleExportConfirm(payload: { fileName: string; headList: string[] }) {
  if (!selectedPoolId.value) {
    ElMessage.warning('请先选择客户公海')
    return
  }
  exportLoading.value = true
  try {
    if (exportMode.value === 'selected') {
      await customerTransferApi.exportSelected(
        transferParams(),
        { ...payload, ids: selectedRows.value.map((row) => row.id) },
        selectedPoolId.value,
      )
      selectedRows.value = []
    } else {
      await customerTransferApi.exportAll(transferParams(), payload, selectedPoolId.value)
    }
    exportVisible.value = false
    ElMessage.success('导出任务已创建，可在页面顶部“导出任务”中下载')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    exportLoading.value = false
  }
}

onMounted(async () => {
  await Promise.all([loadFields(), fieldRefs.load(), loadPoolOptions()])
  const queryPoolId = typeof route.query.poolId === 'string' ? route.query.poolId : ''
  if (queryPoolId && pools.value.some((pool) => pool.id === queryPoolId)) {
    selectedPoolId.value = queryPoolId
  }
  if (typeof route.query.id === 'string') {
    detailCustomerId.value = route.query.id
    detailVisible.value = true
  }
  pageReady.value = true
  if (!showSavedViews.value) savedViewReady.value = true
  tryInitialLoad()
})
</script>

<template>
  <div class="crm-data-list-workspace">
    <section v-if="quickSearch && showQuickSearchPanel" data-testid="module-search-panel">
      <el-card shadow="never">
        <div class="mb-4 flex items-center gap-2">
          <h2 class="text-base font-semibold text-[var(--el-text-color-primary)]">客户公海查询</h2>
          <span class="text-xs text-[var(--el-text-color-secondary)]">按配置条件筛选客户</span>
        </div>
        <ModuleQuickSearch
          :config="quickSearch"
          :fields="fields"
          @search="handleQuickSearch"
          @reset="resetQuickSearch"
        />
        <div v-if="showAdvanced" class="mt-3 flex justify-end">
          <AdvancedFilter
            v-model="filters"
            :fields="fields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
            @apply="(conditions) => ((filters = conditions), handleSearch())"
          />
        </div>
      </el-card>
    </section>
    <el-card shadow="never" class="crm-data-list-panel">
      <div
        v-if="showAdvanced && !showQuickSearchPanel"
        class="mb-4 flex flex-wrap items-center justify-end gap-2"
      >
        <AdvancedFilter
          v-model="filters"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(conditions) => ((filters = conditions), handleSearch())"
        />
      </div>

      <div :class="{ 'mb-4': showSavedViews }">
        <SavedViewBar
          ref="savedViewBarRef"
          module="customer_pool"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          :current-filters="filters"
          :default-column-keys="defaultColumnKeys"
          :show-view-toolbar="showSavedViews"
          @change="handleSavedViewChange"
          @clear-filters="clearTemporaryFilters"
          @columns-change="handleSavedColumns"
          @ready="handleSavedViewReady"
        />
      </div>

      <div class="crm-data-list-toolbar" data-testid="crm-table-primary-toolbar">
        <div class="flex min-w-0 flex-wrap items-center gap-4">
          <el-select
            v-model="selectedPoolId"
            class="!w-[200px]"
            placeholder="选择客户公海"
            @change="handleSearch"
          >
            <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
          </el-select>
          <span class="shrink-0 text-[14px] text-[#000000]">
            {{ selectedRows.length ? `已选${selectedRows.length}条客户` : `共${total}条客户` }}
          </span>
          <template v-if="selectedRows.length">
            <el-button
              v-if="auth.hasPerm('customerPool:pick')"
              class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
              @click="handleBatchClaim"
            >
              <UserRoundPlus :size="14" :stroke-width="1.8" aria-hidden="true" />批量领取
            </el-button>
            <el-button
              v-if="auth.hasPerm('customerPool:assign')"
              class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
              @click="batchAssignVisible = true"
            >
              <UserRoundCog :size="14" :stroke-width="1.8" aria-hidden="true" />批量分配
            </el-button>
            <el-button
              v-if="canExport"
              class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
              @click="openExport('selected')"
            >
              <Download :size="14" :stroke-width="1.8" aria-hidden="true" />批量导出
            </el-button>
            <button
              type="button"
              class="h-[36px] cursor-pointer border-0 bg-transparent px-1 py-0 text-[14px] leading-5 text-[#606266] hover:text-[var(--el-color-primary)]"
              @click="clearSelection"
            >
              取消选择
            </button>
          </template>
        </div>
        <div class="flex shrink-0 flex-wrap items-center gap-3">
          <el-button
            v-if="canExport && !selectedRows.length"
            :disabled="items.length === 0 || !selectedPoolId"
            class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
            @click="openExport('all')"
          >
            <Download :size="14" :stroke-width="1.8" aria-hidden="true" />导出全部
          </el-button>
          <el-button
            v-if="canImport"
            :disabled="!selectedPoolId"
            class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
            @click="importVisible = true"
          >
            <Upload :size="14" :stroke-width="1.8" aria-hidden="true" />批量导入
          </el-button>
          <el-button
            class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
            @click="savedViewBarRef?.openColumnSettings()"
          >
            <Columns3 :size="14" :stroke-width="1.8" aria-hidden="true" />列设置
          </el-button>
        </div>
      </div>

      <div class="crm-data-list-table">
        <el-table
          ref="customerPoolTableRef"
          v-loading="loading"
          :data="items"
          row-key="id"
          height="100%"
          class="w-full"
          @selection-change="handleSelectionChange"
        >
          <el-table-column
            v-if="
              auth.hasPerm('customerPool:pick') || auth.hasPerm('customerPool:assign') || canExport
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
                @click="openDetail(row as CustomerVO)"
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
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="auth.hasPerm('customerPool:pick')"
                link
                type="primary"
                @click="handleClaim(row as CustomerVO)"
                >领取</el-button
              >
              <el-button
                v-if="auth.hasPerm('customerPool:assign')"
                link
                @click="((assignTarget = row as CustomerVO), (assignVisible = true))"
              >
                分配
              </el-button>
              <el-button
                v-if="auth.hasPerm('customerPool:delete')"
                link
                type="danger"
                @click="handleDelete(row as CustomerVO)"
              >
                删除
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <CrmListPagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          @current-change="loadData"
          @size-change="handleSearch"
        />
      </div>

      <CustomerOverviewDrawer
        v-model="detailVisible"
        :customer-id="detailCustomerId"
        pool
        :pool-id="selectedPoolId"
        :hidden-field-ids="currentPool?.hiddenFieldIds ?? []"
        @changed="loadData"
        @deleted="loadData"
      />

      <MemberSelectDialog
        v-model="assignVisible"
        :title="`分配客户「${assignTarget?.name ?? ''}」`"
        :members="fieldRefs.members.value"
        @confirm="handleAssignConfirm"
      />

      <MemberSelectDialog
        v-model="batchAssignVisible"
        :title="`批量分配客户（${selectedRows.length}）`"
        :members="fieldRefs.members.value"
        @confirm="handleBatchAssignConfirm"
      />

      <CrmResourceImportDialog
        v-model="importVisible"
        module-label="客户公海"
        :download-template="downloadPoolImportTemplate"
        :download-error-rows="downloadPoolImportErrorRows"
        :precheck="precheckPoolImport"
        :execute="executePoolImport"
        @success="loadData"
      />

      <CrmExportDrawer
        v-model="exportVisible"
        module-label="客户公海"
        :cache-key="`customer-pool:${selectedPoolId}`"
        :fields="fields"
        :display-fields="[
          { key: 'lastFollowedAt', label: '最近跟进' },
          { key: 'createdAt', label: '创建时间' },
          { key: 'updatedAt', label: '更新时间' },
        ]"
        :mode="exportMode"
        :selected-count="selectedRows.length"
        :loading="exportLoading"
        @confirm="handleExportConfirm"
      />
    </el-card>
  </div>
</template>
