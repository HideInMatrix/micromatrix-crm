<script setup lang="ts">
import type { FieldVO, FilterCondition, OrderVO, ProductVO } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { listCustomers } from '@/api/customers'
import { contractApi, orderApi, productApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import CrmDisplayModeSwitch from '@/components/CrmDisplayModeSwitch.vue'
import CrmSearchInput from '@/components/CrmSearchInput.vue'
import CrmTableUtilityActions from '@/components/CrmTableUtilityActions.vue'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useHomeQuickCreate } from '@/composables/useHomeQuickCreate'
import { useAuthStore } from '@/stores/auth'

interface OrderStage {
  id: string
  name: string
  type: string
  pos: number
  circulationType: string
}

interface OrderProductEdit {
  rowId?: string
  bizId?: string
  product: string
  productPrice: number
  productNumber: number
  amount?: number
  values?: Record<string, unknown>
}

const props = withDefaults(
  defineProps<{
    standalone?: boolean
    customerId?: string
    contractId?: string
    fromContractId?: string
  }>(),
  { standalone: true, customerId: undefined, contractId: undefined, fromContractId: undefined },
)
const emit = defineEmits<{ changed: [] }>()

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()
const homeQuickCreate = useHomeQuickCreate()

const fields = ref<FieldVO[]>([])
const formConfig = ref<Record<string, unknown>>({})
const rows = ref<OrderVO[]>([])
const stages = ref<OrderStage[]>([])
const products = ref<ProductVO[]>([])
const customers = ref<Array<{ id: string; name: string }>>([])
const contracts = ref<Array<{ id: string; name: string; number: string; customerId: string }>>([])
const total = ref(0)
const loading = ref(false)
const filters = ref<FilterCondition[]>([])
const activeViewId = ref<string>()
const activeSystemView = ref<string>()
const systemViews = ref<Array<{ id: string; label: string }>>([])
const visibleColumnKeys = ref<string[]>([])
const selectedIds = ref<string[]>([])
const displayMode = ref<'table' | 'board'>('table')
const query = reactive({ current: 1, pageSize: 10, keyword: '' })

const metaReady = ref(false)
const savedViewReady = ref(!props.standalone)
const initialLoaded = ref(false)
const consumedFromContract = ref('')

const formVisible = ref(false)
const formSaving = ref(false)
const formRef = ref<InstanceType<typeof DynamicForm>>()
const editingId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const orderName = ref('')
const formCustomerId = ref('')
const formContractId = ref<string | null>(null)
const ownerId = ref('')
const orderNumber = ref('')
const orderAmount = ref(0)
const orderProducts = ref<OrderProductEdit[]>([])

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<OrderVO | null>(null)
const detailSnapshot = ref<Record<string, unknown> | null>(null)
const detailSnapshotForm = ref<Record<string, unknown> | null>(null)
const detailApproval = ref<Record<string, unknown> | null>(null)
const approvalSummaries = ref<Record<string, Record<string, unknown> | null>>({})

const batchEditVisible = ref(false)
const importVisible = ref(false)
const exportVisible = ref(false)
const exportLoading = ref(false)
const exportMode = ref<'all' | 'selected'>('all')
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
const filteredContracts = computed(() =>
  contracts.value.filter(
    (item) => !formCustomerId.value || item.customerId === formCustomerId.value,
  ),
)
const boardRows = computed(() => {
  const grouped = new Map(stages.value.map((stage) => [stage.id, [] as OrderVO[]]))
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

function dynamicValues(row: OrderVO) {
  const byId = new Map(row.moduleFields.map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, byId.get(field.id)]))
}

function displayRow(row: OrderVO) {
  return {
    ...row,
    ...dynamicValues(row),
    customerId: row.customerName ?? row.customerId,
    contractId: row.contractName ?? row.contractId,
    owner: row.ownerName ?? row.owner,
    stage: row.stageName ?? row.stage,
  }
}

function defaultDynamicModel() {
  return Object.fromEntries(
    dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]),
  )
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({
    fieldId: field.id,
    fieldValue: formModel.value[field.key],
  }))
}

function productPayload(row: OrderProductEdit) {
  const amount = row.amount ?? Math.round(row.productPrice * row.productNumber * 100) / 100
  return {
    ...(row.rowId ? { rowId: row.rowId } : {}),
    ...(row.bizId ? { bizId: row.bizId } : {}),
    product: row.product,
    productPrice: Number(row.productPrice || 0),
    productNumber: Number(row.productNumber || 0),
    amount,
    ...(row.values ? { values: row.values } : {}),
  }
}

