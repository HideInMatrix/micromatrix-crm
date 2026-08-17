<script setup lang="ts">
import {
  isCustomFieldKey,
  type CustomerVO,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  batchDeleteCustomers,
  batchUpdateCustomers,
  checkDuplicate,
  createCustomer,
  exportCustomersCsv,
  getCustomer,
  importCustomers,
  listCustomers,
  poolBatchDeleteCustomers,
  poolBatchUpdateCustomers,
  removeCustomer,
  updateCustomer,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi, resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import CsvImportDialog from '@/components/CsvImportDialog.vue'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CustomerDetailDrawer from '@/components/CustomerDetailDrawer.vue'
import CustomerMergeDialog from '@/components/CustomerMergeDialog.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import { confirmIfDuplicates } from '@/utils/duplicate'

const auth = useAuthStore()
const router = useRouter()
const fieldRefs = useFieldRefs()

const activeTab = ref<'mine' | 'sea' | 'collaboration'>('mine')
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

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})

const detailVisible = ref(false)
const detailTarget = ref<CustomerVO | null>(null)
const followVisible = ref(false)
const followTarget = ref<CustomerVO | null>(null)
const assignVisible = ref(false)
const assignTarget = ref<CustomerVO | null>(null)
const mergeVisible = ref(false)
const selectedRows = ref<CustomerVO[]>([])
const batchEditVisible = ref(false)

const savedViewModule = computed(() =>
  activeTab.value === 'sea'
    ? 'customer_pool'
    : activeTab.value === 'collaboration'
      ? 'customer_collaboration'
      : 'customer',
)
const currentPool = computed(() => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null)
const defaultColumnKeys = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden).map((field) => field.key),
)
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const fieldMap = new Map(fields.value.filter((field) => !field.hidden).map((field) => [field.key, field]))
  const hiddenIds =
    activeTab.value === 'sea' ? new Set(currentPool.value?.hiddenFieldIds ?? []) : new Set<string>()
  const ordered = keys
    .map((key) => fieldMap.get(key))
    .filter((field): field is FieldVO => !!field && (field.key === 'name' || !hiddenIds.has(field.id)))
  const nameField = fieldMap.get('name')
  if (
    activeTab.value === 'sea' &&
    nameField &&
    !ordered.some((field) => field.key === 'name')
  ) {
    ordered.unshift(nameField)
  }
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
      scope: activeTab.value,
      poolId: activeTab.value === 'sea' ? selectedPoolId.value || undefined : undefined,
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

function handleTabChange() {
  query.page = 1
  activeSavedViewId.value = ''
  selectedRows.value = []
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
  router.push(`/customers/${targetId}`)
}

