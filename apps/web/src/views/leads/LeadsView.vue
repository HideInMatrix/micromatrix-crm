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
import { leadApi, type ResourcePoolVO } from '@/api/sales'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import OwnerHistoryTimeline from '@/components/OwnerHistoryTimeline.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import LeadTransformDialog from '@/components/leads/LeadTransformDialog.vue'
import LeadTransitionCustomerDrawer from '@/components/leads/LeadTransitionCustomerDrawer.vue'
import { consumeHomeFilter } from '@/utils/home-filter'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const homeQuickCreate = useHomeQuickCreate()
const route = useRoute()
const router = useRouter()

const activeTab = ref<'mine' | 'pool'>(route.path.endsWith('/pool') ? 'pool' : 'mine')
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
const exportVisible = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const toPool = ref(false)

const followVisible = ref(false)
const followTarget = ref<LeadVO | null>(null)
const ownerHistoryVisible = ref(false)
const ownerHistoryTarget = ref<LeadVO | null>(null)

const convertVisible = ref(false)
const convertTarget = ref<LeadVO | null>(null)
const transitionCustomerVisible = ref(false)
const transitionClueIds = ref<string[]>([])

const savedViewModule = computed(() => (activeTab.value === 'pool' ? 'lead_pool' : 'lead'))
const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const canImport = computed(() =>
  activeTab.value === 'pool' ? auth.hasPerm('leadPool:import') : auth.hasPerm('lead:import'),
)
const canExport = computed(() =>
  activeTab.value === 'pool' ? auth.hasPerm('leadPool:export') : auth.hasPerm('lead:export'),
)
const defaultColumnKeys = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden).map((field) => field.key),
)
const listColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const fieldMap = new Map(
    fields.value.filter((field) => !field.hidden).map((field) => [field.key, field]),
  )
  const hiddenIds =
    activeTab.value === 'pool'
      ? new Set(currentPool.value?.hiddenFieldIds ?? [])
      : new Set<string>()
  const ordered = keys
    .map((key) => fieldMap.get(key))
    .filter(
      (field): field is FieldVO => !!field && (field.key === 'name' || !hiddenIds.has(field.id)),
    )
  const nameField = fieldMap.get('name')
  if (activeTab.value === 'pool' && nameField && !ordered.some((field) => field.key === 'name')) {
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

async function loadData() {
  loading.value = true
  try {
    const { data } = await leadApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      scope: activeTab.value,
      poolId: activeTab.value === 'pool' ? selectedPoolId.value || undefined : undefined,
      status: query.status || undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
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

function handleSearch() {
  query.page = 1
  loadData()
}

function handleTabChange() {
  query.page = 1
  activeHomeFilter.value = null
  activeSavedViewId.value = ''
  selectedRows.value = []
  void router.replace(activeTab.value === 'pool' ? '/leads/pool' : '/leads')
  loadData()
}

watch(
  () => route.path,
  (path) => {
    const nextTab = path.endsWith('/pool') ? 'pool' : 'mine'
    if (nextTab === activeTab.value) return
    activeTab.value = nextTab
    query.page = 1
    activeSavedViewId.value = ''
    selectedRows.value = []
    loadData()
  },
)

function handleSelectionChange(rows: LeadVO[]) {
  selectedRows.value = rows
}

async function handleBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  if (selectedRows.value.length === 0) return
  try {
    const ids = selectedRows.value.map((row) => row.id)
    if (activeTab.value === 'pool') {
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
    if (activeTab.value === 'pool') {
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

function openCreate() {
  editingId.value = null
  toPool.value = activeTab.value === 'pool'
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

const assignVisible = ref(false)
const assignTarget = ref<LeadVO | null>(null)
const importVisible = ref(false)

function transferParams() {
  return {
    keyword: query.keyword.trim() || undefined,
    scope: activeTab.value,
    poolId: activeTab.value === 'pool' ? selectedPoolId.value || undefined : undefined,
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
    const poolId = activeTab.value === 'pool' ? selectedPoolId.value || undefined : undefined
    if (activeTab.value === 'pool' && !poolId) throw new Error('请先选择线索池')
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
    if (activeTab.value === 'pool') await leadApi.poolAssign(assignTarget.value.id, userId)
    else await leadApi.transfer(assignTarget.value.id, userId)
    ElMessage.success('已分配')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleFailed(row: LeadVO) {
  const confirmed = await ElMessageBox.confirm(`将「${row.name}」标记为失败？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  await leadApi.markFailed(row.id)
  ElMessage.success('已标记失败')
  loadData()
}

function openFollow(row: LeadVO) {
  followTarget.value = row
  followVisible.value = true
}

function openOwnerHistory(row: LeadVO) {
  ownerHistoryTarget.value = row
  ownerHistoryVisible.value = true
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
  activeTab.value = 'mine'
  activeHomeFilter.value = payload
  query.page = 1
}

onMounted(async () => {
  await consumeRouteHomeFilter()
  await Promise.all([loadFields(), fieldRefs.load(), loadPoolOptions()])
  await homeQuickCreate.consume(openCreate)
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="我的线索" name="mine" />
      <el-tab-pane label="线索池" name="pool" />
    </el-tabs>

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
          v-if="activeTab === 'pool'"
          v-model="selectedPoolId"
          class="!w-44"
          placeholder="选择线索池"
          @change="handleSearch"
        >
          <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
        </el-select>
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
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>
      <div class="flex gap-2">
        <template v-if="selectedRows.length > 0">
          <el-button
            v-if="activeTab === 'mine' && auth.hasPerm('lead:update')"
            @click="openTransitionCustomer(selectedRows.map((row) => row.id))"
          >
            关联客户
          </el-button>
          <el-button v-if="canExport" @click="openExport('selected')">
            导出选中（{{ selectedRows.length }}）
          </el-button>
          <el-button
            v-if="
              (activeTab === 'mine' && auth.hasPerm('lead:update')) ||
              (activeTab === 'pool' && auth.hasPerm('leadPool:update'))
            "
            @click="batchEditVisible = true"
          >
            批量修改（{{ selectedRows.length }}）
          </el-button>
          <el-button
            v-if="
              (activeTab === 'mine' && auth.hasPerm('lead:delete')) ||
              (activeTab === 'pool' && auth.hasPerm('leadPool:delete'))
            "
            type="danger"
            plain
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>
        <el-button
          v-if="auth.hasPerm('lead:create') && activeTab === 'mine'"
          type="primary"
          @click="openCreate"
        >
          新建线索
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
          (activeTab === 'mine' && (auth.hasPerm('lead:update') || auth.hasPerm('lead:delete'))) ||
          (activeTab === 'pool' &&
            (auth.hasPerm('leadPool:update') || auth.hasPerm('leadPool:delete'))) ||
          canExport
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
          <template v-if="activeTab === 'pool'">
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
            <el-button link @click="openOwnerHistory(row as LeadVO)">负责人历史</el-button>
          </template>
          <template v-else>
            <el-button link type="primary" @click="openFollow(row as LeadVO)">跟进</el-button>
            <el-dropdown trigger="click" class="ml-2">
              <el-button link type="primary">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-if="
                      !['CUSTOMER', 'OPPORTUNITY'].includes(row.transitionType ?? '') &&
                      auth.hasPerm('lead:update')
                    "
                    @click="openConvert(row as LeadVO)"
                  >
                    转化为客户
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:update')"
                    @click="openTransitionCustomer([(row as LeadVO).id])"
                  >
                    关联客户
                  </el-dropdown-item>
                  <el-dropdown-item v-if="auth.hasPerm('lead:update')" @click="openEdit(row as LeadVO)">
                    编辑
                  </el-dropdown-item>
                  <el-dropdown-item @click="openOwnerHistory(row as LeadVO)">
                    负责人历史
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:transfer')"
                    @click="handleAssign(row as LeadVO)"
                  >
                    转移
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="
                      !['CUSTOMER', 'OPPORTUNITY'].includes(row.transitionType ?? '') &&
                      auth.hasPerm('lead:recycle')
                    "
                    @click="handleToPool(row as LeadVO)"
                  >
                    移入线索池
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="
                      !['CUSTOMER', 'OPPORTUNITY'].includes(row.transitionType ?? '') &&
                      row.status !== 'FAIL' &&
                      auth.hasPerm('lead:update')
                    "
                    @click="handleFailed(row as LeadVO)"
                  >
                    标记失败
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
      :title="editingId ? '编辑线索' : '新建线索'"
      width="640px"
      destroy-on-close
    >
      <el-alert
        v-if="!editingId && activeTab === 'pool'"
        title="将创建到线索池（无负责人）"
        type="info"
        :closable="false"
        class="mb-3"
      />
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

    <CrmImportDialog
      v-model="importVisible"
      :module-label="activeTab === 'pool' ? '线索池' : '线索'"
      :download-template="
        (type) =>
          leadApi.importTemplate(
            type,
            activeTab === 'pool' ? selectedPoolId || undefined : undefined,
          )
      "
      :precheck="
        (file, type) =>
          leadApi.importPrecheck(
            file,
            type,
            activeTab === 'pool' ? selectedPoolId || undefined : undefined,
          )
      "
      :execute="
        (file, type) =>
          leadApi.importXlsx(
            file,
            type,
            activeTab === 'pool' ? selectedPoolId || undefined : undefined,
          )
      "
      @success="loadData"
    />

    <CrmExportDrawer
      v-model="exportVisible"
      :module-label="activeTab === 'pool' ? '线索池' : '线索'"
      :cache-key="activeTab === 'pool' ? `lead-pool:${selectedPoolId}` : 'lead'"
      :fields="fields"
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
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :selected-count="selectedRows.length"
      @confirm="handleBatchEdit"
    />

    <el-drawer
      v-model="ownerHistoryVisible"
      :title="`负责人历史 - ${ownerHistoryTarget?.name ?? ''}`"
      size="560px"
      destroy-on-close
    >
      <OwnerHistoryTimeline
        v-if="ownerHistoryTarget"
        module="lead"
        :resource-id="ownerHistoryTarget.id"
      />
    </el-drawer>
  </el-card>
</template>