async function loadMeta() {
  try {
    const [configRes, productRes, customerRes, contractRes, tabRes] = await Promise.all([
      orderApi.moduleForm(),
      productApi.page({ current: 1, pageSize: 500, status: '1' }),
      listCustomers({ page: 1, pageSize: 200 }),
      contractApi.page({ current: 1, pageSize: 500 }),
      props.standalone ? orderApi.tab() : Promise.resolve({ data: { all: false, dept: false } }),
      fieldRefs.load(),
    ])
    const config = configRes.data
    formConfig.value = config as unknown as Record<string, unknown>
    fields.value = (config.fields ?? []) as FieldVO[]
    products.value = productRes.data.list
    customers.value = customerRes.data.items.map((item) => ({ id: item.id, name: item.name }))
    contracts.value = contractRes.data.list.map((item) => ({
      id: item.id,
      name: item.name,
      number: item.number,
      customerId: item.customerId,
    }))
    visibleColumnKeys.value = defaultColumnKeys.value
    if (props.standalone) {
      systemViews.value = [
        ...(tabRes.data.all ? [{ id: 'ALL', label: '全部' }] : []),
        ...(tabRes.data.dept ? [{ id: 'DEPARTMENT', label: '部门' }] : []),
      ]
      activeSystemView.value = systemViews.value[0]?.id
    }
    metaReady.value = true
    maybeInitialLoad()
    await consumeFromContract()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  if (!metaReady.value || !savedViewReady.value) return
  loading.value = true
  try {
    const { data } = await orderApi.page({
      current: query.current,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      viewId: props.standalone ? (activeViewId.value ?? activeSystemView.value) : undefined,
      filters: props.standalone && filters.value.length ? filters.value : undefined,
      board: props.standalone && displayMode.value === 'board',
      customerId: props.customerId,
      contractId: props.contractId,
    })
    rows.value = data.list
    total.value = data.total
    if (data.stages?.length) stages.value = data.stages
    selectedIds.value = selectedIds.value.filter((id) => data.list.some((row) => row.id === id))
    emit('changed')
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

function onDisplayModeChange() {
  query.current = 1
  selectedIds.value = []
  void loadData()
}

function resetForm() {
  editingId.value = null
  formModel.value = defaultDynamicModel()
  orderName.value = ''
  formCustomerId.value = props.customerId ?? ''
  formContractId.value = props.contractId ?? null
  ownerId.value = auth.user?.id ?? ''
  orderNumber.value = ''
  orderAmount.value = 0
  orderProducts.value = []
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openFromContract(sourceId: string) {
  try {
    const { data: contract } = await contractApi.detail(sourceId)
    resetForm()
    orderName.value = `${contract.name}-订单`
    formCustomerId.value = contract.customerId
    formContractId.value = contract.id
    ownerId.value = contract.owner || auth.user?.id || ''
    orderAmount.value = Number(contract.amount ?? 0)
    orderProducts.value = contract.products.map((item) => ({
      product: item.productId,
      productPrice: Number(item.productAmount ?? 0),
      productNumber: Number(item.productNumber ?? 1),
      amount: Number(item.amount ?? 0),
      values: item.values,
    }))
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function consumeFromContract() {
  const id = props.fromContractId?.trim()
  if (!props.standalone || !id || consumedFromContract.value === id || !metaReady.value) return
  consumedFromContract.value = id
  await openFromContract(id)
}

async function openEdit(row: OrderVO) {
  try {
    const { data } = await orderApi.detail(row.id)
    editingId.value = data.id
    orderName.value = data.name
    formCustomerId.value = data.customerId ?? ''
    formContractId.value = data.contractId
    ownerId.value = data.owner ?? ''
    orderNumber.value = data.number
    orderAmount.value = Number(data.amount ?? 0)
    formModel.value = { ...defaultDynamicModel(), ...dynamicValues(data) }
    orderProducts.value = data.products.map((item) => ({
      rowId: item.rowId,
      bizId: item.bizId,
      product: item.productId,
      productPrice: Number(item.productPrice ?? 0),
      productNumber: Number(item.productNumber ?? 0),
      amount: Number(item.amount ?? 0),
      values: item.values,
    }))
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function onCustomerChange() {
  if (
    formContractId.value &&
    !filteredContracts.value.some((item) => item.id === formContractId.value)
  ) {
    formContractId.value = null
  }
}

function addProductRow() {
  orderProducts.value.push({ product: '', productPrice: 0, productNumber: 1 })
}

function onProductChange(row: OrderProductEdit) {
  const product = productMap.value.get(row.product)
  if (product?.price !== null && product?.price !== undefined)
    row.productPrice = Number(product.price)
  updateProductAmount(row)
}

function updateProductAmount(row: OrderProductEdit) {
  row.amount =
    Math.round(Number(row.productPrice || 0) * Number(row.productNumber || 0) * 100) / 100
  orderAmount.value =
    Math.round(orderProducts.value.reduce((sum, item) => sum + Number(item.amount ?? 0), 0) * 100) /
    100
}

async function saveOrder() {
  if (!orderName.value.trim()) return void ElMessage.warning('请输入订单名称')
  if (!formCustomerId.value) return void ElMessage.warning('请选择客户')
  if (!ownerId.value) return void ElMessage.warning('请选择负责人')
  if (orderProducts.value.some((item) => !item.product))
    return void ElMessage.warning('请补完整产品信息')
  if (!(await formRef.value?.validate())) return
  formSaving.value = true
  try {
    const payload: Record<string, unknown> = {
      ...(editingId.value ? { id: editingId.value } : {}),
      name: orderName.value.trim(),
      customerId: formCustomerId.value,
      contractId: formContractId.value || null,
      owner: ownerId.value,
      amount: Number(orderAmount.value || 0),
      ...(orderNumber.value.trim() ? { number: orderNumber.value.trim() } : {}),
      moduleFields: moduleFieldsPayload(),
      moduleFormConfigDTO: formConfig.value,
      products: orderProducts.value.map(productPayload),
    }
    if (editingId.value) await orderApi.update(payload)
    else await orderApi.create(payload)
    ElMessage.success(editingId.value ? '订单已更新' : '订单已创建')
    formVisible.value = false
    if (!editingId.value && props.standalone && (await homeQuickCreate.completeCreated())) return
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    formSaving.value = false
  }
}

async function openDetail(row: OrderVO) {
  detailVisible.value = true
  detailLoading.value = true
  try {
    const [detailRes, snapshotRes, snapshotFormRes, approvalRes] = await Promise.all([
      orderApi.detail(row.id),
      orderApi.snapshot(row.id),
      orderApi.snapshotForm(row.id),
      orderApi.approvalDetail(row.id).catch(() => ({ data: null })),
    ])
    detail.value = detailRes.data
    detailSnapshot.value = snapshotRes.data
    detailSnapshotForm.value = snapshotFormRes.data
    detailApproval.value = approvalRes.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

async function loadApprovalSummary(id: string) {
  if (Object.prototype.hasOwnProperty.call(approvalSummaries.value, id)) return
  try {
    const { data } = await orderApi.approvalSimpleDetail(id)
    approvalSummaries.value = { ...approvalSummaries.value, [id]: data }
  } catch {
    approvalSummaries.value = { ...approvalSummaries.value, [id]: null }
  }
}

async function review(row: OrderVO) {
  try {
    await orderApi.approvalPush(row.id)
    ElMessage.success('已提交审批')
    approvalSummaries.value = { ...approvalSummaries.value, [row.id]: null }
    await loadData()
    if (detail.value?.id === row.id) await openDetail(row)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function revoke(row: OrderVO) {
  const confirmed = await ElMessageBox.confirm(
    `撤回订单「${row.name}」当前审批？`,
    '撤回审批',
  ).catch(() => false)
  if (!confirmed) return
  try {
    await orderApi.approvalRevoke(row.id)
    ElMessage.success('审批已撤回')
    approvalSummaries.value = { ...approvalSummaries.value, [row.id]: null }
    await loadData()
    if (detail.value?.id === row.id) await openDetail(row)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeOrder(row: OrderVO) {
  const confirmed = await ElMessageBox.confirm(
    `确认删除订单「${row.name}」吗？配置删除审批时会先提交审批。`,
    '删除订单',
    { type: 'warning' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    const { data } = await orderApi.remove(row.id)
    ElMessage.success(data.pendingApproval ? '已提交删除审批' : '订单已删除')
    if (detail.value?.id === row.id && !data.pendingApproval) detailVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function moveStage(row: OrderVO, stageId: string) {
  if (row.stage === stageId) return
  try {
    await orderApi.updateStage({ id: row.id, stage: stageId })
    const target = stages.value.find((item) => item.id === stageId)
    ElMessage.success(`订单已流转到「${target?.name ?? stageId}」`)
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function startDrag(row: OrderVO, event?: DragEvent) {
  draggedId.value = row.id
  if (event?.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', row.id)
  }
}

async function dropToStage(stage: OrderStage, event?: DragEvent) {
  const id = event?.dataTransfer?.getData('text/plain') || draggedId.value
  draggedId.value = undefined
  if (!id) return
  const row = rows.value.find((item) => item.id === id)
  if (!row) return
  try {
    if (row.stage === stage.id) {
      await orderApi.sort({
        id: row.id,
        stage: stage.id,
        pos: boardRows.value.get(stage.id)?.length ?? 1,
      })
      await loadData()
      return
    }
    await moveStage(row, stage.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function submitBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  try {
    const { data } = await orderApi.batchUpdate({ ids: selectedIds.value, ...payload })
    ElMessage.success(`批量修改：成功 ${data.success}，跳过 ${data.skip}，失败 ${data.fail}`)
    selectedIds.value = []
    batchEditVisible.value = false
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
      await orderApi.exportSelected({ ...payload, ids: selectedIds.value })
      selectedIds.value = []
    } else {
      await orderApi.exportAll({
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

onMounted(async () => {
  await loadMeta()
  if (props.standalone) await homeQuickCreate.consume(openCreate)
})

watch(
  () => [props.customerId, props.contractId] as const,
  () => {
    query.current = 1
    if (initialLoaded.value) void loadData()
  },
)

watch(
  () => props.fromContractId,
  () => void consumeFromContract(),
)
</script>

<template>
  <div>
    <div
      v-if="standalone"
      class="mb-4 flex flex-wrap items-center justify-between gap-3"
      data-testid="crm-table-primary-toolbar"
    >
      <div class="flex flex-wrap items-center gap-2">
        <el-button v-if="auth.hasPerm('ORDER:ADD')" type="primary" @click="openCreate"
          >新建订单</el-button
        >
        <el-button v-if="auth.hasPerm('ORDER:IMPORT')" @click="importVisible = true"
          >导入</el-button
        >
        <el-button v-if="auth.hasPerm('ORDER:EXPORT') && rows.length" @click="openExport('all')"
          >导出全部</el-button
        >
        <ExportTaskButton />
        <template v-if="selectedIds.length">
          <el-button v-if="auth.hasPerm('ORDER:UPDATE')" @click="batchEditVisible = true"
            >批量修改</el-button
          >
          <el-button v-if="auth.hasPerm('ORDER:EXPORT')" @click="openExport('selected')"
            >导出选中</el-button
          >
        </template>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <CrmSearchInput
          v-model="query.keyword"
          placeholder="通过订单名称 / 编号 / 客户 / 合同搜索"
          width-class="!w-80"
          @search="((query.current = 1), loadData())"
        />
        <AdvancedFilter
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="onFilterApply"
        />
        <CrmDisplayModeSwitch
          v-model="displayMode"
          list-value="table"
          board-value="board"
          @update:model-value="onDisplayModeChange"
        />
        <CrmTableUtilityActions
          :refreshing="loading"
          @columns="savedViewBarRef?.openColumnSettings()"
          @refresh="loadData"
        />
      </div>
    </div>

    <SavedViewBar
      v-if="standalone"
      ref="savedViewBarRef"
      module="order"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      :system-views="systemViews"
      :system-view="activeSystemView"
      @change="onSavedViewChange"
      @system-view-change="onSystemViewChange"
      @clear-filters="((filters = []), (query.current = 1), initialLoaded && loadData())"
      @columns-change="(keys) => (visibleColumnKeys = keys)"
      @ready="onSavedViewReady"
    />

    <el-table
      v-if="displayMode === 'table' || !standalone"
      v-loading="loading"
      :data="rows"
      stripe
      class="w-full"
      @selection-change="(selected: OrderVO[]) => (selectedIds = selected.map((row) => row.id))"
    >
      <el-table-column v-if="standalone" type="selection" width="48" />
      <el-table-column
        v-for="column in visibleColumns"
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
            @click="openDetail(row as OrderVO)"
          >
            {{ row.name }}
          </el-button>
          <template v-else-if="column.key === 'amount'"
            >¥{{ Number(row.amount ?? 0).toLocaleString('zh-CN') }}</template
          >
          <template v-else-if="column.key === 'customerId'">{{ row.customerName ?? '-' }}</template>
          <template v-else-if="column.key === 'contractId'">{{ row.contractName ?? '-' }}</template>
          <template v-else-if="column.key === 'owner'">{{ row.ownerName ?? '-' }}</template>
          <template v-else-if="column.key === 'stage'">{{ row.stageName ?? row.stage }}</template>
          <template v-else>
            {{
              formatFieldValue(column, displayRow(row as OrderVO), {
                memberMap: fieldRefs.memberMap.value,
                deptMap: fieldRefs.deptMap.value,
              })
            }}
          </template>
        </template>
      </el-table-column>
      <el-table-column label="审批状态" width="110">
        <template #default="{ row }">
          <el-popover trigger="click" width="340" @show="loadApprovalSummary(row.id)">
            <template #reference>
              <el-tag
                :type="approvalTagType(row.approvalStatus)"
                size="small"
                class="cursor-pointer"
              >
                {{ approvalLabels[row.approvalStatus] ?? row.approvalStatus }}
              </el-tag>
            </template>
            <pre class="whitespace-pre-wrap break-all text-xs">{{
              JSON.stringify(
                approvalSummaries[row.id] ?? { approveStatus: row.approvalStatus },
                null,
                2,
              )
            }}</pre>
          </el-popover>
        </template>
      </el-table-column>
      <el-table-column v-if="standalone" label="阶段" width="140">
        <template #default="{ row }">
          <el-select
            :model-value="row.stage"
            size="small"
            :disabled="row.approvalStatus === 'APPROVING'"
            @change="(value: string) => moveStage(row as OrderVO, value)"
          >
            <el-option
              v-for="stage in stages"
              :key="stage.id"
              :label="stage.name"
              :value="stage.id"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row as OrderVO)">详情</el-button>
          <el-button
            v-if="standalone && auth.hasPerm('ORDER:UPDATE') && row.approvalStatus !== 'APPROVING'"
            link
            @click="openEdit(row as OrderVO)"
            >编辑</el-button
          >
          <el-button
            v-if="
              standalone &&
              auth.hasPerm('ORDER:UPDATE') &&
              ['NONE', 'UNAPPROVED', 'REVOKED'].includes(row.approvalStatus)
            "
            link
            type="success"
            @click="review(row as OrderVO)"
            >提交审批</el-button
          >
          <el-button
            v-if="standalone && auth.hasPerm('ORDER:UPDATE') && row.approvalStatus === 'APPROVING'"
            link
            @click="revoke(row as OrderVO)"
            >撤回</el-button
          >
          <el-button
            v-if="standalone && auth.hasPerm('ORDER:DELETE')"
            link
            type="danger"
            @click="removeOrder(row as OrderVO)"
            >删除</el-button
          >
        </template>
      </el-table-column>
    </el-table>

    <div
      v-else
      v-loading="loading"
      class="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-3 items-start overflow-x-auto"
    >
      <section
        v-for="stage in stages"
        :key="stage.id"
        class="rounded border border-[var(--el-border-color)] bg-[var(--el-fill-color-lighter)] min-h-32"
        @dragover.prevent
        @drop="dropToStage(stage, $event)"
      >
        <div class="flex-between px-3 py-2 border-b border-[var(--el-border-color)]">
          <strong>{{ stage.name }}</strong>
          <span class="text-xs text-[var(--el-text-color-secondary)]">{{
            boardRows.get(stage.id)?.length ?? 0
          }}</span>
        </div>
        <div class="p-2 space-y-2">
          <article
            v-for="row in boardRows.get(stage.id) ?? []"
            :key="row.id"
            draggable="true"
            class="rounded bg-[var(--el-bg-color)] border border-[var(--el-border-color-lighter)] p-3 cursor-move"
            @dragstart="startDrag(row, $event)"
          >
            <el-button link type="primary" class="!p-0" @click="openDetail(row)">{{
              row.name
            }}</el-button>
            <div class="text-sm mt-2">{{ row.customerName ?? '-' }}</div>
            <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
              {{ row.contractName ?? '未关联合同' }}
            </div>
            <div class="flex-between text-xs text-[var(--el-text-color-secondary)] mt-2">
              <span>{{ row.ownerName ?? '-' }}</span>
              <span>¥{{ Number(row.amount ?? 0).toLocaleString('zh-CN') }}</span>
            </div>
          </article>
        </div>
      </section>
    </div>

    <div v-if="displayMode === 'table' || !standalone" class="flex justify-end mt-4">
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
  </div>

  <el-drawer
    v-model="formVisible"
    :title="editingId ? '编辑订单' : '新建订单'"
    size="800px"
    destroy-on-close
  >
    <el-form label-position="top">
      <el-form-item label="订单名称" required>
        <el-input v-model="orderName" maxlength="255" show-word-limit />
      </el-form-item>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="客户" required>
          <el-select
            v-model="formCustomerId"
            filterable
            class="w-full"
            :disabled="Boolean(props.customerId)"
            @change="onCustomerChange"
          >
            <el-option
              v-for="item in customers"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="合同">
          <el-select
            v-model="formContractId"
            clearable
            filterable
            class="w-full"
            :disabled="Boolean(props.contractId)"
          >
            <el-option
              v-for="item in filteredContracts"
              :key="item.id"
              :label="`${item.number} ${item.name}`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <el-form-item label="负责人" required>
          <el-select v-model="ownerId" filterable class="w-full">
            <el-option
              v-for="member in fieldRefs.members.value"
              :key="member.id"
              :label="member.name"
              :value="member.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="订单编号">
          <el-input v-model="orderNumber" placeholder="留空由系统自动生成" />
        </el-form-item>
      </div>
      <DynamicForm
        ref="formRef"
        v-model="formModel"
        :fields="dynamicFields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <el-form-item label="订单金额">
        <el-input-number
          v-model="orderAmount"
          :min="0"
          :max="9999999999"
          :precision="2"
          :controls="false"
          class="!w-full"
        />
      </el-form-item>
    </el-form>

    <div class="flex-between mb-2">
      <div class="font-medium">产品信息</div>
      <el-button type="primary" plain @click="addProductRow">添加产品</el-button>
    </div>
    <el-table :data="orderProducts" border>
      <el-table-column label="产品" min-width="180">
        <template #default="{ row }">
          <el-select
            v-model="row.product"
            filterable
            class="w-full"
            @change="onProductChange(row as OrderProductEdit)"
          >
            <el-option
              v-for="item in products"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </template>
      </el-table-column>
      <el-table-column label="单价" width="140">
        <template #default="{ row }">
          <el-input-number
            v-model="row.productPrice"
            :min="0"
            :precision="2"
            :controls="false"
            class="!w-full"
            @change="updateProductAmount(row as OrderProductEdit)"
          />
        </template>
      </el-table-column>
      <el-table-column label="数量" width="120">
        <template #default="{ row }">
          <el-input-number
            v-model="row.productNumber"
            :min="0"
            :precision="2"
            :controls="false"
            class="!w-full"
            @change="updateProductAmount(row as OrderProductEdit)"
          />
        </template>
      </el-table-column>
      <el-table-column label="金额" width="130">
        <template #default="{ row }"
          >¥{{ Number(row.amount ?? 0).toLocaleString('zh-CN') }}</template
        >
      </el-table-column>
      <el-table-column width="60">
        <template #default="{ $index }">
          <el-button link type="danger" @click="orderProducts.splice($index, 1)">删</el-button>
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="formVisible = false">取消</el-button>
      <el-button type="primary" :loading="formSaving" @click="saveOrder">保存</el-button>
    </template>
  </el-drawer>

  <el-drawer
    v-model="detailVisible"
    :title="detail ? `${detail.name}（${detail.number}）` : '订单详情'"
    size="780px"
    destroy-on-close
  >
    <div v-loading="detailLoading">
      <template v-if="detail">
        <div class="flex items-center gap-2 mb-4">
          <el-tag :type="approvalTagType(detail.approvalStatus)">{{
            approvalLabels[detail.approvalStatus] ?? detail.approvalStatus
          }}</el-tag>
          <el-tag v-if="detail.approved" type="success">历史已通过</el-tag>
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="订单名称">{{ detail.name }}</el-descriptions-item>
          <el-descriptions-item label="阶段">{{
            detail.stageName ?? detail.stage
          }}</el-descriptions-item>
          <el-descriptions-item label="客户">{{
            detail.customerName ?? detail.customerId ?? '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="合同">{{
            detail.contractName ?? detail.contractId ?? '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="负责人">{{
            detail.ownerName ?? detail.owner ?? '-'
          }}</el-descriptions-item>
          <el-descriptions-item label="订单金额"
            >¥{{ Number(detail.amount ?? 0).toLocaleString('zh-CN') }}</el-descriptions-item
          >
          <el-descriptions-item label="创建时间">{{
            new Date(detail.createTime).toLocaleString('zh-CN')
          }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{
            new Date(detail.updateTime).toLocaleString('zh-CN')
          }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="detail.products" size="small" class="mt-4">
          <el-table-column prop="productName" label="产品" min-width="180" />
          <el-table-column label="单价" width="120"
            ><template #default="{ row }"
              >¥{{ Number(row.productPrice).toLocaleString('zh-CN') }}</template
            ></el-table-column
          >
          <el-table-column prop="productNumber" label="数量" width="90" />
          <el-table-column label="金额" width="120"
            ><template #default="{ row }"
              >¥{{ Number(row.amount).toLocaleString('zh-CN') }}</template
            ></el-table-column
          >
        </el-table>
        <el-collapse class="mt-4">
          <el-collapse-item title="审批详情" name="approval">
            <pre class="whitespace-pre-wrap break-all text-xs">{{
              JSON.stringify(detailApproval, null, 2)
            }}</pre>
          </el-collapse-item>
          <el-collapse-item title="订单冻结快照" name="snapshot">
            <pre class="whitespace-pre-wrap break-all text-xs">{{
              JSON.stringify(detailSnapshot, null, 2)
            }}</pre>
          </el-collapse-item>
          <el-collapse-item title="表单配置快照" name="form-snapshot">
            <pre class="whitespace-pre-wrap break-all text-xs">{{
              JSON.stringify(detailSnapshotForm, null, 2)
            }}</pre>
          </el-collapse-item>
        </el-collapse>
      </template>
    </div>
    <template v-if="detail && standalone" #footer>
      <el-button
        v-if="auth.hasPerm('ORDER:UPDATE') && detail.approvalStatus !== 'APPROVING'"
        @click="openEdit(detail)"
        >编辑</el-button
      >
      <el-button
        v-if="
          auth.hasPerm('ORDER:UPDATE') &&
          ['NONE', 'UNAPPROVED', 'REVOKED'].includes(detail.approvalStatus)
        "
        type="primary"
        @click="review(detail)"
        >提交审批</el-button
      >
      <el-button
        v-if="auth.hasPerm('ORDER:UPDATE') && detail.approvalStatus === 'APPROVING'"
        @click="revoke(detail)"
        >撤回</el-button
      >
      <el-button
        v-if="auth.hasPerm('ORDER:DELETE')"
        type="danger"
        plain
        @click="removeOrder(detail)"
        >删除</el-button
      >
    </template>
  </el-drawer>

  <BatchFieldEditDialog
    v-if="standalone"
    v-model="batchEditVisible"
    title="批量修改订单"
    :fields="fields"
    :members="fieldRefs.members.value"
    :dept-tree="fieldRefs.deptTree.value"
    :selected-count="selectedIds.length"
    @confirm="submitBatchEdit"
  />
  <CrmImportDialog
    v-if="standalone"
    v-model="importVisible"
    module-label="订单"
    :download-template="orderApi.downloadTemplate"
    :precheck="orderApi.precheckImport"
    :execute="orderApi.importXlsx"
    @success="loadData"
  />
  <CrmExportDrawer
    v-if="standalone"
    v-model="exportVisible"
    module-label="订单"
    cache-key="w365-order"
    :fields="fields"
    :display-fields="[
      { key: 'customerName', label: '客户名称' },
      { key: 'contractName', label: '合同名称' },
      { key: 'ownerName', label: '负责人名称' },
      { key: 'stageName', label: '订单状态' },
      { key: 'approvalStatus', label: '审批状态' },
      { key: 'approved', label: '历史审批通过' },
      { key: 'orderProduct', label: '产品名称' },
      { key: 'orderProductPrice', label: '产品单价' },
      { key: 'orderProductNumber', label: '产品数量' },
      { key: 'orderProductAmount', label: '产品金额' },
      { key: 'createTime', label: '创建时间' },
      { key: 'updateTime', label: '更新时间' },
    ]"
    :mode="exportMode"
    :selected-count="selectedIds.length"
    :loading="exportLoading"
    @confirm="submitExport"
  />
</template>