async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  if (selectedRows.value.length === 0) return
  try {
    const ids = selectedRows.value.map((row) => row.id)
    if (activeTab.value === 'sea') {
      if (!selectedPoolId.value) throw new Error('请先选择客户公海')
      await poolBatchUpdateCustomers({ poolId: selectedPoolId.value, ids, ...payload })
    } else {
      await batchUpdateCustomers({ ids, ...payload })
    }
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
    if (activeTab.value === 'sea') {
      if (!selectedPoolId.value) throw new Error('请先选择客户公海')
      await poolBatchDeleteCustomers(selectedPoolId.value, ids)
    } else {
      await batchDeleteCustomers(ids)
    }
    ElMessage.success('批量删除成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
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

async function handleToSea(row: CustomerVO) {
  const confirmed = await ElMessageBox.confirm(`将「${row.name}」退回公海？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await customerExtraApi.toSea(row.id, selectedPoolId.value || undefined)
    ElMessage.success('已退回公海')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleClaim(row: CustomerVO) {
  try {
    await customerExtraApi.claim(row.id)
    ElMessage.success(`已领取「${row.name}」`)
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleAssignConfirm(userId: string) {
  if (!assignTarget.value) return
  try {
    await customerExtraApi.assign(assignTarget.value.id, userId)
    ElMessage.success('已分配')
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

const importVisible = ref(false)

async function handleImport(rows: Record<string, unknown>[]) {
  try {
    const { data } = await importCustomers(rows)
    if (data.failed > 0) {
      ElMessageBox.alert(
        `成功 ${data.success} 条，失败 ${data.failed} 条：\n${data.errors.join('\n')}`,
        '导入结果',
      )
    } else {
      ElMessage.success(`成功导入 ${data.success} 条`)
    }
    importVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleExport() {
  try {
    const { data } = await exportCustomersCsv({
      keyword: query.keyword.trim() || undefined,
      scope: activeTab.value,
      poolId: activeTab.value === 'sea' ? selectedPoolId.value || undefined : undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
      viewId: activeSavedViewId.value || undefined,
    })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = `客户导出_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
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
  await Promise.all([loadFields(), fieldRefs.load(), loadPoolOptions()])
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="我的客户" name="mine" />
      <el-tab-pane label="客户公海" name="sea" />
      <el-tab-pane label="协作客户" name="collaboration" />
    </el-tabs>

    <SavedViewBar
      :module="savedViewModule"
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
          v-if="activeTab === 'sea'"
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
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>
      <div class="flex gap-2">
        <template v-if="activeTab !== 'collaboration' && selectedRows.length > 0">
          <el-button
            v-if="
              (activeTab === 'mine' && auth.hasPerm('customer:update')) ||
              (activeTab === 'sea' && auth.hasPerm('customerPool:update'))
            "
            @click="batchEditVisible = true"
          >
            批量修改（{{ selectedRows.length }}）
          </el-button>
          <el-button
            v-if="
              (activeTab === 'mine' && auth.hasPerm('customer:delete')) ||
              (activeTab === 'sea' && auth.hasPerm('customerPool:delete'))
            "
            type="danger"
            plain
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>
        <el-button
          v-if="activeTab === 'mine' && auth.hasPerm('customer:merge')"
          :disabled="selectedRows.length < 2"
          @click="openMerge"
        >
          合并客户<span v-if="selectedRows.length">（{{ selectedRows.length }}）</span>
        </el-button>
        <template v-if="auth.hasPerm('customer:import')">
          <el-button @click="handleExport">导出</el-button>
          <el-button @click="importVisible = true">导入</el-button>
        </template>
        <el-button v-if="auth.hasPerm('customer:create')" type="primary" @click="openCreate">
          新建客户
        </el-button>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="items"
      row-key="id"
      stripe
      @selection-change="handleSelectionChange"
    >
      <el-table-column
        v-if="
          (activeTab === 'mine' &&
            (auth.hasPerm('customer:merge') ||
              auth.hasPerm('customer:update') ||
              auth.hasPerm('customer:delete'))) ||
          (activeTab === 'sea' &&
            (auth.hasPerm('customerPool:update') || auth.hasPerm('customerPool:delete')))
        "
        type="selection"
        width="46"
      />
      <el-table-column
        v-for="column in listColumns"
        :key="column.key"
        :label="column.label"
        :width="column.listWidth ?? undefined"
        :min-width="column.listWidth ? undefined : 140"
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
          <template v-if="activeTab === 'sea'">
            <el-button link type="primary" @click="handleClaim(row as CustomerVO)">领取</el-button>
            <el-button
              v-if="auth.hasPerm('customer:assign')"
              link
              @click="assignTarget = row as CustomerVO, assignVisible = true"
            >
              分配
            </el-button>
            <el-button link @click="openPreview(row as CustomerVO)">预览</el-button>
            <el-button link type="primary" @click="openDetail(row as CustomerVO)">详情</el-button>
          </template>
          <template v-else>
            <el-button link type="primary" @click="openDetail(row as CustomerVO)">详情</el-button>
            <el-button link type="primary" @click="openFollow(row as CustomerVO)">跟进</el-button>
            <el-dropdown trigger="click" class="ml-2">
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
                    v-if="auth.hasPerm('customer:assign')"
                    @click="assignTarget = row as CustomerVO, assignVisible = true"
                  >
                    分配负责人
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('customer:assign')"
                    @click="handleToSea(row as CustomerVO)"
                  >
                    退回公海
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

    <CustomerDetailDrawer
      v-model="detailVisible"
      :customer="detailTarget"
      :members="fieldRefs.members.value"
    />

    <FollowUpDrawer
      v-model="followVisible"
      target-type="customer"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="loadData"
    />

    <MemberSelectDialog
      v-model="assignVisible"
      :title="`分配客户「${assignTarget?.name ?? ''}」`"
      :members="fieldRefs.members.value"
      @confirm="handleAssignConfirm"
    />

    <CsvImportDialog
      v-model="importVisible"
      :fields="fields"
      module-label="客户"
      @submit="handleImport"
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
</template>
