<script setup lang="ts">
import {
  CONTRACT_INVOICE_APPROVAL_STATUS_LABELS,
  INVOICE_TYPES,
  type BusinessTitleVO,
  type ContractInvoiceVO,
  type ContractVO,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { contractApi, contractInvoiceApi, businessTitleApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const fields = ref<FieldVO[]>([])
const rows = ref<ContractInvoiceVO[]>([])
const contracts = ref<ContractVO[]>([])
const titles = ref<BusinessTitleVO[]>([])
const total = ref(0)
const loading = ref(false)
const filters = ref<FilterCondition[]>([])
const activeViewId = ref<string>()
const activeSystemView = ref<string>()
const systemViews = ref<Array<{ id: string; label: string }>>([])
const visibleColumnKeys = ref<string[]>([])
const selectedIds = ref<string[]>([])
const query = reactive({ current: 1, pageSize: 10, keyword: '' })

const metaReady = ref(false)
const savedViewReady = ref(false)
const initialLoaded = ref(false)

const formVisible = ref(false)
const formSaving = ref(false)
const formRef = ref<InstanceType<typeof DynamicForm>>()
const editingId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const invoiceName = ref('')
const contractId = ref('')
const ownerId = ref('')
const amount = ref(0)
const invoiceType = ref<string>('增值税普通发票')
const taxRate = ref(0)
const businessTitleId = ref('')

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<ContractInvoiceVO | null>(null)
const detailSnapshot = ref<Record<string, unknown> | null>(null)
const approvalDetail = ref<Record<string, unknown> | null>(null)

const importVisible = ref(false)
const exportVisible = ref(false)
const exportLoading = ref(false)
const exportMode = ref<'all' | 'selected'>('all')

const dynamicFields = computed(() =>
  fields.value.filter((field) => !field.system && !field.hidden && field.type !== 'formula'),
)
const listFields = computed(() => fields.value.filter((field) => field.showInList && !field.hidden))
const defaultColumnKeys = computed(() => listFields.value.map((field) => field.key))
const visibleColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const order = new Map(keys.map((key, index) => [key, index]))
  return listFields.value
    .filter((field) => order.has(field.key))
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
})

function approvalTagType(status: ContractInvoiceVO['approvalStatus']) {
  if (status === 'APPROVED') return 'success'
  if (status === 'APPROVING') return 'warning'
  if (status === 'UNAPPROVED') return 'danger'
  return 'info'
}

function approvalLabel(status: ContractInvoiceVO['approvalStatus']) {
  return status ? CONTRACT_INVOICE_APPROVAL_STATUS_LABELS[status] : '-'
}

function asInvoice(row: unknown) {
  return row as ContractInvoiceVO
}

function dynamicValues(row: ContractInvoiceVO) {
  const byId = new Map(row.moduleFields.map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, byId.get(field.id)]))
}

function displayRow(row: ContractInvoiceVO) {
  return {
    ...row,
    ...dynamicValues(row),
    contractId: row.contractName ?? row.contractId,
    owner: row.ownerName ?? row.owner,
    businessTitleId: row.businessTitleName ?? row.businessTitleId,
  }
}

function defaultDynamicModel() {
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]))
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({ fieldId: field.id, fieldValue: formModel.value[field.key] }))
}

