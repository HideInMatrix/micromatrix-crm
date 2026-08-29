<script setup lang="ts">
import type {
  FieldVO,
  FilterCondition,
  ProductPriceVO,
  ProductVO,
  QuoteVO,
  QuotationProductVO,
} from '@micromatrix/shared'
import { QUOTATION_APPROVAL_STATUS_LABELS } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { productApi, productPriceApi, quoteApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { opportunityApi } from '@/api/sales'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

type ProductEdit = {
  rowId?: string
  bizId?: string
  product: string
  priceId?: string
  productAmount?: number
  discount?: number
  tax?: number
  amount?: number
  values?: Record<string, unknown>
}

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const fieldRefs = useFieldRefs()

const fields = ref<FieldVO[]>([])
const formConfig = ref<Record<string, unknown>>({})
const rows = ref<QuoteVO[]>([])
const total = ref(0)
const loading = ref(false)
const filters = ref<FilterCondition[]>([])
const activeViewId = ref<string>()
const selectedIds = ref<string[]>([])
const visibleColumnKeys = ref<string[]>([])
const query = reactive({ current: 1, pageSize: 10, keyword: '' })

const opportunityOptions = ref<Array<{ id: string; name: string }>>([])
const productOptions = ref<ProductVO[]>([])
const priceOptions = ref<ProductPriceVO[]>([])

const formVisible = ref(false)
const formSaving = ref(false)
const formRef = ref<InstanceType<typeof DynamicForm>>()
const editingId = ref<string | null>(null)
const formModel = ref<Record<string, unknown>>({})
const quotationName = ref('')
const opportunityId = ref('')
const untilTime = ref<number>()
const quotationAmount = ref(0)
const quotationProducts = ref<ProductEdit[]>([])

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<QuoteVO | null>(null)
const detailSnapshot = ref<Record<string, unknown> | null>(null)

const batchEditVisible = ref(false)
const batchApprovalVisible = ref(false)
const batchApprovalStatus = ref<'APPROVED' | 'UNAPPROVED'>('APPROVED')
const batchLoading = ref(false)

const listFields = computed(() => fields.value.filter((field) => field.showInList && !field.hidden))
const defaultColumnKeys = computed(() => listFields.value.map((field) => field.key))
const visibleColumns = computed(() => {
  const keys = visibleColumnKeys.value.length ? visibleColumnKeys.value : defaultColumnKeys.value
  const order = new Map(keys.map((key, index) => [key, index]))
  return listFields.value
    .filter((field) => order.has(field.key))
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
})
const dynamicFields = computed(() =>
  fields.value.filter(
    (field) => !field.system && !field.hidden && field.type !== 'formula',
  ),
)
const productMap = computed(() => new Map(productOptions.value.map((item) => [item.id, item])))
const priceMap = computed(() => new Map(priceOptions.value.map((item) => [item.id, item])))

function asQuote(row: unknown) {
  return row as QuoteVO
}

function asProductEdit(row: unknown) {
  return row as ProductEdit
}

function dynamicValues(row: QuoteVO) {
  const valueById = new Map(row.moduleFields.map((item) => [item.fieldId, item.fieldValue]))
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, valueById.get(field.id)]))
}

function displayRow(row: QuoteVO) {
  return { ...row, ...dynamicValues(row) }
}

function defaultDynamicModel() {
  return Object.fromEntries(dynamicFields.value.map((field) => [field.key, field.config?.defaultValue]))
}

function moduleFieldsPayload() {
  return dynamicFields.value.map((field) => ({ fieldId: field.id, fieldValue: formModel.value[field.key] }))
}

function toEditProduct(row: QuotationProductVO): ProductEdit {
  return {
    rowId: row.rowId,
    bizId: row.bizId,
    product: row.productId,
    priceId: row.priceId ?? undefined,
    productAmount: row.productAmount,
    discount: row.discount,
    tax: row.tax,
    amount: row.amount,
    values: row.values,
  }
}

