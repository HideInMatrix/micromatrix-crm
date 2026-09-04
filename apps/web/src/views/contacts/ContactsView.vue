<script setup lang="ts">
import {
  isCustomFieldKey,
  type ContactVO,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { listCustomerOptions, type CustomerOptionVO } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { contactApi, resourcePoolApi } from '@/api/sales'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import CrmSearchInput from '@/components/CrmSearchInput.vue'
import CrmTableUtilityActions from '@/components/CrmTableUtilityActions.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import CustomerOverviewDrawer from '@/components/customer/CustomerOverviewDrawer.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const fieldRefs = useFieldRefs()
const homeQuickCreate = useHomeQuickCreate()
const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()

const fields = ref<FieldVO[]>([])
const customerOptions = ref<CustomerOptionVO[]>([])
const tabConfig = ref({ all: false, dept: false })
const scopeView = ref<'SELF' | 'DEPT' | 'ALL'>('SELF')
const contactSystemViews = computed(() => [
  { id: 'SELF', label: '我的联系人' },
  ...(tabConfig.value.dept ? [{ id: 'DEPT', label: '部门联系人' }] : []),
  ...(tabConfig.value.all ? [{ id: 'ALL', label: '全部联系人' }] : []),
])
const activeSavedViewId = ref('')
const filters = ref<FilterCondition[]>([])
const visibleColumnKeys = ref<string[]>([])

const loading = ref(false)
const items = ref<ContactVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '' })
const selectedRows = ref<ContactVO[]>([])

const formVisible = ref(false)
const formSaving = ref(false)
const editingId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()

const deactivateVisible = ref(false)
const deactivateSaving = ref(false)
const deactivateTarget = ref<ContactVO | null>(null)
const deactivateReason = ref('')

const batchEditVisible = ref(false)
const importVisible = ref(false)
const exportVisible = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)
const pageReady = ref(false)
const savedViewReady = ref(false)
const initialLoadDone = ref(false)
const linkedCustomerVisible = ref(false)
const linkedCustomerId = ref<string | null>(null)
const linkedCustomerPool = ref(false)
const linkedCustomerPoolId = ref('')
const linkedCustomerHiddenFieldIds = ref<string[]>([])

const uiFields = computed<FieldVO[]>(() => {
  const customerFieldOptions = customerOptions.value.map((item) => ({
    label: item.name,
    value: item.id,
  }))
  return fields.value.map((field) => {
    if (field.key === 'customerId') {
      return { ...field, type: 'select', options: customerFieldOptions }
    }
    return field
  })
})

const formFields = computed(() => uiFields.value.filter((field) => field.key !== 'enable'))
const defaultColumnKeys = computed(() => {
  const configured = uiFields.value
    .filter((field) => field.showInList && !field.hidden)
    .map((field) => field.key)
  return configured.length ? configured : ['name', 'customerId', 'phone', 'ownerId', 'enable']
})
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const map = new Map(
    uiFields.value.filter((field) => !field.hidden).map((field) => [field.key, field]),
  )
  return keys.map((key) => map.get(key)).filter((field): field is FieldVO => !!field)
})

function requestParams() {
  return {
    page: query.page,
    pageSize: query.pageSize,
    keyword: query.keyword.trim() || undefined,
    scopeView: scopeView.value,
    filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
    viewId: activeSavedViewId.value || undefined,
  }
}