async function loadMeta() {
  try {
    const [{ data: config }, { data: tab }, { data: contractPage }, { data: titleOptions }] = await Promise.all([
      contractInvoiceApi.moduleForm(),
      contractInvoiceApi.tab(),
      contractApi.page({ current: 1, pageSize: 500 }),
      businessTitleApi.options(),
      fieldRefs.load(),
    ])
    fields.value = (config.fields ?? []) as FieldVO[]
    contracts.value = contractPage.list
    titles.value = titleOptions
    visibleColumnKeys.value = defaultColumnKeys.value
    systemViews.value = [
      ...(tab.all ? [{ id: 'ALL', label: '全部' }] : []),
      ...(tab.dept ? [{ id: 'DEPARTMENT', label: '部门' }] : []),
    ]
    activeSystemView.value = systemViews.value[0]?.id
    metaReady.value = true
    maybeInitialLoad()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  if (!metaReady.value || !savedViewReady.value) return
  loading.value = true
  try {
    const { data } = await contractInvoiceApi.page({
      current: query.current,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      viewId: activeViewId.value ?? activeSystemView.value,
      filters: filters.value.length ? filters.value : undefined,
    })
    rows.value = data.list
    total.value = data.total
    selectedIds.value = selectedIds.value.filter((id) => data.list.some((row) => row.id === id))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function maybeInitialLoad() {
  if (!metaReady.value || !savedViewReady.value || initialLoaded.value) return
  initialLoaded.value = true
  void loadData()
}

function onSavedViewChange(viewId?: string) {
  activeViewId.value = viewId
  if (viewId) activeSystemView.value = undefined
  query.current = 1
  if (initialLoaded.value) void loadData()
  else maybeInitialLoad()
}

function onSystemViewChange(viewId?: string) {
  activeSystemView.value = viewId
  if (viewId) activeViewId.value = undefined
  query.current = 1
  if (initialLoaded.value) void loadData()
}

function onSavedViewReady() {
  savedViewReady.value = true
  maybeInitialLoad()
}

function onFilterApply(conditions: FilterCondition[]) {
  filters.value = conditions
  query.current = 1
  void loadData()
}

function resetForm() {
  editingId.value = null
  formModel.value = defaultDynamicModel()
  invoiceName.value = ''
  contractId.value = ''
  ownerId.value = auth.user?.id ?? ''
  amount.value = 0
  invoiceType.value = '增值税普通发票'
  taxRate.value = 0
  businessTitleId.value = ''
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openEdit(row: ContractInvoiceVO) {
  try {
    const { data } = await contractInvoiceApi.detail(row.id)
    editingId.value = data.id
    invoiceName.value = data.name
    contractId.value = data.contractId
    ownerId.value = data.owner
    amount.value = Number(data.amount ?? 0)
    invoiceType.value = data.invoiceType ?? '增值税普通发票'
    taxRate.value = Number(data.taxRate ?? 0)
    businessTitleId.value = data.businessTitleId ?? ''
    const byId = new Map(data.moduleFields.map((item) => [item.fieldId, item.fieldValue]))
    formModel.value = Object.fromEntries(dynamicFields.value.map((field) => [field.key, byId.get(field.id)]))
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function saveInvoice() {
  if (!invoiceName.value.trim() || !contractId.value || !ownerId.value || amount.value <= 0) {
    ElMessage.warning('请填写发票名称、合同、负责人和开票金额')
    return
  }
  if (!(await formRef.value?.validate())) return
  formSaving.value = true
  try {
    const payload = {
      name: invoiceName.value.trim(),
      contractId: contractId.value,
      owner: ownerId.value,
      amount: amount.value,
      invoiceType: invoiceType.value || undefined,
      taxRate: taxRate.value,
      businessTitleId: businessTitleId.value || null,
      moduleFields: moduleFieldsPayload(),
    }
    if (editingId.value) await contractInvoiceApi.update({ id: editingId.value, ...payload })
    else await contractInvoiceApi.create(payload)
    ElMessage.success(editingId.value ? '发票已更新' : '发票已创建')
    formVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    formSaving.value = false
  }
}

async function openDetail(id: string) {
  detailVisible.value = true
  detailLoading.value = true
  try {
    const [{ data: invoice }, { data: snapshot }, approval] = await Promise.all([
      contractInvoiceApi.detail(id),
      contractInvoiceApi.snapshot(id),
      contractInvoiceApi.approvalDetail(id).catch(() => ({ data: null })),
    ])
    detail.value = invoice
    detailSnapshot.value = snapshot
    approvalDetail.value = approval.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

async function review(row: ContractInvoiceVO) {
  try {
    await contractInvoiceApi.approvalPush(row.id)
    ElMessage.success('已提交审批')
    await loadData()
    if (detail.value?.id === row.id) await openDetail(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function revoke(row: ContractInvoiceVO) {
  try {
    await contractInvoiceApi.approvalRevoke(row.id)
    ElMessage.success('审批已撤回')
    await loadData()
    if (detail.value?.id === row.id) await openDetail(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeInvoice(row: ContractInvoiceVO) {
  const confirmed = await ElMessageBox.confirm(`删除发票「${row.name}」？`, '删除确认', { type: 'warning' }).catch(() => false)
  if (!confirmed) return
  try {
    await contractInvoiceApi.remove(row.id)
    ElMessage.success('删除操作已提交')
    if (detail.value?.id === row.id) detailVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function batchDelete() {
  if (!selectedIds.value.length) return
  const confirmed = await ElMessageBox.confirm(`删除选中的 ${selectedIds.value.length} 条发票？`, '批量删除', { type: 'warning' }).catch(() => false)
  if (!confirmed) return
  try {
    await contractInvoiceApi.batchDelete(selectedIds.value)
    selectedIds.value = []
    ElMessage.success('批量删除操作已提交')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openExport(mode: 'all' | 'selected') {
  exportMode.value = mode
  exportVisible.value = true
}

async function submitExport(payload: { fileName: string; headList: string[] }) {
  exportLoading.value = true
  try {
    if (exportMode.value === 'selected') {
      await contractInvoiceApi.exportSelected({ ...payload, ids: selectedIds.value })
      selectedIds.value = []
    } else {
      await contractInvoiceApi.exportAll({
        current: 1,
        pageSize: 500,
        keyword: query.keyword.trim() || undefined,
        viewId: activeViewId.value ?? activeSystemView.value,
        filters: filters.value.length ? filters.value : undefined,
        ...payload,
      })
    }
    exportVisible.value = false
    ElMessage.success('导出任务已创建，可在“导出任务”中下载')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    exportLoading.value = false
  }
}

onMounted(() => {
  void loadMeta()
})
</script>

<template>
  <el-card shadow="never">
    <SavedViewBar
      module="invoice"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      :system-views="systemViews"
      :system-view="activeSystemView"
      @change="onSavedViewChange"
      @system-view-change="onSystemViewChange"
      @clear-filters="filters = []"
      @columns-change="visibleColumnKeys = $event"
      @ready="onSavedViewReady"
    />

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex items-center gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="通过发票名称 / 合同搜索"
          clearable
          class="!w-72"
          @keyup.enter="((query.current = 1), loadData())"
          @clear="((query.current = 1), loadData())"
        />
        <AdvancedFilter
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="onFilterApply"
        />
      </div>
      <div class="flex items-center gap-2">
        <ExportTaskButton />
        <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:IMPORT')" @click="importVisible = true">导入</el-button>
        <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:EXPORT')" :disabled="!rows.length" @click="openExport('all')">导出全部</el-button>
        <template v-if="selectedIds.length">
          <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:EXPORT')" @click="openExport('selected')">导出选中</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:DELETE')" type="danger" plain @click="batchDelete">批量删除</el-button>
        </template>
        <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:ADD')" type="primary" @click="openCreate">新建发票</el-button>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      stripe
      class="w-full"
      @selection-change="(selected: ContractInvoiceVO[]) => (selectedIds = selected.map((row) => row.id))"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column
        v-for="column in visibleColumns"
        :key="column.key"
        :label="column.label"
        :min-width="column.listWidth ?? 140"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-button v-if="column.key === 'name'" link type="primary" @click="openDetail(row.id)">{{ row.name }}</el-button>
          <template v-else-if="column.key === 'amount'">¥{{ Number(row.amount ?? 0).toLocaleString('zh-CN') }}</template>
          <template v-else-if="column.key === 'taxRate'">{{ row.taxRate == null ? '-' : `${row.taxRate}%` }}</template>
          <el-tag v-else-if="column.key === 'approvalStatus'" :type="approvalTagType(asInvoice(row).approvalStatus)" size="small">
            {{ approvalLabel(asInvoice(row).approvalStatus) }}
          </el-tag>
          <template v-else>{{ formatFieldValue(column, displayRow(row as ContractInvoiceVO), { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
        </template>
      </el-table-column>
      <el-table-column v-if="!visibleColumns.some((column) => column.key === 'approvalStatus')" label="审批状态" width="110">
        <template #default="{ row }">
          <el-tag :type="approvalTagType(asInvoice(row).approvalStatus)" size="small">
            {{ approvalLabel(asInvoice(row).approvalStatus) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <el-button link @click="openDetail(row.id)">详情</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:UPDATE') && asInvoice(row).approvalStatus !== 'APPROVING'" link type="primary" @click="openEdit(asInvoice(row))">编辑</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:UPDATE') && ['NONE', 'UNAPPROVED', 'REVOKED'].includes(asInvoice(row).approvalStatus ?? 'NONE')" link type="success" @click="review(asInvoice(row))">提交审批</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:UPDATE') && asInvoice(row).approvalStatus === 'APPROVING'" link @click="revoke(asInvoice(row))">撤回</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:DELETE')" link type="danger" @click="removeInvoice(asInvoice(row))">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.current"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="loadData"
        @size-change="((query.current = 1), loadData())"
      />
    </div>
  </el-card>

  <el-drawer v-model="formVisible" :title="editingId ? '编辑发票' : '新建发票'" size="680px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="发票名称" required><el-input v-model="invoiceName" maxlength="255" show-word-limit /></el-form-item>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="合同" required>
          <el-select v-model="contractId" filterable class="w-full">
            <el-option v-for="item in contracts" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="负责人" required>
          <el-select v-model="ownerId" filterable class="w-full">
            <el-option v-for="member in fieldRefs.members.value" :key="member.id" :label="member.name" :value="member.id" />
          </el-select>
        </el-form-item>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="开票金额" required><el-input-number v-model="amount" :min="0.01" :precision="2" :controls="false" class="!w-full" /></el-form-item>
        <el-form-item label="税率"><el-input-number v-model="taxRate" :min="0" :precision="2" :controls="false" class="!w-full" /></el-form-item>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="发票类型">
          <el-select v-model="invoiceType" class="w-full"><el-option v-for="item in INVOICE_TYPES" :key="item" :label="item" :value="item" /></el-select>
        </el-form-item>
        <el-form-item label="工商抬头">
          <el-select v-model="businessTitleId" clearable filterable class="w-full">
            <el-option v-for="item in titles" :key="item.id" :label="item.name" :value="item.id" />
          </el-select>
        </el-form-item>
      </div>
      <DynamicForm ref="formRef" v-model="formModel" :fields="dynamicFields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" />
    </el-form>
    <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="formSaving" @click="saveInvoice">保存</el-button></template>
  </el-drawer>

  <el-drawer v-model="detailVisible" :title="detail?.name || '发票详情'" size="760px" destroy-on-close>
    <div v-loading="detailLoading">
      <template v-if="detail">
        <div class="flex items-center gap-2 mb-4">
          <el-tag :type="approvalTagType(detail.approvalStatus)">{{ detail.approvalStatus ? CONTRACT_INVOICE_APPROVAL_STATUS_LABELS[detail.approvalStatus] : '-' }}</el-tag>
          <el-tag v-if="detail.approved" type="success">历史已通过</el-tag>
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="发票名称">{{ detail.name }}</el-descriptions-item>
          <el-descriptions-item label="合同">{{ detail.contractName ?? detail.contractId }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{ detail.ownerName ?? detail.owner }}</el-descriptions-item>
          <el-descriptions-item label="工商抬头">{{ detail.businessTitleName ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="开票金额">¥{{ Number(detail.amount ?? 0).toLocaleString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item label="发票类型">{{ detail.invoiceType ?? '-' }}</el-descriptions-item>
          <el-descriptions-item label="税率">{{ detail.taxRate == null ? '-' : `${detail.taxRate}%` }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ new Date(detail.updateTime).toLocaleString('zh-CN') }}</el-descriptions-item>
        </el-descriptions>
        <el-collapse class="mt-4">
          <el-collapse-item title="审批详情" name="approval"><pre class="whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(approvalDetail, null, 2) }}</pre></el-collapse-item>
          <el-collapse-item title="审批冻结快照" name="snapshot"><pre class="whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(detailSnapshot, null, 2) }}</pre></el-collapse-item>
        </el-collapse>
      </template>
    </div>
    <template v-if="detail" #footer>
      <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:UPDATE') && detail.approvalStatus !== 'APPROVING'" @click="openEdit(detail)">编辑</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:UPDATE') && ['NONE', 'UNAPPROVED', 'REVOKED'].includes(detail.approvalStatus ?? 'NONE')" type="primary" @click="review(detail)">提交审批</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:UPDATE') && detail.approvalStatus === 'APPROVING'" @click="revoke(detail)">撤回</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_INVOICE:DELETE')" type="danger" plain @click="removeInvoice(detail)">删除</el-button>
    </template>
  </el-drawer>

  <CrmImportDialog
    v-model="importVisible"
    module-label="发票"
    :download-template="contractInvoiceApi.downloadTemplate"
    :precheck="contractInvoiceApi.precheckImport"
    :execute="contractInvoiceApi.importXlsx"
    @success="loadData"
  />
  <CrmExportDrawer
    v-model="exportVisible"
    module-label="发票"
    cache-key="w364-contract-invoice"
    :fields="fields"
    :display-fields="[
      { key: 'contractName', label: '合同名称' },
      { key: 'businessTitleName', label: '工商抬头' },
      { key: 'approved', label: '历史审批通过' },
      { key: 'createTime', label: '创建时间' },
      { key: 'updateTime', label: '更新时间' },
    ]"
    :mode="exportMode"
    :selected-count="selectedIds.length"
    :loading="exportLoading"
    @confirm="submitExport"
  />
</template>
