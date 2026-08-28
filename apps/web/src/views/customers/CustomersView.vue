<script setup lang="ts">
import {
  isCustomFieldKey,
  type CustomerVO,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  batchDeleteCustomers,
  batchTransferCustomers,
  batchUpdateCustomers,
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
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import CustomerModuleNav from '@/components/CustomerModuleNav.vue'
import CustomerMergeDialog from '@/components/CustomerMergeDialog.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import CustomerMoveToPoolDialog from '@/components/customer/CustomerMoveToPoolDialog.vue'
import CustomerOverviewDrawer from '@/components/customer/CustomerOverviewDrawer.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'
import { confirmIfDuplicates } from '@/utils/duplicate'

const auth = useAuthStore()
const route = useRoute()
const fieldRefs = useFieldRefs()
const homeQuickCreate = useHomeQuickCreate()

type CustomerSystemView = 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'
const systemViews = ref<{ id: CustomerSystemView; label: string }[]>([])
const activeSystemView = ref<CustomerSystemView | ''>('')
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<CustomerVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '' })
const filters = ref<FilterCondition[]>([])
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
const moveToPoolVisible = ref(false)
const moveToPoolIds = ref<string[]>([])
const moveToPoolName = ref('')
const mergeVisible = ref(false)
const selectedRows = ref<CustomerVO[]>([])
const batchEditVisible = ref(false)
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
  const { data } = await metadataApi.fields('customer')
  fields.value = data
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
    if (
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
      keyword: query.keyword.trim() || undefined,
      view: activeSystemView.value || undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
      viewId: activeSavedViewId.value || undefined,
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

function handleSearch() {
  query.page = 1
  loadData()
}

function handleSystemViewChange(viewId?: string) {
  activeSystemView.value = (viewId as CustomerSystemView | undefined) ?? ''
  if (!viewId) return
  query.page = 1
  activeSavedViewId.value = ''
  selectedRows.value = []
  if (!initialLoadDone.value) return
  loadData()
}

function handleSavedViewChange(viewId?: string) {
  activeSavedViewId.value = viewId ?? ''
  if (viewId) activeSystemView.value = ''
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

function handleSelectionChange(rows: CustomerVO[]) {
  selectedRows.value = rows
}

function openMerge() {
  if (selectedRows.value.length < 2) {
    ElMessage.warning('请至少选择 2 个客户')
    return
  }
  mergeVisible.value = true
}

function handleMerged(targetId: string) {
  selectedRows.value = []
  mergeVisible.value = false
  overviewCustomerId.value = targetId
  overviewVisible.value = true
  loadData()
}

async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  if (selectedRows.value.length === 0) return
  try {
    const ids = selectedRows.value.map((row) => row.id)
    await batchUpdateCustomers({ ids, ...payload })
    ElMessage.success(`已修改 ${selectedRows.value.length} 个客户`)
    batchEditVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchDelete() {
  if (selectedRows.value.length === 0) return
  const confirmed = await ElMessageBox.confirm(
    `确定删除已选择的 ${selectedRows.value.length} 个客户？存在联系人、商机或交易数据的客户会阻止整批删除。`,
    '批量删除客户',
    { type: 'warning', confirmButtonText: '删除' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    const ids = selectedRows.value.map((row) => row.id)
    await batchDeleteCustomers(ids)
    ElMessage.success('批量删除成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openBatchTransfer() {
  if (!selectedRows.value.length) return
  batchTransferVisible.value = true
}

async function handleBatchTransferConfirm(userId: string) {
  if (!selectedRows.value.length) return
  try {
    const { data } = await batchTransferCustomers(selectedRows.value.map((row) => row.id), userId)
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
  moveToPoolName.value = rows.length === 1 ? rows[0]?.name ?? '' : ''
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
    keyword: query.keyword.trim() || undefined,
    view: activeSystemView.value || undefined,
    filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
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
  await homeQuickCreate.consume(openCreate)
  if (typeof route.query.id === 'string') {
    overviewCustomerId.value = route.query.id
    overviewVisible.value = true
  }
  pageReady.value = true
  tryInitialLoad()
})
</script>

<template>
  <el-card shadow="never">
    <CustomerModuleNav active="customer" />

    <SavedViewBar
      :module="savedViewModule"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      :system-views="systemViews"
      :system-view="activeSystemView"
      @change="handleSavedViewChange"
      @system-view-change="handleSystemViewChange"
      @clear-filters="clearTemporaryFilters"
      @columns-change="handleSavedColumns"
      @ready="handleSavedViewReady"
    />

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2 items-center">
        <el-input
          v-model="query.keyword"
          placeholder="搜索名称 / 电话 / 邮箱"
          clearable
          class="!w-64"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-button @click="handleSearch">搜索</el-button>
        <AdvancedFilter
          v-model="filters"
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>
      <div class="flex gap-2">
        <template v-if="!isCollaborationView && selectedRows.length > 0">
          <el-button v-if="canExport" @click="openExport('selected')">
            导出选中（{{ selectedRows.length }}）
          </el-button>
          <el-button v-if="auth.hasPerm('customer:transfer')" @click="openBatchTransfer">
            批量转移
          </el-button>
          <el-button
            v-if="auth.hasPerm('customer:recycle')"
            @click="openMoveToPool(selectedRows)"
          >
            批量移入公海
          </el-button>
          <el-button v-if="auth.hasPerm('customer:update')" @click="batchEditVisible = true">
            批量修改（{{ selectedRows.length }}）
          </el-button>
          <el-button
            v-if="auth.hasPerm('customer:delete')"
            type="danger"
            plain
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>
        <el-button
          v-if="!isCollaborationView && auth.hasPerm('customer:merge')"
          :disabled="selectedRows.length < 2"
          @click="openMerge"
        >
          合并客户<span v-if="selectedRows.length">（{{ selectedRows.length }}）</span>
        </el-button>
        <el-button
          v-if="!isCollaborationView && auth.hasPerm('customer:create')"
          type="primary"
          @click="openCreate"
        >
          新建客户
        </el-button>
        <template v-if="canImport">
          <el-button @click="importVisible = true">导入</el-button>
        </template>
        <el-button v-if="canExport" :disabled="items.length === 0" @click="openExport('all')"
          >导出全部</el-button
        >
      </div>
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
          !isCollaborationView &&
          (auth.hasPerm('customer:merge') ||
            auth.hasPerm('customer:transfer') ||
            auth.hasPerm('customer:recycle') ||
            auth.hasPerm('customer:update') ||
            auth.hasPerm('customer:delete') ||
            canExport)
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
          {{
            formatFieldValue(column, row, {
              memberMap: fieldRefs.memberMap.value,
              deptMap: fieldRefs.deptMap.value,
            })
          }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row as CustomerVO)">详情</el-button>
          <el-button link type="primary" @click="openFollow(row as CustomerVO)">跟进</el-button>
          <el-dropdown v-if="!isCollaborationView" trigger="click" class="ml-2">
            <el-button link type="primary">更多</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item
                  v-if="auth.hasPerm('customer:update')"
                  @click="openEdit(row as CustomerVO)"
                >
                  编辑
                </el-dropdown-item>
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
      :title="editingId ? '编辑客户' : '新建客户'"
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

    <CustomerMoveToPoolDialog
      v-model="moveToPoolVisible"
      :customer-ids="moveToPoolIds"
      :customer-name="moveToPoolName"
      @moved="loadData"
    />

    <CrmImportDialog
      v-model="importVisible"
      module-label="客户"
      :download-template="(type) => customerTransferApi.importTemplate(type)"
      :precheck="(file, type) => customerTransferApi.importPrecheck(file, type)"
      :execute="(file, type) => customerTransferApi.importXlsx(file, type)"
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

    <CustomerMergeDialog
      v-model="mergeVisible"
      :selected-rows="selectedRows"
      @merged="handleMerged"
    />

    <BatchFieldEditDialog
      v-model="batchEditVisible"
      title="批量修改客户"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :selected-count="selectedRows.length"
      @confirm="handleBatchEdit"
    />
  </el-card>

  <CustomerOverviewDrawer
    v-model="overviewVisible"
    :customer-id="overviewCustomerId"
    @changed="loadData"
    @deleted="loadData"
  />
</template>
