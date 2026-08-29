<script setup lang="ts">
import type { ContractVO, FieldVO, FilterCondition, ProductVO } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { listCustomers } from '@/api/customers'
import { contractApi, productApi, quoteApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { opportunityApi } from '@/api/sales'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import ContractDetailDrawer from '@/components/ContractDetailDrawer.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'

type ContractStage = {
  id: string
  name: string
  type: string
  pos: number
  circulationType: string
  stageHasData?: boolean
}

type ProductEdit = {
  rowId?: string
  bizId?: string
  product: string
  productAmount: number
  productNumber: number
  amount?: number
  values?: Record<string, unknown>
}

const auth = useAuthStore()
const route = useRoute()
const fieldRefs = useFieldRefs()
const homeQuickCreate = useHomeQuickCreate()

const fields = ref<FieldVO[]>([])
const formConfig = ref<Record<string, unknown>>({})
const rows = ref<ContractVO[]>([])
const stages = ref<ContractStage[]>([])
const products = ref<ProductVO[]>([])
const customers = ref<Array<{ id: string; name: string }>>([])
const total = ref(0)
const loading = ref(false)
const filters = ref<FilterCondition[]>([])
const activeViewId = ref<string>()
const visibleColumnKeys = ref<string[]>([])
const selectedIds = ref<string[]>([])
const displayMode = ref<'table' | 'board'>('table')
const query = reactive({ current: 1, pageSize: 10, keyword: '' })

const metaReady = ref(false)
const savedViewReady = ref(false)
const initialLoaded = ref(false)
const handledFromQuotationId = ref('')
const handledDetailId = ref('')

const formVisible = ref(false)
const formSaving = ref(false)
const formRef = ref<InstanceType<typeof DynamicForm>>()
const editingId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const contractName = ref('')
const customerId = ref('')
const ownerId = ref('')
const contractNumber = ref('')
const startTime = ref<number>()
const endTime = ref<number>()
const contractAmount = ref(0)
const contractProducts = ref<ProductEdit[]>([])
const fromQuotationId = ref<string>()

const detailVisible = ref(false)
const detailId = ref<string | null>(null)
const batchEditVisible = ref(false)
const batchApprovalVisible = ref(false)
const batchApprovalStatus = ref<'APPROVED' | 'UNAPPROVED'>('APPROVED')
const batchLoading = ref(false)
const draggedId = ref<string>()

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
const productMap = computed(() => new Map(products.value.map((item) => [item.id, item])))
const boardRows = computed(() => {
  const grouped = new Map(stages.value.map((stage) => [stage.id, [] as ContractVO[]]))
  rows.value.forEach((row) => grouped.get(row.stage)?.push(row))
  return grouped
})

const approvalLabels: Record<string, string> = {
  NONE: '未审批',
  APPROVING: '审批中',
  APPROVED: '已通过',
  UNAPPROVED: '已驳回',
  REVOKED: '已撤回',
}

function approvalTagType(status: string) {
  if (status === 'APPROVED') return 'success'
  if (status === 'APPROVING') return 'warning'
  if (status === 'UNAPPROVED') return 'danger'
  return 'info'
}

function dynamicValues(row: ContractVO) {
  const byId = new Map(row.moduleFields.map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, byId.get(field.id)]))
}

function displayRow(row: ContractVO) {
  return {
    ...row,
    ...dynamicValues(row),
    customerId: row.customerName ?? row.customerId,
    owner: row.ownerName ?? row.owner,
    stage: row.stageName ?? row.stage,
  }
}

function defaultDynamicModel() {
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]))
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({ fieldId: field.id, fieldValue: formModel.value[field.key] }))
}

function productPayload(row: ProductEdit) {
  const amount = row.amount ?? Math.round(row.productAmount * row.productNumber * 100) / 100
  return {
    ...(row.rowId ? { rowId: row.rowId } : {}),
    ...(row.bizId ? { bizId: row.bizId } : {}),
    product: row.product,
    productAmount: row.productAmount,
    productNumber: row.productNumber,
    amount,
    ...(row.values ? { values: row.values } : {}),
  }
}

async function loadMeta() {
  const [{ data: config }, { data: productPage }, { data: customerPage }, { data: stageConfig }] = await Promise.all([
    contractApi.moduleForm(),
    productApi.page({ current: 1, pageSize: 500, status: '1' }),
    listCustomers({ page: 1, pageSize: 200 }),
    contractApi.stages(),
    fieldRefs.load(),
  ])
  formConfig.value = config as unknown as Record<string, unknown>
  fields.value = (config.fields ?? []) as FieldVO[]
  products.value = productPage.list
  customers.value = customerPage.items.map((item) => ({ id: item.id, name: item.name }))
  stages.value = stageConfig.stageConfigList
  visibleColumnKeys.value = defaultColumnKeys.value
  metaReady.value = true
}

