<script setup lang="ts">
import { type CustomerVO, type FieldVO, type FilterCondition } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  customerTransferApi,
  listCustomers,
  poolBatchDeleteCustomers,
  poolBatchUpdateCustomers,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi, resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import CustomerDetailDrawer from '@/components/CustomerDetailDrawer.vue'
import CustomerModuleNav from '@/components/CustomerModuleNav.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const fieldRefs = useFieldRefs()

const pools = ref<ResourcePoolVO[]>([])
const selectedPoolId = ref('')
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<CustomerVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '' })
const filters = ref<FilterCondition[]>([])
const activeSavedViewId = ref('')
const visibleColumnKeys = ref<string[]>([])
const selectedRows = ref<CustomerVO[]>([])
const batchEditVisible = ref(false)
const importVisible = ref(false)
const exportVisible = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)
const detailVisible = ref(false)
const detailTarget = ref<CustomerVO | null>(null)
const assignVisible = ref(false)
const assignTarget = ref<CustomerVO | null>(null)

const currentPool = computed(() => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null)
const canImport = computed(() => auth.hasPerm('customerPool:import'))
const canExport = computed(() => auth.hasPerm('customerPool:export'))
const defaultColumnKeys = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden).map((field) => field.key),
)
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const fieldMap = new Map(fields.value.filter((field) => !field.hidden).map((field) => [field.key, field]))
  const hiddenIds = new Set(currentPool.value?.hiddenFieldIds ?? [])
  const ordered = keys
    .map((key) => fieldMap.get(key))
    .filter((field): field is FieldVO => !!field && (field.key === 'name' || !hiddenIds.has(field.id)))
  const nameField = fieldMap.get('name')
  if (nameField && !ordered.some((field) => field.key === 'name')) ordered.unshift(nameField)
  return ordered
})

async function loadFields() {
  const { data } = await metadataApi.fields('customer')
  fields.value = data
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
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      scope: 'sea',
      poolId: selectedPoolId.value || undefined,
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

function handleSearch() {
  query.page = 1
  loadData()
}

function handleSavedViewChange(viewId?: string) {
  activeSavedViewId.value = viewId ?? ''
  query.page = 1
  loadData()
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

async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  if (!selectedPoolId.value || selectedRows.value.length === 0) return
  try {
    await poolBatchUpdateCustomers({
      poolId: selectedPoolId.value,
      ids: selectedRows.value.map((row) => row.id),
      ...payload,
    })
    ElMessage.success(`已修改 ${selectedRows.value.length} 个公海客户`)
    batchEditVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchDelete() {
  if (!selectedPoolId.value || selectedRows.value.length === 0) return
  const confirmed = await ElMessageBox.confirm(
    `确定删除已选择的 ${selectedRows.value.length} 个公海客户？存在联系人、商机或交易数据时会拒绝删除。`,
    '批量删除客户',
    { type: 'warning', confirmButtonText: '删除' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await poolBatchDeleteCustomers(selectedPoolId.value, selectedRows.value.map((row) => row.id))
    ElMessage.success('批量删除成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleClaim(row: CustomerVO) {
  try {
    await customerExtraApi.claim(row.id, row.poolId ?? selectedPoolId.value)
    ElMessage.success(`已领取「${row.name}」`)
    loadData()
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

function openPreview(row: CustomerVO) {
  detailTarget.value = row
  detailVisible.value = true
}

function openDetail(row: CustomerVO) {
  router.push(`/customers/${row.id}`)
}

function transferParams() {
  return {
    page: query.page,
    pageSize: query.pageSize,
    keyword: query.keyword.trim() || undefined,
    scope: 'sea' as const,
    poolId: selectedPoolId.value || undefined,
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
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <CustomerModuleNav active="sea" />

    <SavedViewBar
      module="customer_pool"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      @change="handleSavedViewChange"
      @clear-filters="clearTemporaryFilters"
      @columns-change="handleSavedColumns"
    />

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2 items-center">
        <el-select
          v-model="selectedPoolId"
          class="!w-44"
          placeholder="选择客户公海"
          @change="handleSearch"
        >
          <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
        </el-select>
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
          @apply="(conditions) => ((filters = conditions), handleSearch())"
        />
      </div>
      <div class="flex gap-2">
        <template v-if="selectedRows.length > 0">
          <el-button v-if="canExport" @click="openExport('selected')">
            导出选中（{{ selectedRows.length }}）
          </el-button>
          <el-button v-if="auth.hasPerm('customerPool:update')" @click="batchEditVisible = true">
            批量修改（{{ selectedRows.length }}）
          </el-button>
          <el-button
            v-if="auth.hasPerm('customerPool:delete')"
            type="danger"
            plain
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>
        <el-button v-if="canImport" :disabled="!selectedPoolId" @click="importVisible = true">导入</el-button>
        <el-button v-if="canExport" :disabled="items.length === 0 || !selectedPoolId" @click="openExport('all')">
          导出全部
        </el-button>
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
        v-if="auth.hasPerm('customerPool:update') || auth.hasPerm('customerPool:delete') || canExport"
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
          <el-button v-if="auth.hasPerm('customerPool:pick')" link type="primary" @click="handleClaim(row as CustomerVO)">领取</el-button>
          <el-button
            v-if="auth.hasPerm('customerPool:assign')"
            link
            @click="assignTarget = row as CustomerVO, assignVisible = true"
          >
            分配
          </el-button>
          <el-button link @click="openPreview(row as CustomerVO)">预览</el-button>
          <el-button link type="primary" @click="openDetail(row as CustomerVO)">详情</el-button>
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

    <CustomerDetailDrawer
      v-model="detailVisible"
      :customer="detailTarget"
      :members="fieldRefs.members.value"
      pool
    />

    <MemberSelectDialog
      v-model="assignVisible"
      :title="`分配客户「${assignTarget?.name ?? ''}」`"
      :members="fieldRefs.members.value"
      @confirm="handleAssignConfirm"
    />

    <CrmImportDialog
      v-model="importVisible"
      module-label="客户公海"
      :download-template="(type) => customerTransferApi.importTemplate(type, selectedPoolId || undefined)"
      :precheck="(file, type) => customerTransferApi.importPrecheck(file, type, selectedPoolId || undefined)"
      :execute="(file, type) => customerTransferApi.importXlsx(file, type, selectedPoolId || undefined)"
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

    <BatchFieldEditDialog
      v-model="batchEditVisible"
      title="批量修改客户公海"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :selected-count="selectedRows.length"
      @confirm="handleBatchEdit"
    />
  </el-card>
</template>