function productPayload(row: ProductEdit) {
  return {
    ...(row.rowId ? { rowId: row.rowId } : {}),
    ...(row.bizId ? { bizId: row.bizId } : {}),
    product: row.product,
    ...(row.priceId ? { priceId: row.priceId } : {}),
    ...(row.productAmount === undefined ? {} : { productAmount: row.productAmount }),
    ...(row.discount === undefined ? {} : { discount: row.discount }),
    ...(row.tax === undefined ? {} : { tax: row.tax }),
    ...(row.amount === undefined ? {} : { amount: row.amount }),
    ...(row.values ? { values: row.values } : {}),
  }
}

function approvalTagType(status: QuoteVO['approvalStatus']) {
  if (status === 'APPROVED') return 'success'
  if (status === 'APPROVING') return 'warning'
  if (status === 'UNAPPROVED') return 'danger'
  return 'info'
}

async function loadMeta() {
  const [{ data: config }, { data: productPage }, { data: pricePage }] = await Promise.all([
    quoteApi.moduleForm(),
    productApi.page({ current: 1, pageSize: 500, status: '1' }),
    productPriceApi.page({ current: 1, pageSize: 500, status: '1' }),
  ])
  formConfig.value = config as unknown as Record<string, unknown>
  fields.value = (config.fields ?? []) as FieldVO[]
  productOptions.value = productPage.list
  priceOptions.value = pricePage.list
  visibleColumnKeys.value = defaultColumnKeys.value
}