async function loadReferenceData() {
  try {
    const [{ data: metadata }, { data: customers }, { data: tabs }] = await Promise.all([
      metadataApi.fields('contact'),
      listCustomerOptions(),
      contactApi.tab(),
    ])
    fields.value = metadata
    customerOptions.value = customers
    tabConfig.value = tabs
    if (!tabs.dept && scopeView.value === 'DEPT') scopeView.value = 'SELF'
    if (!tabs.all && scopeView.value === 'ALL') scopeView.value = 'SELF'
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await contactApi.page(requestParams())
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

function handleScopeChange(value: 'SELF' | 'DEPT' | 'ALL') {
  scopeView.value = value
  query.page = 1
  selectedRows.value = []
  loadData()
}

function handleSystemViewChange(value?: string) {
  if (!value || !['SELF', 'DEPT', 'ALL'].includes(value)) return
  handleScopeChange(value as 'SELF' | 'DEPT' | 'ALL')
}

function handleSavedViewChange(viewId?: string) {
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

function handleSelectionChange(rows: ContactVO[]) {
  selectedRows.value = rows
}

function rowToModel(row: ContactVO) {
  return {
    customerId: row.customerId,
    ownerId: row.ownerId ?? undefined,
    name: row.name,
    phone: row.phone ?? undefined,
    ...row.customData,
  }
}

function modelToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(model)) {
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }
  if (Object.keys(customData).length) payload.customData = customData
  return payload
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  formVisible.value = true
}

function openEdit(row: ContactVO) {
  editingId.value = row.id
  formModel.value = rowToModel(row)
  formVisible.value = true
}

async function saveContact() {
  if (!(await dynamicFormRef.value?.validate())) return
  const isCreate = !editingId.value
  formSaving.value = true
  try {
    const payload = modelToPayload(formModel.value)
    if (editingId.value) await contactApi.update(editingId.value, payload)
    else {
      await contactApi.create(payload as { customerId: string; name: string })
    }
    ElMessage.success(editingId.value ? '联系人已更新' : '联系人已新增')
    formVisible.value = false
    if (isCreate && (await homeQuickCreate.completeCreated())) return
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    formSaving.value = false
  }
}

async function handleToggleStatus(row: ContactVO) {
  if (row.enable) {
    deactivateTarget.value = row
    deactivateReason.value = ''
    deactivateVisible.value = true
    return
  }
  const confirmed = await ElMessageBox.confirm(`确定启用联系人「${row.name}」？`, '启用联系人', {
    confirmButtonText: '启用',
    cancelButtonText: '取消',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await contactApi.enable(row.id)
    ElMessage.success('已启用')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function confirmDeactivate() {
  const target = deactivateTarget.value
  const reason = deactivateReason.value.trim()
  if (!target) return
  if (!reason) {
    ElMessage.warning('请填写停用原因')
    return
  }
  deactivateSaving.value = true
  try {
    await contactApi.disable(target.id, reason)
    ElMessage.success('已停用')
    deactivateVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    deactivateSaving.value = false
  }
}

async function handleDelete(row: ContactVO) {
  try {
    const { data } = await contactApi.checkOpportunity(row.id)
    if (data) {
      await ElMessageBox.confirm(
        `联系人「${row.name}」已关联商机，请先处理商机关联后再删除。`,
        '联系人已关联商机',
        {
          type: 'warning',
          confirmButtonText: '知道了',
          cancelButtonText: '去处理',
          distinguishCancelAndClose: true,
        },
      ).catch((action) => {
        if (action === 'cancel') router.push('/opportunities')
        return false
      })
      return
    }
    const confirmed = await ElMessageBox.confirm(
      `删除联系人「${row.name}」后不可恢复，确定继续？`,
      '删除联系人',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    ).catch(() => false)
    if (!confirmed) return
    await contactApi.remove(row.id)
    ElMessage.success('联系人已删除')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  if (!selectedRows.value.length) return
  try {
    await contactApi.batchUpdate({ ids: selectedRows.value.map((row) => row.id), ...payload })
    ElMessage.success(`已修改 ${selectedRows.value.length} 个联系人`)
    batchEditVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openExport(mode: 'all' | 'selected') {
  if (mode === 'selected' && !selectedRows.value.length) {
    ElMessage.warning('请先选择要导出的联系人')
    return
  }
  exportMode.value = mode
  exportVisible.value = true
}

async function handleExportConfirm(payload: { fileName: string; headList: string[] }) {
  exportLoading.value = true
  try {
    const params = requestParams()
    if (exportMode.value === 'selected') {
      await contactApi.exportSelected(params, {
        ...payload,
        ids: selectedRows.value.map((row) => row.id),
      })
      selectedRows.value = []
    } else {
      await contactApi.exportAll(params, payload)
    }
    exportVisible.value = false
    ElMessage.success('导出任务已创建，可在页面顶部“导出任务”中下载')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    exportLoading.value = false
  }
}

function displayValue(field: FieldVO, row: ContactVO) {
  if (field.key === 'customerId') return row.customerName ?? '-'
  if (field.key === 'ownerId') return row.ownerName ?? '-'
  return formatFieldValue(field, row as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

async function initLinkedCustomerFromRoute() {
  const customerId = typeof route.query.id === 'string' ? route.query.id : ''
  if (!customerId) return
  linkedCustomerId.value = customerId
  linkedCustomerPool.value = route.query.inSharedPool === 'true'
  linkedCustomerPoolId.value = typeof route.query.poolId === 'string' ? route.query.poolId : ''
  linkedCustomerHiddenFieldIds.value = []
  if (linkedCustomerPool.value && linkedCustomerPoolId.value) {
    try {
      const { data } = await resourcePoolApi.options('customer')
      linkedCustomerHiddenFieldIds.value =
        data.find((pool) => pool.id === linkedCustomerPoolId.value)?.hiddenFieldIds ?? []
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }
  linkedCustomerVisible.value = true
}

onMounted(async () => {
  await Promise.all([loadReferenceData(), fieldRefs.load()])
  await homeQuickCreate.consume(openCreate)
  await initLinkedCustomerFromRoute()
  pageReady.value = true
  tryInitialLoad()
})
</script>

<template>
  <el-card shadow="never">
    <div
      class="mb-4 flex flex-wrap items-center justify-between gap-3"
      data-testid="crm-table-primary-toolbar"
    >
      <div class="flex flex-wrap items-center gap-2">
        <el-button v-if="auth.hasPerm('contact:create')" type="primary" @click="openCreate">
          新增联系人
        </el-button>
        <el-button v-if="auth.hasPerm('contact:import')" @click="importVisible = true"
          >导入</el-button
        >
        <el-button
          v-if="auth.hasPerm('contact:export')"
          :disabled="items.length === 0"
          @click="openExport('all')"
        >
          导出全部
        </el-button>
        <template v-if="selectedRows.length">
          <el-divider direction="vertical" />
          <el-button v-if="auth.hasPerm('contact:export')" @click="openExport('selected')">
            导出选中（{{ selectedRows.length }}）
          </el-button>
          <el-button v-if="auth.hasPerm('contact:update')" @click="batchEditVisible = true">
            批量编辑
          </el-button>
        </template>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <CrmSearchInput
          v-model="query.keyword"
          placeholder="搜索联系人姓名、电话"
          @search="handleSearch"
        />
        <AdvancedFilter
          v-model="filters"
          :fields="uiFields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="handleSearch"
        />
        <CrmTableUtilityActions
          :refreshing="loading"
          @columns="savedViewBarRef?.openColumnSettings()"
          @refresh="loadData"
        />
      </div>
    </div>

    <SavedViewBar
      ref="savedViewBarRef"
      module="contact"
      :fields="uiFields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      :system-views="contactSystemViews"
      :system-view="scopeView"
      @change="handleSavedViewChange"
      @system-view-change="handleSystemViewChange"
      @clear-filters="clearTemporaryFilters"
      @columns-change="handleSavedColumns"
      @ready="handleSavedViewReady"
    />

    <el-table
      v-loading="loading"
      :data="items"
      border
      row-key="id"
      class="mt-3 w-full"
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="46" />
      <template v-for="field in listColumns" :key="field.key">
        <el-table-column
          :prop="field.key"
          :label="field.label"
          :min-width="field.listWidth ?? 120"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <el-switch
              v-if="field.key === 'enable'"
              :model-value="row.enable"
              :disabled="!auth.hasPerm('contact:update')"
              @click.stop="handleToggleStatus(row as ContactVO)"
            />
            <span v-else>{{ displayValue(field, row as ContactVO) }}</span>
          </template>
        </el-table-column>
      </template>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="auth.hasPerm('contact:update')"
            link
            type="primary"
            @click="openEdit(row as ContactVO)"
          >
            编辑
          </el-button>
          <el-button
            v-if="auth.hasPerm('contact:delete')"
            link
            type="danger"
            @click="handleDelete(row as ContactVO)"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @change="loadData"
      />
    </div>
  </el-card>

  <el-drawer
    v-model="formVisible"
    :title="editingId ? '编辑联系人' : '新增联系人'"
    size="560px"
    destroy-on-close
    :close-on-click-modal="false"
  >
    <DynamicForm
      ref="dynamicFormRef"
      v-model="formModel"
      :fields="formFields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
    />
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="formSaving" @click="saveContact">保存</el-button>
    </template>
  </el-drawer>

  <el-dialog
    v-model="deactivateVisible"
    width="480px"
    :title="`停用原因${deactivateTarget ? `（${deactivateTarget.name}）` : ''}`"
    :close-on-click-modal="false"
  >
    <el-form label-position="top">
      <el-form-item label="停用原因" required>
        <el-input
          v-model="deactivateReason"
          type="textarea"
          :rows="4"
          maxlength="200"
          show-word-limit
          placeholder="请输入停用原因"
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="deactivateVisible = false">取消</el-button>
      <el-button type="primary" :loading="deactivateSaving" @click="confirmDeactivate"
        >停用</el-button
      >
    </template>
  </el-dialog>

  <BatchFieldEditDialog
    v-model="batchEditVisible"
    title="批量编辑联系人"
    :fields="uiFields"
    :members="fieldRefs.members.value"
    :dept-tree="fieldRefs.deptTree.value"
    :selected-count="selectedRows.length"
    @confirm="handleBatchEdit"
  />

  <CrmImportDialog
    v-model="importVisible"
    module-label="联系人"
    :download-template="contactApi.importTemplate"
    :precheck="contactApi.importPrecheck"
    :execute="contactApi.importXlsx"
    @success="loadData"
  />

  <CrmExportDrawer
    v-model="exportVisible"
    module-label="联系人"
    cache-key="contact"
    :fields="uiFields"
    :display-fields="[
      { key: 'disableReason', label: '停用原因' },
      { key: 'createdAt', label: '创建时间' },
      { key: 'updatedAt', label: '更新时间' },
    ]"
    :mode="exportMode"
    :selected-count="selectedRows.length"
    :loading="exportLoading"
    @confirm="handleExportConfirm"
  />

  <CustomerOverviewDrawer
    v-model="linkedCustomerVisible"
    :customer-id="linkedCustomerId"
    :pool="linkedCustomerPool"
    :pool-id="linkedCustomerPoolId || undefined"
    :hidden-field-ids="linkedCustomerHiddenFieldIds"
    @changed="loadData"
    @deleted="loadData"
  />
</template>
