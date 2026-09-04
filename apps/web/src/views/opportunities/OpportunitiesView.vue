<script setup lang="ts">
import {
  type HomeFilterPayload,
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type OpportunityStageVO,
  type OpportunityVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import draggable from 'vuedraggable'
import { productApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { listCustomers } from '@/api/customers'
import { contactApi, opportunityApi } from '@/api/sales'
import { dictionaryApi, type DictionaryItemVO } from '@/api/system'
import CrmDisplayModeSwitch from '@/components/CrmDisplayModeSwitch.vue'
import CrmSearchInput from '@/components/CrmSearchInput.vue'
import CrmTableUtilityActions from '@/components/CrmTableUtilityActions.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import OpportunityDetailDrawer from '@/components/opportunities/OpportunityDetailDrawer.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import SavedViewBar from '@/components/SavedViewBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'
import { consumeHomeFilter } from '@/utils/home-filter'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const fieldRefs = useFieldRefs()
const homeQuickCreate = useHomeQuickCreate()
const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()

const viewMode = ref<'list' | 'kanban'>('list')
const fields = ref<FieldVO[]>([])
const stages = ref<OpportunityStageVO[]>([])
const activeViewId = ref<string>()
const selectedIds = ref<string[]>([])
const visibleColumnKeys = ref<string[]>([])

// 列表态
const loading = ref(false)
const items = ref<OpportunityVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', stageId: '' })
const filters = ref<FilterCondition[]>([])
const activeHomeFilter = ref<HomeFilterPayload | null>(null)

// 看板态
const kanbanItems = ref<Record<string, OpportunityVO[]>>({})
const kanbanStages = ref<OpportunityStageVO[]>([])

// 表单
const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const customerOptions = ref<{ id: string; name: string }[]>([])
const contactOptions = ref<{ id: string; name: string }[]>([])
const productOptions = ref<{ id: string; name: string }[]>([])
const businessForm = reactive({
  name: '',
  customerId: '',
  contactId: '',
  amount: null as number | null,
  possible: null as number | null,
  products: [] as string[],
  owner: '',
  expectedEndTime: null as string | number | null,
})

// 跟进 / 阶段
const followVisible = ref(false)
const followTarget = ref<OpportunityVO | null>(null)
const stageVisible = ref(false)
const stageTarget = ref<OpportunityVO | null>(null)
const stageForm = reactive({ stageId: '', failureReason: '' })
const failureReasonEnabled = ref(false)
const failureReasons = ref<DictionaryItemVO[]>([])
const transferVisible = ref(false)
const transferOwner = ref('')
const detailVisible = ref(false)
const detailOpportunityId = ref<string | null>(null)

const defaultColumnKeys = computed(() =>
  fields.value.filter((f) => f.showInList && !f.hidden).map((f) => f.key),
)
const listColumns = computed(() => {
  const allowed = visibleColumnKeys.value.length ? new Set(visibleColumnKeys.value) : null
  return fields.value.filter((f) => f.showInList && !f.hidden && (!allowed || allowed.has(f.key)))
})
const customFormFields = computed(() => fields.value.filter((field) => !field.system))
const selectedStage = computed(() => stages.value.find((s) => s.id === stageForm.stageId))

async function loadMeta() {
  const [{ data: fieldData }, { data: stageData }, { data: reasonConfig }, { data: products }] =
    await Promise.all([
      metadataApi.fields('opportunity'),
      opportunityApi.stages(),
      dictionaryApi.config('OPPORTUNITY_FAIL_RS'),
      productApi.options(),
    ])
  fields.value = fieldData
  stages.value = stageData
  failureReasonEnabled.value = reasonConfig.enable
  failureReasons.value = reasonConfig.dictList.filter((item) => item.id !== 'system')
  productOptions.value = products
}

async function loadData() {
  loading.value = true
  try {
    if (viewMode.value === 'kanban') {
      const { data } = await opportunityApi.kanban({
        keyword: query.keyword.trim() || undefined,
        viewId: activeViewId.value,
        filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
        homeFilter: activeHomeFilter.value ? JSON.stringify(activeHomeFilter.value) : undefined,
      })
      kanbanStages.value = data.stages
      kanbanItems.value = data.items
    } else {
      const { data } = await opportunityApi.list({
        page: query.page,
        pageSize: query.pageSize,
        keyword: query.keyword.trim() || undefined,
        stageId: query.stageId || undefined,
        viewId: activeViewId.value,
        filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
        homeFilter: activeHomeFilter.value ? JSON.stringify(activeHomeFilter.value) : undefined,
      })
      items.value = data.items
      total.value = data.total
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function searchCustomers(keyword: string) {
  const { data } = await listCustomers({ page: 1, pageSize: 20, keyword: keyword || undefined })
  customerOptions.value = data.items.map((c) => ({ id: c.id, name: c.name }))
}

async function loadContacts(customerId?: string) {
  contactOptions.value = []
  if (!customerId) return
  try {
    const { data } = await contactApi.list(customerId)
    contactOptions.value = data.map((contact) => ({ id: contact.id, name: contact.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function resetBusinessForm() {
  Object.assign(businessForm, {
    name: '',
    customerId: '',
    contactId: '',
    amount: null,
    possible: null,
    products: [],
    owner: auth.user?.id ?? '',
    expectedEndTime: null,
  })
  formModel.value = {}
}

function openCreate() {
  editingId.value = null
  resetBusinessForm()
  searchCustomers('')
  dialogVisible.value = true
}

async function openEdit(row: OpportunityVO) {
  editingId.value = row.id
  resetBusinessForm()
  if (row.customerId) customerOptions.value = [{ id: row.customerId, name: row.customerName ?? '' }]
  try {
    const { data } = await opportunityApi.get(row.id)
    Object.assign(businessForm, {
      name: data.name,
      customerId: data.customerId ?? '',
      contactId: data.contactId ?? '',
      amount: data.amount,
      possible: data.possible ?? null,
      products: data.products ?? [],
      owner: data.owner ?? data.ownerId ?? '',
      expectedEndTime: data.expectedEndTime ?? null,
    })
    await loadContacts(data.customerId || undefined)
    formModel.value = Object.fromEntries(
      customFormFields.value
        .filter((f) => f.type !== 'formula')
        .map((f) => [f.key, isCustomFieldKey(f.key) ? data.customData[f.key] : undefined]),
    )
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    return
  }
  dialogVisible.value = true
}

async function handleSave() {
  if (!businessForm.name.trim()) return ElMessage.warning('请输入商机名称')
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  const isCreate = !editingId.value
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      customData: {},
      name: businessForm.name.trim(),
      customerId: businessForm.customerId || undefined,
      contactId: businessForm.contactId || undefined,
      amount: businessForm.amount,
      possible: businessForm.possible,
      products: businessForm.products,
      owner: businessForm.owner || undefined,
      expectedEndTime: businessForm.expectedEndTime
        ? Number(businessForm.expectedEndTime)
        : undefined,
    }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await opportunityApi.update(editingId.value, payload)
      ElMessage.success('商机已更新')
    } else {
      await opportunityApi.create(payload)
      ElMessage.success('商机已创建')
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

async function handleDelete(row: OpportunityVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除商机「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await opportunityApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openStageChange(row: OpportunityVO) {
  stageTarget.value = row
  stageForm.stageId = row.stageId
  stageForm.failureReason = ''
  stageVisible.value = true
}

async function handleStageChange() {
  if (!stageTarget.value) return
  if (selectedStage.value?.isLost && failureReasonEnabled.value && !stageForm.failureReason) {
    ElMessage.warning('请选择失败原因')
    return
  }
  try {
    await opportunityApi.changeStage(
      stageTarget.value.id,
      stageForm.stageId,
      stageForm.failureReason || undefined,
    )
    ElMessage.success('阶段已更新')
    stageVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openFollow(row: OpportunityVO) {
  followTarget.value = row
  followVisible.value = true
}

function formatAmount(amount: number | null) {
  return amount === null ? '-' : `¥${amount.toLocaleString('zh-CN')}`
}

function toQuote(row: OpportunityVO) {
  router.push({ path: '/quotes', query: { fromOpportunity: row.id } })
}

function openDetail(id: string) {
  detailOpportunityId.value = id
  detailVisible.value = true
}

function handleSelectionChange(rows: OpportunityVO[]) {
  selectedIds.value = rows.map((row) => row.id)
}

function openBatchTransfer() {
  if (!selectedIds.value.length) return
  transferOwner.value = ''
  transferVisible.value = true
}

async function handleBatchTransfer() {
  if (!transferOwner.value) return ElMessage.warning('请选择负责人')
  try {
    await opportunityApi.batchTransfer(selectedIds.value, transferOwner.value)
    ElMessage.success('商机已批量转移')
    transferVisible.value = false
    selectedIds.value = []
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBatchDelete() {
  if (!selectedIds.value.length) return
  const ok = await ElMessageBox.confirm(
    `确定删除选中的 ${selectedIds.value.length} 个商机吗？`,
    '批量删除',
    { type: 'warning' },
  ).catch(() => false)
  if (!ok) return
  try {
    await opportunityApi.batchDelete(selectedIds.value)
    ElMessage.success('商机已批量删除')
    selectedIds.value = []
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleBoardChange(stageId: string, event: { added?: { element: OpportunityVO } }) {
  const opportunity = event.added?.element
  if (!opportunity || opportunity.stageId === stageId) return
  const target = stages.value.find((stage) => stage.id === stageId)
  if (target?.isLost && failureReasonEnabled.value) {
    await loadData()
    stageTarget.value = opportunity
    stageForm.stageId = stageId
    stageForm.failureReason = ''
    stageVisible.value = true
    return
  }
  try {
    await opportunityApi.changeStage(opportunity.id, stageId)
    ElMessage.success('商机阶段已更新')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadData()
  }
}

function onSavedViewChange(viewId?: string) {
  activeViewId.value = viewId
  query.page = 1
  void loadData()
}

function onColumnsChange(keys: string[]) {
  visibleColumnKeys.value = keys
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
  const statusLabel =
    activeHomeFilter.value.status === 'SUCCESS'
      ? ' · 赢单'
      : activeHomeFilter.value.status === 'AFOOT'
        ? ' · 进行中'
        : ''
  return `来自首页：${periodLabel} · ${scopeLabel}${statusLabel}`
})

function clearHomeFilter() {
  activeHomeFilter.value = null
  query.page = 1
  loadData()
}

async function consumeRouteHomeFilter() {
  const token = route.query.homeFilter
  if (!token) return
  const payload = consumeHomeFilter(token, 'opportunity')
  const nextQuery = { ...route.query }
  delete nextQuery.homeFilter
  await router.replace({ path: route.path, query: nextQuery })
  if (!payload) {
    ElMessage.warning('首页筛选已失效或格式不正确')
    return
  }
  activeHomeFilter.value = payload
  viewMode.value = 'list'
  query.page = 1
}

watch(
  () => route.query.id,
  (value) => {
    const id = typeof value === 'string' ? value : ''
    if (id) openDetail(id)
  },
  { immediate: true },
)

onMounted(async () => {
  await consumeRouteHomeFilter()
  await Promise.all([loadMeta(), fieldRefs.load()])
  await homeQuickCreate.consume(openCreate)
  await loadData()
})
</script>

<template>
  <el-card shadow="never">
    <el-alert
      v-if="activeHomeFilter"
      :title="homeFilterSummary"
      type="info"
      show-icon
      class="mb-4"
      @close="clearHomeFilter"
    />

    <div
      class="mb-4 flex flex-wrap items-center justify-between gap-3"
      data-testid="crm-table-primary-toolbar"
    >
      <div class="flex flex-wrap items-center gap-2">
        <template v-if="viewMode === 'list' && selectedIds.length">
          <el-button v-if="auth.hasPerm('opportunity:update')" @click="openBatchTransfer">
            批量转移
          </el-button>
          <el-button
            v-if="auth.hasPerm('opportunity:delete')"
            type="danger"
            plain
            @click="handleBatchDelete"
          >
            批量删除
          </el-button>
        </template>
        <el-button v-if="auth.hasPerm('opportunity:create')" type="primary" @click="openCreate">
          新建商机
        </el-button>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <template v-if="viewMode === 'list'">
          <CrmSearchInput
            v-model="query.keyword"
            placeholder="搜索商机名称"
            @search="((query.page = 1), loadData())"
          />
          <el-select
            v-model="query.stageId"
            clearable
            placeholder="阶段"
            class="!w-32"
            @change="((query.page = 1), loadData())"
          >
            <el-option v-for="s in stages" :key="s.id" :label="s.name" :value="s.id" />
          </el-select>
          <AdvancedFilter
            :fields="fields"
            :members="fieldRefs.members.value"
            :dept-tree="fieldRefs.deptTree.value"
            @apply="(c) => ((filters = c), (query.page = 1), loadData())"
          />
        </template>
        <CrmDisplayModeSwitch
          v-model="viewMode"
          board-value="kanban"
          @update:model-value="loadData"
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
      module="opportunity"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      @change="onSavedViewChange"
      @clear-filters="((filters = []), (query.page = 1), loadData())"
      @columns-change="onColumnsChange"
    />

    <!-- 列表视图 -->
    <template v-if="viewMode === 'list'">
      <el-table
        v-loading="loading"
        :data="items"
        stripe
        class="w-full"
        @selection-change="handleSelectionChange"
      >
        <el-table-column type="selection" width="48" />
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
        <el-table-column label="客户" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.customerName }}</template>
        </el-table-column>
        <el-table-column label="阶段" width="130">
          <template #default="{ row }">
            <el-tag :type="row.isWon ? 'success' : row.isLost ? 'danger' : 'primary'" size="small">
              {{ row.stageName }} {{ row.isWon || row.isLost ? '' : `${row.stageProbability}%` }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="280" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openFollow(row as OpportunityVO)"
              >跟进</el-button
            >
            <el-button
              v-if="auth.hasPerm('opportunity:stage') && !row.isWon && !row.isLost"
              link
              type="primary"
              @click="openStageChange(row as OpportunityVO)"
            >
              推进
            </el-button>
            <el-button link @click="openEdit(row as OpportunityVO)">编辑</el-button>
            <el-button
              v-if="auth.hasPerm('quote:create')"
              link
              @click="toQuote(row as OpportunityVO)"
            >
              转报价
            </el-button>
            <el-button
              v-if="auth.hasPerm('opportunity:delete')"
              link
              type="danger"
              @click="handleDelete(row as OpportunityVO)"
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
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="loadData"
          @size-change="((query.page = 1), loadData())"
        />
      </div>
    </template>

    <!-- 看板视图 -->
    <div v-else v-loading="loading" class="flex gap-3 overflow-x-auto pb-2">
      <div
        v-for="stage in kanbanStages"
        :key="stage.id"
        class="w-64 shrink-0 rounded-[var(--border-radius-medium)] bg-[var(--el-fill-color-light)] p-2"
      >
        <div class="flex-between px-1 py-2">
          <span class="text-sm font-medium">
            {{ stage.name }}
            <span class="text-xs text-[var(--el-text-color-secondary)]">
              {{ stage.isWon || stage.isLost ? '' : `${stage.probability}%` }}
            </span>
          </span>
          <span class="text-xs text-[var(--el-text-color-secondary)]">
            {{ stage.count }} 个 · ¥{{ (stage.amountSum ?? 0).toLocaleString('zh-CN') }}
          </span>
        </div>
        <draggable
          :list="kanbanItems[stage.id] ?? []"
          item-key="id"
          group="opportunity-board"
          data-testid="opportunity-board-column"
          class="space-y-2 min-h-24 max-h-[60vh] overflow-y-auto"
          @change="handleBoardChange(stage.id, $event)"
        >
          <template #item="{ element: opportunity }">
            <div
              class="rounded bg-[var(--el-bg-color)] p-3 shadow-sm cursor-pointer hover:shadow"
              @click="openDetail(opportunity.id)"
            >
              <div class="text-sm font-medium truncate">{{ opportunity.name }}</div>
              <div class="text-xs text-[var(--el-text-color-secondary)] mt-1 truncate">
                {{ opportunity.customerName || '-' }}
              </div>
              <div class="flex-between mt-2">
                <span class="text-xs">{{ formatAmount(opportunity.amount) }}</span>
                <span class="text-xs text-[var(--el-text-color-secondary)]">
                  {{ opportunity.ownerName ?? '-' }}
                </span>
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </div>

    <!-- 新建/编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑商机' : '新建商机'"
      width="860px"
      destroy-on-close
    >
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-x-4">
          <el-form-item label="商机名称" required>
            <el-input v-model="businessForm.name" maxlength="255" />
          </el-form-item>
          <el-form-item label="负责人" required>
            <el-select v-model="businessForm.owner" filterable class="w-full">
              <el-option
                v-for="member in fieldRefs.members.value"
                :key="member.id"
                :label="member.name"
                :value="member.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="关联客户">
            <el-select
              v-model="businessForm.customerId"
              filterable
              remote
              clearable
              :remote-method="searchCustomers"
              placeholder="搜索并选择客户"
              class="w-full"
              @change="
                ((businessForm.contactId = ''), loadContacts(businessForm.customerId || undefined))
              "
            >
              <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="联系人">
            <el-select
              v-model="businessForm.contactId"
              clearable
              filterable
              :disabled="!businessForm.customerId"
              class="w-full"
            >
              <el-option
                v-for="contact in contactOptions"
                :key="contact.id"
                :label="contact.name"
                :value="contact.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="商机金额">
            <el-input-number
              v-model="businessForm.amount"
              :min="0"
              :precision="2"
              class="!w-full"
            />
          </el-form-item>
          <el-form-item label="可能性">
            <el-input-number
              v-model="businessForm.possible"
              :min="0"
              :max="100"
              :precision="2"
              class="!w-full"
            />
          </el-form-item>
          <el-form-item label="意向产品">
            <el-select v-model="businessForm.products" multiple filterable clearable class="w-full">
              <el-option
                v-for="product in productOptions"
                :key="product.id"
                :label="product.name"
                :value="product.id"
              />
            </el-select>
          </el-form-item>
          <el-form-item label="结束时间">
            <el-date-picker
              v-model="businessForm.expectedEndTime"
              type="date"
              value-format="x"
              clearable
              class="!w-full"
            />
          </el-form-item>
        </div>
      </el-form>
      <DynamicForm
        ref="dynamicFormRef"
        v-model="formModel"
        :fields="customFormFields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <!-- 阶段推进 -->
    <el-dialog
      v-model="stageVisible"
      :title="`推进阶段 · ${stageTarget?.name ?? ''}`"
      width="440px"
    >
      <el-form label-width="90px">
        <el-form-item label="目标阶段">
          <el-select v-model="stageForm.stageId" class="w-full">
            <el-option
              v-for="s in stages"
              :key="s.id"
              :label="`${s.name}${s.isWon || s.isLost ? '' : ` (${s.probability}%)`}`"
              :value="s.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item v-if="selectedStage?.isLost && failureReasonEnabled" label="失败原因">
          <el-select v-model="stageForm.failureReason" class="w-full" placeholder="请选择失败原因">
            <el-option
              v-for="reason in failureReasons"
              :key="reason.id"
              :label="reason.name"
              :value="reason.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="stageVisible = false">取消</el-button>
        <el-button type="primary" @click="handleStageChange">确认</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="transferVisible" title="批量转移商机" width="420px">
      <el-form label-width="80px">
        <el-form-item label="负责人" required>
          <el-select v-model="transferOwner" filterable class="w-full">
            <el-option
              v-for="member in fieldRefs.members.value"
              :key="member.id"
              :label="member.name"
              :value="member.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="transferVisible = false">取消</el-button>
        <el-button type="primary" @click="handleBatchTransfer">确认转移</el-button>
      </template>
    </el-dialog>

    <FollowUpDrawer
      v-model="followVisible"
      target-type="opportunity"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="loadData"
    />

    <OpportunityDetailDrawer v-model="detailVisible" :opportunity-id="detailOpportunityId" />
  </el-card>
</template>