async function loadOpportunities(keyword = '') {
  try {
    const { data } = await opportunityApi.list({ page: 1, pageSize: 50, keyword: keyword || undefined })
    opportunityOptions.value = data.items.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await quoteApi.page({
      current: query.current,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      viewId: activeViewId.value,
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

function openCreate(linkedOpportunity?: { id: string; name: string }) {
  editingId.value = null
  formModel.value = defaultDynamicModel()
  quotationName.value = linkedOpportunity ? `${linkedOpportunity.name}-报价` : ''
  opportunityId.value = linkedOpportunity?.id ?? ''
  untilTime.value = undefined
  quotationAmount.value = 0
  quotationProducts.value = []
  if (linkedOpportunity) {
    opportunityOptions.value = [
      linkedOpportunity,
      ...opportunityOptions.value.filter((item) => item.id !== linkedOpportunity.id),
    ]
  }
  formVisible.value = true
}

async function openFromOpportunity(id: string) {
  try {
    const { data } = await opportunityApi.get(id)
    openCreate({ id: data.id, name: data.name })
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function openEdit(row: QuoteVO) {
  try {
    const { data } = await quoteApi.detail(row.id)
    editingId.value = data.id
    formModel.value = { ...defaultDynamicModel(), ...dynamicValues(data) }
    quotationName.value = data.name
    opportunityId.value = data.opportunityId
    untilTime.value = data.untilTime
    quotationAmount.value = data.amount
    quotationProducts.value = data.products.map(toEditProduct)
    opportunityOptions.value = [
      { id: data.opportunityId, name: data.opportunityName ?? data.opportunityId },
      ...opportunityOptions.value.filter((item) => item.id !== data.opportunityId),
    ]
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function addProductRow() {
  quotationProducts.value.push({ product: '' })
}

function onProductChange(row: ProductEdit) {
  const product = productMap.value.get(row.product)
  if (row.productAmount === undefined && product?.price !== null && product?.price !== undefined) {
    row.productAmount = product.price
  }
  if (row.priceId) onPriceChange(row)
}

function onPriceChange(row: ProductEdit) {
  const matched = row.priceId
    ? priceMap.value.get(row.priceId)?.products.find((item) => item.productId === row.product)
    : undefined
  if (matched) row.productAmount = matched.amount
}

async function saveQuote() {
  const name = quotationName.value.trim()
  if (!name) return void ElMessage.warning('请输入报价名称')
  if (!opportunityId.value) return void ElMessage.warning('请选择商机')
  if (!untilTime.value) return void ElMessage.warning('请选择有效期')
  if (!quotationProducts.value.length || quotationProducts.value.some((item) => !item.product)) {
    return void ElMessage.warning('请至少添加一个完整的报价产品')
  }
  if (!(await formRef.value?.validate())) return
  formSaving.value = true
  try {
    const payload = {
      ...(editingId.value ? { id: editingId.value } : {}),
      name,
      opportunityId: opportunityId.value,
      untilTime: untilTime.value,
      amount: Number(quotationAmount.value || 0),
      moduleFields: moduleFieldsPayload(),
      moduleFormConfigDTO: formConfig.value,
      products: quotationProducts.value.map(productPayload),
    }
    if (editingId.value) await quoteApi.update(payload)
    else await quoteApi.create(payload)
    ElMessage.success(editingId.value ? '报价已更新' : '报价已创建')
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
    const [{ data }, { data: snapshot }] = await Promise.all([quoteApi.detail(id), quoteApi.snapshot(id)])
    detail.value = data
    detailSnapshot.value = snapshot
  } catch (error) {
    detailVisible.value = false
    ElMessage.error(extractErrorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

async function refreshAfterAction(id?: string) {
  await loadData()
  if (id && detailVisible.value && detail.value?.id === id) await openDetail(id)
}

async function handleVoid(row: QuoteVO) {
  if (!(await ElMessageBox.confirm(`确认作废报价「${row.name}」吗？作废后不可恢复。`, '作废报价', { type: 'warning' }).catch(() => false))) return
  try {
    await quoteApi.void(row.id)
    ElMessage.success('报价已作废')
    await refreshAfterAction(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleRevoke(row: QuoteVO) {
  if (!(await ElMessageBox.confirm(`撤回报价「${row.name}」当前审批？`, '撤回审批').catch(() => false))) return
  try {
    await quoteApi.revoke(row.id)
    ElMessage.success('审批已撤回')
    await refreshAfterAction(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleApproval(row: QuoteVO, approvalStatus: 'APPROVED' | 'UNAPPROVED') {
  try {
    await quoteApi.approve({ id: row.id, approvalStatus })
    ElMessage.success(approvalStatus === 'APPROVED' ? '审批已通过' : '审批已驳回')
    await refreshAfterAction(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: QuoteVO) {
  if (!(await ElMessageBox.confirm(`确认删除报价「${row.name}」吗？配置删除审批时会先提交审批。`, '删除报价', { type: 'warning' }).catch(() => false))) return
  try {
    const { data } = await quoteApi.remove(row.id)
    ElMessage.success(data.pendingApproval ? '已提交删除审批' : '报价已删除')
    if (!data.pendingApproval && detail.value?.id === row.id) detailVisible.value = false
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function batchVoid() {
  if (!(await ElMessageBox.confirm(`确认作废选中的 ${selectedIds.value.length} 个报价吗？`, '批量作废', { type: 'warning' }).catch(() => false))) return
  try {
    const { data } = await quoteApi.batchVoid(selectedIds.value)
    ElMessage.success(`批量作废：成功 ${data.success}，跳过 ${data.skip}，失败 ${data.fail}`)
    selectedIds.value = []
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function batchApprove() {
  batchLoading.value = true
  try {
    const { data } = await quoteApi.batchApprove({ ids: selectedIds.value, approvalStatus: batchApprovalStatus.value })
    ElMessage.success(`批量审批：成功 ${data.success}，跳过 ${data.skip}，失败 ${data.fail}`)
    batchApprovalVisible.value = false
    selectedIds.value = []
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    batchLoading.value = false
  }
}

async function submitBatchEdit(payload: { fieldId: string; fieldValue: unknown }) {
  try {
    await quoteApi.batchUpdate({ ids: selectedIds.value, ...payload })
    batchEditVisible.value = false
    selectedIds.value = []
    ElMessage.success('批量修改成功')
    await loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function exportPdf(row: QuoteVO) {
  try {
    const [{ data: snapshot }] = await Promise.all([quoteApi.snapshot(row.id), quoteApi.download(row.id)])
    const snapshotProducts = Array.isArray(snapshot.products) ? (snapshot.products as Array<Record<string, unknown>>) : []
    const printWindow = window.open('', '_blank', 'noopener,noreferrer')
    if (!printWindow) return void ElMessage.warning('浏览器阻止了打印窗口，请允许弹窗后重试')
    const productHtml = snapshotProducts
      .map((item) => `<tr><td>${escapeHtml(item.productName ?? item.productId ?? item.product)}</td><td>${escapeHtml(item.priceName ?? item.priceId)}</td><td>${escapeHtml(item.productAmount)}</td><td>${escapeHtml(item.discount)}</td><td>${escapeHtml(item.tax)}</td><td>${escapeHtml(item.amount)}</td></tr>`)
      .join('')
    const scriptEnd = '</scr' + 'ipt>'
    printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(row.name)}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px;color:#1f2329}h1{font-size:24px}.meta{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:24px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px}th{background:#f5f7fa}@media print{body{padding:0}}</style></head><body><h1>${escapeHtml(row.name)}</h1><div class="meta"><div>商机：${escapeHtml(row.opportunityName)}</div><div>有效期：${new Date(row.untilTime).toLocaleDateString('zh-CN')}</div><div>累计金额：¥${row.amount.toLocaleString('zh-CN')}</div><div>审批状态：${escapeHtml(QUOTATION_APPROVAL_STATUS_LABELS[row.approvalStatus])}</div></div><table><thead><tr><th>产品</th><th>价格表</th><th>产品定价</th><th>折扣</th><th>税点</th><th>金额</th></tr></thead><tbody>${productHtml}</tbody></table><script>window.addEventListener('load',()=>window.print())${scriptEnd}</body></html>`)
    printWindow.document.close()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function toOpportunity(row: QuoteVO) {
  router.push({ path: '/opportunities', query: { id: row.opportunityId } })
}

function toContract(row: QuoteVO) {
  router.push({ path: '/contracts', query: { fromQuote: row.id } })
}

function onSavedViewChange(viewId?: string) {
  activeViewId.value = viewId
  query.current = 1
  loadData()
}

watch(
  () => route.query.id,
  (value) => {
    const id = typeof value === 'string' ? value : ''
    if (id) openDetail(id)
  },
  { immediate: true },
)

watch(
  () => route.query.fromOpportunity,
  (value) => {
    const id = typeof value === 'string' ? value : ''
    if (id) void openFromOpportunity(id)
  },
  { immediate: true },
)

onMounted(async () => {
  await Promise.all([loadMeta(), fieldRefs.load(), loadOpportunities()])
  await loadData()
})
</script>

<template>
  <el-card shadow="never">
    <SavedViewBar
      module="quote"
      :fields="fields"
      :members="fieldRefs.members.value"
      :dept-tree="fieldRefs.deptTree.value"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      @change="onSavedViewChange"
      @clear-filters="((filters = []), (query.current = 1), loadData())"
      @columns-change="(keys) => (visibleColumnKeys = keys)"
    />

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex items-center gap-2">
        <el-input v-model="query.keyword" placeholder="通过报价名称 / 商机名称搜索" clearable class="!w-64" @keyup.enter="((query.current = 1), loadData())" @clear="((query.current = 1), loadData())" />
        <AdvancedFilter :fields="fields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" @apply="(conditions) => ((filters = conditions), (query.current = 1), loadData())" />
      </div>
      <div class="flex items-center gap-2">
        <template v-if="selectedIds.length">
          <el-button @click="batchEditVisible = true">批量修改</el-button>
          <el-button @click="batchApprovalVisible = true">批量审批</el-button>
          <el-button type="warning" plain @click="batchVoid">批量作废</el-button>
        </template>
        <el-button v-if="auth.hasPerm('quote:create')" type="primary" @click="openCreate()">新建报价</el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="rows" stripe class="w-full" @selection-change="(selected: QuoteVO[]) => (selectedIds = selected.map((row) => row.id))">
      <el-table-column type="selection" width="48" />
      <el-table-column v-for="column in visibleColumns" :key="column.key" :label="column.label" :min-width="column.listWidth ?? 140" show-overflow-tooltip>
        <template #default="{ row }">
          <el-button v-if="column.key === 'name'" link type="primary" @click="openDetail(row.id)">{{ row.name }}</el-button>
          <el-button v-else-if="column.key === 'opportunityId'" link type="primary" @click="toOpportunity(asQuote(row))">{{ row.opportunityName || row.opportunityId }}</el-button>
          <template v-else-if="column.key === 'amount'">¥{{ Number(row.amount).toLocaleString('zh-CN') }}</template>
          <template v-else-if="column.key === 'untilTime'">{{ new Date(row.untilTime).toLocaleDateString('zh-CN') }}</template>
          <template v-else>{{ formatFieldValue(column, displayRow(asQuote(row)), { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
        </template>
      </el-table-column>
      <el-table-column label="审批状态" width="120"><template #default="{ row }"><el-tag :type="approvalTagType(row.approvalStatus)" size="small">{{ QUOTATION_APPROVAL_STATUS_LABELS[row.approvalStatus as QuoteVO['approvalStatus']] }}</el-tag></template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><el-tag :type="row.invalid ? 'info' : 'success'" size="small">{{ row.invalid ? '已作废' : '正常' }}</el-tag></template></el-table-column>
      <el-table-column label="操作" width="320" fixed="right">
        <template #default="{ row }">
          <template v-if="!row.invalid">
            <el-button v-if="row.approvalStatus !== 'APPROVING'" link type="primary" @click="openEdit(asQuote(row))">编辑</el-button>
            <el-button v-if="row.approvalStatus === 'APPROVING'" link type="success" @click="handleApproval(asQuote(row), 'APPROVED')">通过</el-button>
            <el-button v-if="row.approvalStatus === 'APPROVING'" link type="danger" @click="handleApproval(asQuote(row), 'UNAPPROVED')">驳回</el-button>
            <el-button v-if="row.approvalStatus === 'APPROVING' && row.createUser === auth.user?.id" link @click="handleRevoke(asQuote(row))">撤回</el-button>
            <el-button link @click="handleVoid(asQuote(row))">作废</el-button>
          </template>
          <el-button link @click="exportPdf(asQuote(row))">导出 PDF</el-button>
          <el-button v-if="row.approved && !row.invalid" link type="primary" @click="toContract(asQuote(row))">创建合同</el-button>
          <el-button v-if="auth.hasPerm('quote:delete')" link type="danger" @click="handleDelete(asQuote(row))">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4"><el-pagination v-model:current-page="query.current" v-model:page-size="query.pageSize" :total="total" layout="total, sizes, prev, pager, next" @current-change="loadData" @size-change="((query.current = 1), loadData())" /></div>
  </el-card>

  <el-drawer v-model="formVisible" :title="editingId ? '编辑报价' : '新建报价'" size="760px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="报价名称" required><el-input v-model="quotationName" maxlength="255" show-word-limit /></el-form-item>
      <el-form-item label="商机" required>
        <el-select v-model="opportunityId" filterable remote :remote-method="loadOpportunities" class="w-full" placeholder="搜索并选择商机"><el-option v-for="item in opportunityOptions" :key="item.id" :label="item.name" :value="item.id" /></el-select>
      </el-form-item>
      <el-form-item label="有效期至" required><el-date-picker v-model="untilTime" type="date" value-format="x" class="!w-full" /></el-form-item>
      <DynamicForm ref="formRef" v-model="formModel" :fields="dynamicFields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" />
      <el-form-item label="累计金额" required>
        <el-input-number v-model="quotationAmount" :min="0" :precision="2" :controls="false" class="!w-full" />
        <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">当前 Cordys 源码未提供固定行金额公式，前端不硬编码推导公式。</div>
      </el-form-item>
    </el-form>

    <div class="flex-between mb-2"><div class="font-medium">产品信息</div><el-button type="primary" plain @click="addProductRow">添加产品</el-button></div>
    <el-table :data="quotationProducts" border>
      <el-table-column label="产品" min-width="160"><template #default="{ row }"><el-select v-model="row.product" filterable class="w-full" @change="onProductChange(asProductEdit(row))"><el-option v-for="item in productOptions" :key="item.id" :label="item.name" :value="item.id" /></el-select></template></el-table-column>
      <el-table-column label="价格表" min-width="150"><template #default="{ row }"><el-select v-model="row.priceId" clearable filterable class="w-full" @change="onPriceChange(asProductEdit(row))"><el-option v-for="item in priceOptions" :key="item.id" :label="item.name" :value="item.id" /></el-select></template></el-table-column>
      <el-table-column label="产品定价" width="125"><template #default="{ row }"><el-input-number v-model="row.productAmount" :min="0" :precision="2" :controls="false" class="!w-full" /></template></el-table-column>
      <el-table-column label="折扣" width="110"><template #default="{ row }"><el-input-number v-model="row.discount" :precision="2" :controls="false" class="!w-full" /></template></el-table-column>
      <el-table-column label="税点" width="110"><template #default="{ row }"><el-input-number v-model="row.tax" :precision="2" :controls="false" class="!w-full" /></template></el-table-column>
      <el-table-column label="金额" width="125"><template #default="{ row }"><el-input-number v-model="row.amount" :min="0" :precision="2" :controls="false" class="!w-full" /></template></el-table-column>
      <el-table-column width="60"><template #default="{ $index }"><el-button link type="danger" @click="quotationProducts.splice($index, 1)">删</el-button></template></el-table-column>
    </el-table>
    <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="formSaving" @click="saveQuote">保存</el-button></template>
  </el-drawer>

  <el-drawer v-model="detailVisible" :title="detail?.name || '报价详情'" size="760px">
    <div v-loading="detailLoading">
      <template v-if="detail">
        <div class="flex items-center gap-2 mb-4"><el-tag :type="approvalTagType(detail.approvalStatus)">{{ QUOTATION_APPROVAL_STATUS_LABELS[detail.approvalStatus] }}</el-tag><el-tag :type="detail.invalid ? 'info' : 'success'">{{ detail.invalid ? '已作废' : '正常' }}</el-tag></div>
        <el-descriptions :column="2" border>
          <el-descriptions-item label="报价名称">{{ detail.name }}</el-descriptions-item>
          <el-descriptions-item label="商机"><el-button link type="primary" @click="toOpportunity(detail)">{{ detail.opportunityName }}</el-button></el-descriptions-item>
          <el-descriptions-item label="有效期至">{{ new Date(detail.untilTime).toLocaleDateString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item label="累计金额">¥{{ detail.amount.toLocaleString('zh-CN') }}</el-descriptions-item>
          <el-descriptions-item v-for="field in dynamicFields" :key="field.id" :label="field.label">{{ formatFieldValue(field, displayRow(detail), { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</el-descriptions-item>
        </el-descriptions>
        <div class="font-medium my-4">产品信息</div>
        <el-table :data="detail.products" border><el-table-column prop="productName" label="产品" min-width="150" /><el-table-column prop="priceName" label="价格表" min-width="140" /><el-table-column prop="productAmount" label="产品定价" width="110" /><el-table-column prop="discount" label="折扣" width="90" /><el-table-column prop="tax" label="税点" width="90" /><el-table-column prop="amount" label="金额" width="110" /></el-table>
        <el-collapse class="mt-4"><el-collapse-item title="审批冻结快照" name="snapshot"><pre class="whitespace-pre-wrap break-all text-xs">{{ JSON.stringify(detailSnapshot, null, 2) }}</pre></el-collapse-item></el-collapse>
      </template>
    </div>
    <template v-if="detail" #footer><el-button @click="exportPdf(detail)">导出 PDF</el-button><el-button v-if="detail.approved && !detail.invalid" type="primary" plain @click="toContract(detail)">创建合同</el-button><el-button v-if="!detail.invalid && detail.approvalStatus !== 'APPROVING'" type="primary" @click="openEdit(detail)">编辑</el-button></template>
  </el-drawer>

  <BatchFieldEditDialog v-model="batchEditVisible" title="批量修改报价" :fields="fields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" :selected-count="selectedIds.length" @confirm="submitBatchEdit" />
  <el-dialog v-model="batchApprovalVisible" title="批量审批" width="420px"><el-form label-position="top"><el-form-item label="审批结果" required><el-radio-group v-model="batchApprovalStatus"><el-radio value="APPROVED">通过</el-radio><el-radio value="UNAPPROVED">驳回</el-radio></el-radio-group></el-form-item></el-form><template #footer><el-button @click="batchApprovalVisible = false">取消</el-button><el-button type="primary" :loading="batchLoading" @click="batchApprove">确认</el-button></template></el-dialog>
</template>
