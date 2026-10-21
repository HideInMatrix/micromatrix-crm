<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import {
  type HomeFilterPayload,
  isCustomFieldKey,
  type CustomerVO,
  type FieldVO,
  type ModuleFormProp,
  type FilterCondition,
  type ModuleQuickSearchConfig,
  type QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { Columns3, Download, FolderInput, GitMerge, Plus, Upload, UserRoundCog } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  batchTransferCustomers,
  checkDuplicate,
  createCustomer,
  customerTransferApi,
  getCustomer,
  getCustomerTabs,
  listCustomers,
  removeCustomer,
  updateCustomer,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi } from '@/api/sales'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmResourceImportDialog from '@/components/resource-import/CrmResourceImportDialog.vue'
import CrmListPagination from '@/components/CrmListPagination.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import ModuleQuickSearch from '@/components/ModuleQuickSearch.vue'
import CustomerMoveToPoolDialog from '@/components/customer/CustomerMoveToPoolDialog.vue'
import CustomerMergeDialog from '@/components/CustomerMergeDialog.vue'
import CustomerOverviewDrawer from '@/components/customer/CustomerOverviewDrawer.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'
import { confirmIfDuplicates } from '@/utils/duplicate'
import { consumeHomeFilter } from '@/utils/home-filter'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const fieldRefs = useFieldRefs()
const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()
const homeQuickCreate = useHomeQuickCreate()

type CustomerSystemView = 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'
const systemViews = ref<{ id: CustomerSystemView; label: string }[]>([])
const activeSystemView = ref<CustomerSystemView | ''>('')
const fields = ref<FieldVO[]>([])
const formProp = ref<ModuleFormProp>({})
const formDialogWidth = computed(
  () => ({ small: '640px', medium: '840px', large: '1080px' })[formProp.value.viewSize ?? 'small'],
)
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
const activeHomeFilter = ref<HomeFilterPayload | null>(null)
const activeSavedViewId = ref('')
const visibleColumnKeys = ref<string[]>([])

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})

const followVisible = ref(false)
const followTarget = ref<CustomerVO | null>(null)
const assignVisible = ref(false)
const assignTarget = ref<CustomerVO | null>(null)
const batchTransferVisible = ref(false)
const mergeVisible = ref(false)
const moveToPoolVisible = ref(false)
const moveToPoolIds = ref<string[]>([])
const moveToPoolName = ref('')
const selectedRows = ref<CustomerVO[]>([])
const customerTableRef = ref<{ clearSelection: () => void } | null>(null)
const exportVisible = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)
const overviewVisible = ref(false)
const overviewCustomerId = ref<string | null>(null)
const pageReady = ref(false)
const savedViewReady = ref(false)
const initialLoadDone = ref(false)

const savedViewModule = 'customer'
const isCollaborationView = computed(() => activeSystemView.value === 'COLLABORATION')
const canImport = computed(() => !isCollaborationView.value && auth.hasPerm('customer:import'))
const canExport = computed(() => !isCollaborationView.value && auth.hasPerm('customer:export'))
const defaultColumnKeys = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden).map((field) => field.key),
)
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const fieldMap = new Map(
    fields.value.filter((field) => !field.hidden).map((field) => [field.key, field]),
  )
  return keys.map((key) => fieldMap.get(key)).filter((field): field is FieldVO => !!field)
})

async function loadFields() {
  const { data: config } = await metadataApi.formConfig('customer')
  fields.value = config.fields
  formProp.value = config.formProp
  quickSearch.value = config.formProp.quickSearch ?? null
  if (!showSavedViews.value) activeSavedViewId.value = ''
  if (!quickSearch.value?.showAdvancedFilter) filters.value = []
}