async function loadData() {
  if (!metaReady.value || !savedViewReady.value) return
  loading.value = true
  try {
    const { data } = await contractApi.page({
      current: query.current,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      viewId: activeViewId.value,
      filters: filters.value.length ? filters.value : undefined,
      board: displayMode.value === 'board',
    })
    rows.value = data.list
    total.value = data.total
    if (data.stages?.length) stages.value = data.stages
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
  query.current = 1
  if (initialLoaded.value) void loadData()
  else maybeInitialLoad()
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

function onDisplayModeChange() {
  query.current = 1
  void loadData()
}

function resetForm() {
  editingId.value = null
  formModel.value = defaultDynamicModel()
  contractName.value = ''
  customerId.value = ''
  ownerId.value = auth.user?.id ?? ''
  contractNumber.value = ''
  startTime.value = undefined
  endTime.value = undefined
  contractAmount.value = 0
  contractProducts.value = []
  fromQuotationId.value = undefined
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openFromQuotation(id: string) {
  try {
    const [{ data: quotation }, { data: quotationSnapshot }] = await Promise.all([
      quoteApi.detail(id),
      quoteApi.snapshot(id),
    ])
    if (!quotation.approved || quotation.invalid) {
      ElMessage.warning('仅支持从已审批且未作废的报价创建合同')
      return
    }
    const { data: opportunity } = await opportunityApi.get(quotation.opportunityId)
    resetForm()
    contractName.value = `${quotation.name}-合同`
    customerId.value = opportunity.customerId || ''
    contractAmount.value = quotation.amount
    fromQuotationId.value = quotation.id
    contractProducts.value = quotation.products.map((item) => ({
      product: item.productId,
      productAmount: item.productAmount,
      productNumber: 1,
      amount: item.productAmount,
    }))
    if (opportunity.customerId && !customers.value.some((item) => item.id === opportunity.customerId)) {
      customers.value.unshift({ id: opportunity.customerId, name: opportunity.customerName ?? opportunity.customerId })
    }
    if (quotationSnapshot && typeof quotationSnapshot === 'object') {
      // 快照只用于保证深链读取成功；合同不持久化 quotationId/opportunityId。
    }
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function routeQueryValue(name: 'fromQuote' | 'id') {
  const value = route.query[name]
  if (typeof value === 'string' && value) return value
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0]) return value[0]
  if (typeof window !== 'undefined') return new URLSearchParams(window.location.search).get(name) ?? ''
  return ''
}

async function consumeRouteDeepLinks() {
  if (!metaReady.value) return
  const fromQuote = routeQueryValue('fromQuote')
  if (fromQuote && handledFromQuotationId.value !== fromQuote) {
    handledFromQuotationId.value = fromQuote
    await openFromQuotation(fromQuote)
  }
  const detail = routeQueryValue('id')
  if (detail && handledDetailId.value !== detail) {
    handledDetailId.value = detail
    detailId.value = detail
    detailVisible.value = true
  }
}

async function openEdit(row: ContractVO) {
  try {
    const { data } = await contractApi.detail(row.id)
    editingId.value = data.id
    contractName.value = data.name
    customerId.value = data.customerId
    ownerId.value = data.owner
    contractNumber.value = data.number
    startTime.value = data.startTime ?? undefined
    endTime.value = data.endTime ?? undefined
    contractAmount.value = data.amount
    fromQuotationId.value = undefined
    formModel.value = { ...defaultDynamicModel(), ...dynamicValues(data) }
    contractProducts.value = data.products.map((item) => ({
      rowId: item.rowId,
      bizId: item.bizId,
      product: item.productId,
      productAmount: item.productAmount,
      productNumber: item.productNumber,
      amount: item.amount,
      values: item.values,
    }))
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function addProductRow() {
  contractProducts.value.push({ product: '', productAmount: 0, productNumber: 1 })
}

function onProductChange(row: ProductEdit) {
  const product = productMap.value.get(row.product)
  if (product?.price !== null && product?.price !== undefined) row.productAmount = Number(product.price)
  row.amount = Math.round(row.productAmount * row.productNumber * 100) / 100
}

function updateProductAmount(row: ProductEdit) {
  row.amount = Math.round(row.productAmount * row.productNumber * 100) / 100
  contractAmount.value = Math.round(contractProducts.value.reduce((sum, item) => sum + (item.amount ?? item.productAmount * item.productNumber), 0) * 100) / 100
}

async function saveContract() {
  if (!contractName.value.trim()) return void ElMessage.warning('请输入合同名称')
  if (!customerId.value) return void ElMessage.warning('请选择客户')
  if (!ownerId.value) return void ElMessage.warning('请选择负责人')
  if (contractProducts.value.some((item) => !item.product)) return void ElMessage.warning('请补完整产品信息')
  if (!(await formRef.value?.validate())) return
  formSaving.value = true
  try {
    const payload: Record<string, unknown> = {
      ...(editingId.value ? { id: editingId.value } : {}),
      name: contractName.value.trim(),
      customerId: customerId.value,
      owner: ownerId.value,
      amount: Number(contractAmount.value || 0),
      startTime: startTime.value ?? null,
      endTime: endTime.value ?? null,
      ...(contractNumber.value.trim() ? { number: contractNumber.value.trim() } : {}),
      moduleFields: moduleFieldsPayload(),
      moduleFormConfigDTO: formConfig.value,
      products: contractProducts.value.map(productPayload),
      ...(!editingId.value && fromQuotationId.value ? { fromQuotationId: fromQuotationId.value } : {}),
    }
    if (editingId.value) await contractApi.update(payload)
    else await contractApi.create(payload)
    ElMessage.success(editingId.value ? '合同已更新' : '合同已创建')
    formVisible.value = false
    if (!editingId.value && (await homeQuickCreate.completeCreated())) return
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    formSaving.value = false
  }
}

function openDetail(row: ContractVO) {
  detailId.value = row.id
  detailVisible.value = true
}

async function handleApproval(row: ContractVO, approvalStatus: 'APPROVED' | 'UNAPPROVED') {
  try {
    await contractApi.approve({ id: row.id, approvalStatus })
    ElMessage.success(approvalStatus === 'APPROVED' ? '审批已通过' : '审批已驳回')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleRevoke(row: ContractVO) {
  const ok = await ElMessageBox.confirm(`撤回合同「${row.name}」当前审批？`, '撤回审批').catch(() => false)
  if (!ok) return
  try {
    await contractApi.revoke(row.id)
    ElMessage.success('审批已撤回')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: ContractVO) {
  const ok = await ElMessageBox.confirm(`确认删除合同「${row.name}」吗？配置删除审批时会先提交审批。`, '删除合同', { type: 'warning' }).catch(() => false)
  if (!ok) return
  try {
    const { data } = await contractApi.remove(row.id)
    ElMessage.success(data.pendingApproval ? '已提交删除审批' : '合同已删除')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function moveStage(row: ContractVO, stageId: string) {
  if (row.stage === stageId) return
  const target = stages.value.find((item) => item.id === stageId)
  let voidReason: string | undefined
  if (target?.name === '作废') {
    const result = await ElMessageBox.prompt('请输入合同作废原因', '合同作废', { inputPattern: /\S+/, inputErrorMessage: '作废原因不能为空' }).catch(() => null)
    if (!result) return
    voidReason = result.value.trim()
  }
  try {
    await contractApi.updateStage({ id: row.id, stage: stageId, ...(voidReason ? { voidReason } : {}) })
    ElMessage.success(`合同已流转到「${target?.name ?? stageId}」`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function startDrag(row: ContractVO, event?: DragEvent) {
  draggedId.value = row.id
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', row.id)
  }
}

async function dropToStage(stage: ContractStage, event?: DragEvent) {
  const id = event?.dataTransfer?.getData('text/plain') || draggedId.value
  draggedId.value = undefined
  if (!id) return
  const row = rows.value.find((item) => item.id === id)
  if (!row) return
  if (row.stage === stage.id) {
    const pos = (boardRows.value.get(stage.id)?.length ?? 1)
    await contractApi.sort({ id: row.id, stage: stage.id, pos })
    await loadData()
    return
  }
  await moveStage(row, stage.id)
}

async function batchApprove() {
  batchLoading.value = true
  try {
    const { data } = await contractApi.batchApprove({ ids: selectedIds.value, approvalStatus: batchApprovalStatus.value })
    ElMessage.success(`批量审批：成功 ${data.success}，跳过 ${data.skip}，失败 ${data.fail}`)
    selectedIds.value = []
    batchApprovalVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    batchLoading.value = false
  }
}

async function submitBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  try {
    await contractApi.batchUpdate({ ids: selectedIds.value, ...payload })
    selectedIds.value = []
    batchEditVisible.value = false
    ElMessage.success('批量修改成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  await loadMeta()
  await homeQuickCreate.consume(openCreate)
  maybeInitialLoad()
})

watch(
  () => [metaReady.value, route.query.fromQuote, route.query.id] as const,
  ([ready]) => {
    if (ready) void consumeRouteDeepLinks()
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <el-card shadow="never">
    <SavedViewBar
      module="contract"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      @change="onSavedViewChange"
      @ready="onSavedViewReady"
      @clear-filters="((filters = []), (query.current = 1), initialLoaded && loadData())"
      @columns-change="(keys) => (visibleColumnKeys = keys)"
    />

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex items-center gap-2">
        <el-input v-model="query.keyword" placeholder="通过合同名称 / 编号 / 客户搜索" clearable class="!w-72" @keyup.enter="((query.current = 1), loadData())" @clear="((query.current = 1), loadData())" />
        <AdvancedFilter :fields="fields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" @apply="onFilterApply" />
        <el-segmented v-model="displayMode" :options="[{ label: '列表', value: 'table' }, { label: '看板', value: 'board' }]" @change="onDisplayModeChange" />
      </div>
      <div class="flex items-center gap-2">
        <template v-if="selectedIds.length">
          <el-button @click="batchEditVisible = true">批量修改</el-button>
          <el-button v-if="auth.hasPerm('contract:submit')" @click="batchApprovalVisible = true">批量审批</el-button>
        </template>
        <el-button v-if="auth.hasPerm('contract:create')" type="primary" @click="openCreate">新建合同</el-button>
      </div>
    </div>

    <el-table v-if="displayMode === 'table'" v-loading="loading" :data="rows" stripe class="w-full" @selection-change="(selected: ContractVO[]) => (selectedIds = selected.map((row) => row.id))">
      <el-table-column type="selection" width="48" />
      <el-table-column v-for="column in visibleColumns" :key="column.key" :label="column.label" :min-width="column.listWidth ?? 140" show-overflow-tooltip>
        <template #default="{ row }">
          <el-button v-if="column.key === 'name'" link type="primary" @click="openDetail(row as ContractVO)">{{ row.name }}</el-button>
          <template v-else-if="column.key === 'amount'">¥{{ Number(row.amount).toLocaleString('zh-CN') }}</template>
          <template v-else-if="column.key === 'customerId'">{{ row.customerName }}</template>
          <template v-else-if="column.key === 'owner'">{{ row.ownerName }}</template>
          <template v-else-if="column.key === 'stage'">{{ row.stageName }}</template>
          <template v-else>{{ formatFieldValue(column, displayRow(row as ContractVO), { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
        </template>
      </el-table-column>
      <el-table-column label="审批状态" width="110"><template #default="{ row }"><el-tag :type="approvalTagType(row.approvalStatus)" size="small">{{ approvalLabels[row.approvalStatus] ?? row.approvalStatus }}</el-tag></template></el-table-column>
      <el-table-column label="阶段" width="130"><template #default="{ row }"><el-select :model-value="row.stage" size="small" @change="(value: string) => moveStage(row as ContractVO, value)"><el-option v-for="stage in stages" :key="stage.id" :label="stage.name" :value="stage.id" /></el-select></template></el-table-column>
      <el-table-column label="操作" width="280" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row as ContractVO)">详情</el-button>
          <el-button v-if="auth.hasPerm('contract:update') && row.approvalStatus !== 'APPROVING'" link @click="openEdit(row as ContractVO)">编辑</el-button>
          <template v-if="row.approvalStatus === 'APPROVING' && auth.hasPerm('contract:submit')">
            <el-button link type="success" @click="handleApproval(row as ContractVO, 'APPROVED')">通过</el-button>
            <el-button link type="danger" @click="handleApproval(row as ContractVO, 'UNAPPROVED')">驳回</el-button>
            <el-button link @click="handleRevoke(row as ContractVO)">撤回</el-button>
          </template>
          <el-button v-if="auth.hasPerm('contract:delete')" link type="danger" @click="handleDelete(row as ContractVO)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-else v-loading="loading" class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3 items-start overflow-x-auto">
      <section v-for="stage in stages" :key="stage.id" class="rounded border border-[var(--el-border-color)] bg-[var(--el-fill-color-lighter)] min-h-32" @dragover.prevent @drop="dropToStage(stage, $event)">
        <div class="flex-between px-3 py-2 border-b border-[var(--el-border-color)]"><strong>{{ stage.name }}</strong><span class="text-xs text-[var(--el-text-color-secondary)]">{{ boardRows.get(stage.id)?.length ?? 0 }}</span></div>
        <div class="p-2 space-y-2">
          <article v-for="row in boardRows.get(stage.id) ?? []" :key="row.id" draggable="true" class="rounded bg-[var(--el-bg-color)] border border-[var(--el-border-color-lighter)] p-3 cursor-move" @dragstart="startDrag(row, $event)">
            <el-button link type="primary" class="!p-0" @click="openDetail(row)">{{ row.name }}</el-button>
            <div class="text-sm mt-2">{{ row.customerName }}</div>
            <div class="flex-between text-xs text-[var(--el-text-color-secondary)] mt-2"><span>{{ row.ownerName }}</span><span>¥{{ row.amount.toLocaleString('zh-CN') }}</span></div>
          </article>
        </div>
      </section>
    </div>

    <div v-if="displayMode === 'table'" class="flex justify-end mt-4"><el-pagination v-model:current-page="query.current" v-model:page-size="query.pageSize" :total="total" layout="total, sizes, prev, pager, next" @current-change="loadData" @size-change="((query.current = 1), loadData())" /></div>
  </el-card>

  <el-drawer v-model="formVisible" :title="editingId ? '编辑合同' : '新建合同'" size="780px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="合同名称" required><el-input v-model="contractName" maxlength="255" show-word-limit /></el-form-item>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="客户" required><el-select v-model="customerId" filterable class="w-full"><el-option v-for="item in customers" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
        <el-form-item label="负责人" required><el-select v-model="ownerId" filterable class="w-full"><el-option v-for="member in fieldRefs.members.value" :key="member.id" :label="member.name" :value="member.id" /></el-select></el-form-item>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="开始时间"><el-date-picker v-model="startTime" type="date" value-format="x" class="!w-full" /></el-form-item>
        <el-form-item label="结束时间"><el-date-picker v-model="endTime" type="date" value-format="x" class="!w-full" /></el-form-item>
      </div>
      <el-form-item label="合同编号"><el-input v-model="contractNumber" placeholder="留空由系统自动生成" /></el-form-item>
      <DynamicForm ref="formRef" v-model="formModel" :fields="dynamicFields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" />
      <el-form-item label="累计金额"><el-input-number v-model="contractAmount" :min="0" :max="9999999999" :precision="2" :controls="false" class="!w-full" /></el-form-item>
    </el-form>

    <div class="flex-between mb-2"><div class="font-medium">产品信息</div><el-button type="primary" plain @click="addProductRow">添加产品</el-button></div>
    <el-table :data="contractProducts" border>
      <el-table-column label="产品" min-width="180"><template #default="{ row }"><el-select v-model="row.product" filterable class="w-full" @change="onProductChange(row as ProductEdit)"><el-option v-for="item in products" :key="item.id" :label="item.name" :value="item.id" /></el-select></template></el-table-column>
      <el-table-column label="单价" width="130"><template #default="{ row }"><el-input-number v-model="row.productAmount" :min="0" :precision="2" :controls="false" class="!w-full" @change="updateProductAmount(row as ProductEdit)" /></template></el-table-column>
      <el-table-column label="数量" width="110"><template #default="{ row }"><el-input-number v-model="row.productNumber" :min="0" :precision="2" :controls="false" class="!w-full" @change="updateProductAmount(row as ProductEdit)" /></template></el-table-column>
      <el-table-column label="金额" width="120"><template #default="{ row }">¥{{ Number(row.amount ?? row.productAmount * row.productNumber).toLocaleString('zh-CN') }}</template></el-table-column>
      <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" @click="contractProducts.splice($index, 1)">删</el-button></template></el-table-column>
    </el-table>
    <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="formSaving" @click="saveContract">保存</el-button></template>
  </el-drawer>

  <ContractDetailDrawer v-model="detailVisible" :contract-id="detailId" @changed="initialLoaded && loadData()" />
  <BatchFieldEditDialog v-model="batchEditVisible" title="批量修改合同" :fields="fields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" :selected-count="selectedIds.length" @confirm="submitBatchEdit" />
  <el-dialog v-model="batchApprovalVisible" title="批量审批" width="420px"><el-form label-position="top"><el-form-item label="审批结果"><el-radio-group v-model="batchApprovalStatus"><el-radio value="APPROVED">通过</el-radio><el-radio value="UNAPPROVED">驳回</el-radio></el-radio-group></el-form-item></el-form><template #footer><el-button @click="batchApprovalVisible = false">取消</el-button><el-button type="primary" :loading="batchLoading" @click="batchApprove">确认</el-button></template></el-dialog>
</template>