async function loadSystemViews() {
  try {
    const { data } = await getCustomerTabs()
    const next: { id: CustomerSystemView; label: string }[] = []
    if (data.all) next.push({ id: 'ALL', label: '全部客户' })
    next.push({ id: 'SELF', label: '我的客户' })
    if (data.dept) next.push({ id: 'DEPARTMENT', label: '部门客户' })
    next.push({ id: 'COLLABORATION', label: '协作客户' })
    systemViews.value = next
    if (!showSavedViews.value) {
      // 视图功能关闭时不应静默限定为“我的客户”，仍按当前用户的数据权限查询。
      activeSystemView.value = ''
    } else if (
      !activeSavedViewId.value &&
      (!activeSystemView.value || !next.some((item) => item.id === activeSystemView.value))
    ) {
      activeSystemView.value = next[0]?.id ?? 'SELF'
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: query.page,
      pageSize: query.pageSize,
      view: activeSystemView.value || undefined,
      filters: [...filters.value, ...quickFilters.value].length
        ? JSON.stringify([...filters.value, ...quickFilters.value])
        : undefined,
      quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
      viewId: activeSavedViewId.value || undefined,
      homeFilter: activeHomeFilter.value ? JSON.stringify(activeHomeFilter.value) : undefined,
    })
    items.value = data.items
    total.value = data.total
    selectedRows.value = []
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
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

function handleSystemViewChange(viewId?: string) {
  if (!showSavedViews.value) return
  activeSystemView.value = (viewId as CustomerSystemView | undefined) ?? ''
  if (!viewId) return
  query.page = 1
  activeSavedViewId.value = ''
  selectedRows.value = []
  if (!initialLoadDone.value) return
  loadData()
}

function handleSavedViewChange(viewId?: string) {
  activeSavedViewId.value = showSavedViews.value ? (viewId ?? '') : ''
  if (showSavedViews.value && viewId) activeSystemView.value = ''
  query.page = 1
  if (!viewId && activeSystemView.value) return
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

const homeFilterSummary = computed(() => {
  if (!activeHomeFilter.value) return ''
  const scopeLabel =
    activeHomeFilter.value.searchType === 'SELF'
      ? '本人'
      : activeHomeFilter.value.searchType === 'ALL'
        ? '全部有权数据'
        : '指定部门'
  return `来自工作台：${scopeLabel}`
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
  const payload = consumeHomeFilter(token, 'customer')
  const nextQuery = { ...route.query }
  delete nextQuery.homeFilter
  await router.replace({ path: route.path, query: nextQuery })
  if (!payload) {
    ElMessage.warning('工作台筛选已失效或格式不正确')
    return
  }
  activeHomeFilter.value = payload
  filters.value = [...(payload.filters ?? [])]
  query.page = 1
}

function handleSelectionChange(rows: CustomerVO[]) {
  selectedRows.value = rows
}

function clearSelection() {
  customerTableRef.value?.clearSelection()
  selectedRows.value = []
}

function handleCustomerMerged() {
  clearSelection()
  void loadData()
}

function openBatchTransfer() {
  if (!selectedRows.value.length) return
  batchTransferVisible.value = true
}

async function handleBatchTransferConfirm(userId: string) {
  if (!selectedRows.value.length) return
  try {
    const { data } = await batchTransferCustomers(
      selectedRows.value.map((row) => row.id),
      userId,
    )
    if (data.fail > 0) ElMessage.warning(`转移完成：成功 ${data.success} 个，失败 ${data.fail} 个`)
    else ElMessage.success(`已转移 ${data.success} 个客户`)
    batchTransferVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openMoveToPool(rows: CustomerVO[]) {
  if (!rows.length) return
  moveToPoolIds.value = rows.map((row) => row.id)
  moveToPoolName.value = rows.length === 1 ? (rows[0]?.name ?? '') : ''
  moveToPoolVisible.value = true
}

function buildDefaultModel(): Record<string, unknown> {
  const model: Record<string, unknown> = {}
  for (const field of fields.value) {
    if (field.hidden || field.type === 'formula') continue
    const defaultValue = field.config?.defaultValue
    if (defaultValue !== undefined) model[field.key] = defaultValue
  }
  return model
}

function rowToModel(row: CustomerVO): Record<string, unknown> {
  const model: Record<string, unknown> = {}
  for (const field of fields.value) {
    if (field.type === 'formula') continue
    model[field.key] = isCustomFieldKey(field.key)
      ? row.customData[field.key]
      : (row as unknown as Record<string, unknown>)[field.key]
  }
  return model
}

function modelToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === '') continue
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }
  payload.customData = customData
  return payload
}

function openCreate() {
  editingId.value = null
  formModel.value = buildDefaultModel()
  dialogVisible.value = true
}

function openEdit(row: CustomerVO) {
  editingId.value = row.id
  formModel.value = rowToModel(row)
  dialogVisible.value = true
}

async function handleSave() {
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  const isCreate = !editingId.value
  saving.value = true
  try {
    const payload = modelToPayload(formModel.value)
    if (!editingId.value) {
      const { data: hits } = await checkDuplicate({
        name: String(payload.name ?? ''),
        phone: payload.phone ? String(payload.phone) : undefined,
      })
      const proceed = await confirmIfDuplicates(hits, '创建')
      if (!proceed) {
        saving.value = false
        return
      }
    }
    if (editingId.value) {
      await updateCustomer(editingId.value, payload)
      ElMessage.success('客户已更新')
    } else {
      await createCustomer(payload)
      ElMessage.success('客户已创建')
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

async function handleDelete(row: CustomerVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除客户「${row.name}」吗？`, '删除确认', {
    type: 'warning',
    confirmButtonText: '删除',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await removeCustomer(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleAssignConfirm(userId: string) {
  if (!assignTarget.value) return
  try {
    await customerExtraApi.assign(assignTarget.value.id, userId)
    ElMessage.success('客户已转移')
    assignVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openDetail(row: CustomerVO) {
  overviewCustomerId.value = row.id
  overviewVisible.value = true
}

const importVisible = ref(false)

function transferParams() {
  return {
    view: activeSystemView.value || undefined,
    filters: [...filters.value, ...quickFilters.value].length
      ? JSON.stringify([...filters.value, ...quickFilters.value])
      : undefined,
    quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
    viewId: activeSavedViewId.value || undefined,
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
  exportLoading.value = true
  try {
    if (exportMode.value === 'selected') {
      await customerTransferApi.exportSelected(transferParams(), {
        ...payload,
        ids: selectedRows.value.map((row) => row.id),
      })
      selectedRows.value = []
    } else {
      await customerTransferApi.exportAll(transferParams(), payload)
    }
    exportVisible.value = false
    ElMessage.success('导出任务已创建，可在页面顶部“导出任务”中下载')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    exportLoading.value = false
  }
}

async function openFollow(row: CustomerVO) {
  try {
    const { data } = await getCustomer(row.id)
    if (data.canCollaborateWrite !== true) {
      ElMessage.info('当前客户仅允许查看，不能新增跟进')
      return
    }
    followTarget.value = data
    followVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  await Promise.all([loadFields(), fieldRefs.load(), loadSystemViews()])
  await consumeRouteHomeFilter()
  await homeQuickCreate.consume(openCreate)
  if (typeof route.query.id === 'string') {
    overviewCustomerId.value = route.query.id
    overviewVisible.value = true
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
          <h2 class="text-base font-semibold text-[var(--el-text-color-primary)]">客户查询</h2>
          <span class="text-xs text-[var(--el-text-color-secondary)]">按配置条件筛选客户</span>
        </div>
        <el-alert
          v-if="activeHomeFilter"
          :title="homeFilterSummary"
          type="info"
          show-icon
          closable
          class="mb-4"
          @close="clearHomeFilter"
        />
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
            @apply="(c) => ((filters = c), handleSearch())"
          />
        </div>
      </el-card>
    </section>

    <el-card shadow="never" class="crm-data-list-panel" data-testid="module-table-panel">
      <el-alert
        v-if="activeHomeFilter && !showQuickSearchPanel"
        :title="homeFilterSummary"
        type="info"
        show-icon
        class="mb-4"
        closable
        @close="clearHomeFilter"
      />
      <div
        v-if="showAdvanced && !showQuickSearchPanel"
        class="mb-4 flex flex-wrap items-center justify-end gap-2"
      >
        <AdvancedFilter
          v-model="filters"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>

      <div :class="{ 'mb-4': showSavedViews }">
        <SavedViewBar
          ref="savedViewBarRef"
          :module="savedViewModule"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          :current-filters="filters"
          :default-column-keys="defaultColumnKeys"
          :show-view-toolbar="showSavedViews"
          :system-views="systemViews"
          :system-view="activeSystemView"
          @change="handleSavedViewChange"
          @system-view-change="handleSystemViewChange"
          @clear-filters="clearTemporaryFilters"
          @columns-change="handleSavedColumns"
          @ready="handleSavedViewReady"
        />
      </div>

      <div class="crm-data-list-toolbar" data-testid="crm-table-primary-toolbar">
        <div class="flex min-w-0 flex-wrap items-center gap-4">
          <span class="shrink-0 text-[14px] text-[#000000]">
            {{ selectedRows.length ? `已选${selectedRows.length}条客户` : `共${total}条客户` }}
          </span>
          <template v-if="!isCollaborationView && selectedRows.length">
            <el-button
              v-if="auth.hasPerm('customer:transfer')"
              class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
              @click="openBatchTransfer"
            >
              <UserRoundCog :size="14" :stroke-width="1.8" aria-hidden="true" />批量转移
            </el-button>
            <el-button
              v-if="auth.hasPerm('customer:recycle')"
              class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
              @click="openMoveToPool(selectedRows)"
            >
              <FolderInput :size="14" :stroke-width="1.8" aria-hidden="true" />批量移入公海
            </el-button>
            <el-button
              v-if="auth.hasPerm('customer:merge')"
              class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
              @click="mergeVisible = true"
            >
              <GitMerge :size="14" :stroke-width="1.8" aria-hidden="true" />合并客户
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
            :disabled="items.length === 0"
            class="crm-data-list-toolbar__action crm-data-list-toolbar__outline"
            @click="openExport('all')"
          >
            <Download :size="14" :stroke-width="1.8" aria-hidden="true" />导出全部
          </el-button>
          <el-button
            v-if="canImport"
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
          <el-button
            v-if="!isCollaborationView && auth.hasPerm('customer:create')"
            type="primary"
            class="crm-data-list-toolbar__action crm-data-list-toolbar__primary"
            @click="openCreate"
          >
            <Plus :size="14" :stroke-width="1.8" aria-hidden="true" />新建客户
          </el-button>
        </div>
      </div>

      <div class="crm-data-list-table">
        <el-table
          ref="customerTableRef"
          v-loading="loading"
          :data="items"
          row-key="id"
          height="100%"
          class="w-full"
          @selection-change="handleSelectionChange"
        >
          <el-table-column
            v-if="
              !isCollaborationView &&
              (auth.hasPerm('customer:transfer') || auth.hasPerm('customer:recycle') || canExport)
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
          <el-table-column label="操作" width="210" fixed="right">
            <template #default="{ row }">
              <el-button
                v-if="!isCollaborationView && auth.hasPerm('customer:update')"
                link
                @click="openEdit(row as CustomerVO)"
              >
                编辑
              </el-button>
              <el-button link @click="openFollow(row as CustomerVO)">跟进</el-button>
              <el-dropdown
                v-if="
                  !isCollaborationView &&
                  (auth.hasPerm('customer:transfer') ||
                    auth.hasPerm('customer:recycle') ||
                    auth.hasPerm('customer:delete'))
                "
                trigger="click"
              >
                <el-button link>更多</el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item
                      v-if="auth.hasPerm('customer:transfer')"
                      @click="((assignTarget = row as CustomerVO), (assignVisible = true))"
                    >
                      转移
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-if="auth.hasPerm('customer:recycle')"
                      @click="openMoveToPool([row as CustomerVO])"
                    >
                      移入公海
                    </el-dropdown-item>
                    <el-dropdown-item
                      v-if="auth.hasPerm('customer:delete')"
                      :style="{ color: '#f04438', '--el-dropdown-menuItem-hover-fill': '#feedec' }"
                      :divided="
                        auth.hasPerm('customer:transfer') || auth.hasPerm('customer:recycle')
                      "
                      @click="handleDelete(row as CustomerVO)"
                    >
                      删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
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

      <CrmDialog
        v-model="dialogVisible"
        class="crm-resource-form-dialog"
        :title="editingId ? '编辑客户' : '新建客户'"
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

      <FollowUpDrawer
        v-model="followVisible"
        target-type="customer"
        :target-id="followTarget?.id ?? null"
        :target-name="followTarget?.name"
        @followed="loadData"
      />

      <MemberSelectDialog
        v-model="assignVisible"
        :title="`转移客户「${assignTarget?.name ?? ''}」`"
        :members="fieldRefs.members.value"
        @confirm="handleAssignConfirm"
      />

      <MemberSelectDialog
        v-model="batchTransferVisible"
        :title="`批量转移客户（${selectedRows.length}）`"
        :members="fieldRefs.members.value"
        @confirm="handleBatchTransferConfirm"
      />

      <CustomerMergeDialog
        v-model="mergeVisible"
        :selected-rows="selectedRows"
        @merged="handleCustomerMerged"
      />

      <CustomerMoveToPoolDialog
        v-model="moveToPoolVisible"
        :customer-ids="moveToPoolIds"
        :customer-name="moveToPoolName"
        @moved="loadData"
      />

      <CrmResourceImportDialog
        v-model="importVisible"
        module-label="客户"
        :download-template="customerTransferApi.importTemplate"
        :download-error-rows="customerTransferApi.downloadImportErrorRows"
        :precheck="customerTransferApi.importPrecheck"
        :execute="customerTransferApi.importXlsx"
        @success="loadData"
      />

      <CrmExportDrawer
        v-model="exportVisible"
        module-label="客户"
        cache-key="customer"
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

  <CustomerOverviewDrawer
    v-model="overviewVisible"
    :customer-id="overviewCustomerId"
    @changed="loadData"
    @deleted="loadData"
  />
</template>
