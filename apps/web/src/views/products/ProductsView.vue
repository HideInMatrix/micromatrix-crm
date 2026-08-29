<script setup lang="ts">
import type { FieldVO, ProductPriceItemVO, ProductPriceVO, ProductVO } from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import draggable from 'vuedraggable'
import { productApi, productPriceApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import PictureFieldInput from '@/components/form-engine/PictureFieldInput.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

type TabKey = 'product' | 'price'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const activeTab = ref<TabKey>('product')
const productFields = ref<FieldVO[]>([])
const priceFields = ref<FieldVO[]>([])
const productOptions = ref<Array<{ id: string; name: string }>>([])

const productItems = ref<ProductVO[]>([])
const productTotal = ref(0)
const productLoading = ref(false)
const productQuery = reactive<{ current: number; pageSize: number; keyword: string; status: '' | '1' | '2' }>({
  current: 1,
  pageSize: 10,
  keyword: '',
  status: '',
})
const selectedProductIds = ref<string[]>([])

const priceItems = ref<ProductPriceVO[]>([])
const priceTotal = ref(0)
const priceLoading = ref(false)
const priceQuery = reactive<{ current: number; pageSize: number; keyword: string; status: '' | '1' | '2' }>({
  current: 1,
  pageSize: 10,
  keyword: '',
  status: '',
})
const selectedPriceIds = ref<string[]>([])

const productDialog = ref(false)
const productEditingId = ref<string | null>(null)
const productSaving = ref(false)
const productForm = ref<Record<string, unknown>>({})
const productFormRef = ref<InstanceType<typeof DynamicForm>>()

const priceDialog = ref(false)
const priceEditingId = ref<string | null>(null)
const priceSaving = ref(false)
const priceForm = ref<Record<string, unknown>>({})
const priceFormRef = ref<InstanceType<typeof DynamicForm>>()
const priceProducts = ref<
  Array<{
    rowId?: string
    bizId?: string
    product: string
    amount: number
    values: { priceProductSku?: string; priceProductTax?: number }
  }>
>([])

const detailVisible = ref(false)
const detailKind = ref<TabKey>('product')
const productDetail = ref<ProductVO | null>(null)
const priceDetail = ref<ProductPriceVO | null>(null)

const productBatchEditVisible = ref(false)
const priceBatchEditVisible = ref(false)
const productImportVisible = ref(false)
const priceImportVisible = ref(false)
const exportVisible = ref(false)
const exportKind = ref<TabKey>('product')
const exportMode = ref<'all' | 'selected'>('all')
const exportLoading = ref(false)

const sortVisible = ref(false)
const sortKind = ref<TabKey>('product')
const sortRows = ref<Array<{ id: string; name: string }>>([])

const productColumns = computed(() => productFields.value.filter((field) => field.showInList && !field.hidden))
const priceColumns = computed(() => priceFields.value.filter((field) => field.showInList && !field.hidden))
const productFormFields = computed(() => productFields.value.filter((field) => !field.hidden && field.type !== 'formula'))
const priceFormFields = computed(() => priceFields.value.filter((field) => !field.hidden && field.type !== 'formula'))
const currentExportFields = computed(() => (exportKind.value === 'product' ? productFields.value : priceFields.value))
const currentExportDisplayFields = computed(() => {
  if (exportKind.value !== 'price') return []
  const order = ['product', 'priceProductSku', 'amount', 'priceProductTax']
  const map = new Map(priceFields.value.map((field) => [field.key, field]))
  return order
    .map((key) => map.get(key))
    .filter((field): field is FieldVO => !!field)
    .map((field) => ({ key: field.key, label: field.label }))
})
const currentSelectedCount = computed(() =>
  exportKind.value === 'product' ? selectedProductIds.value.length : selectedPriceIds.value.length,
)

function defaultModel(fields: FieldVO[]) {
  return Object.fromEntries(
    fields
      .filter((field) => !field.hidden && field.type !== 'formula')
      .map((field) => [field.key, field.config?.defaultValue]),
  )
}

function rowModel(fields: FieldVO[], row: ProductVO | ProductPriceVO) {
  const source = row as unknown as Record<string, unknown>
  return Object.fromEntries(
    fields
      .filter((field) => !field.hidden && field.type !== 'formula')
      .map((field) => [field.key, field.system ? source[field.key] : row.customData[field.key]]),
  )
}

function moduleFields(fields: FieldVO[], model: Record<string, unknown>) {
  return fields
    .filter((field) => !field.system && !field.hidden && field.type !== 'formula')
    .map((field) => ({ fieldId: field.id, fieldValue: model[field.key] }))
}

async function loadProducts() {
  productLoading.value = true
  try {
    const { data } = await productApi.page({
      current: productQuery.current,
      pageSize: productQuery.pageSize,
      keyword: productQuery.keyword.trim() || undefined,
      status: productQuery.status || undefined,
    })
    productItems.value = data.list
    productTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    productLoading.value = false
  }
}

async function loadPrices() {
  priceLoading.value = true
  try {
    const { data } = await productPriceApi.page({
      current: priceQuery.current,
      pageSize: priceQuery.pageSize,
      keyword: priceQuery.keyword.trim() || undefined,
      status: priceQuery.status || undefined,
    })
    priceItems.value = data.list
    priceTotal.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    priceLoading.value = false
  }
}

async function reloadOptions() {
  const { data } = await productApi.options()
  productOptions.value = data
}

function openProductCreate() {
  productEditingId.value = null
  productForm.value = defaultModel(productFields.value)
  productDialog.value = true
}

async function openProductEdit(row: ProductVO) {
  const { data } = await productApi.detail(row.id)
  productEditingId.value = row.id
  productForm.value = rowModel(productFields.value, data)
  productDialog.value = true
}

async function saveProduct() {
  if (!(await productFormRef.value?.validate())) return
  productSaving.value = true
  try {
    const payload = {
      ...(productEditingId.value ? { id: productEditingId.value } : {}),
      name: String(productForm.value.name ?? '').trim(),
      price: productForm.value.price === '' ? undefined : productForm.value.price,
      status: (productForm.value.status ?? '1') as '1' | '2',
      moduleFields: moduleFields(productFields.value, productForm.value),
    }
    if (productEditingId.value) await productApi.update(payload)
    else await productApi.create(payload)
    ElMessage.success(productEditingId.value ? '产品已更新' : '产品已创建')
    productDialog.value = false
    await Promise.all([loadProducts(), reloadOptions()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    productSaving.value = false
  }
}

async function removeProduct(row: ProductVO) {
  if (!(await ElMessageBox.confirm(`确定删除产品「${row.name}」吗？`, '删除确认', { type: 'warning' }).catch(() => false))) return
  try {
    await productApi.remove(row.id)
    ElMessage.success('产品已删除')
    await Promise.all([loadProducts(), reloadOptions()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function batchDeleteProducts() {
  if (!selectedProductIds.value.length) return
  if (!(await ElMessageBox.confirm(`确定删除选中的 ${selectedProductIds.value.length} 个产品吗？`, '批量删除', { type: 'warning' }).catch(() => false))) return
  try {
    await productApi.batchDelete(selectedProductIds.value)
    selectedProductIds.value = []
    ElMessage.success('批量删除成功')
    await Promise.all([loadProducts(), reloadOptions()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openPriceCreate() {
  priceEditingId.value = null
  priceForm.value = defaultModel(priceFields.value)
  priceProducts.value = []
  priceDialog.value = true
}

async function openPriceEdit(row: ProductPriceVO) {
  const { data } = await productPriceApi.detail(row.id)
  priceEditingId.value = row.id
  priceForm.value = rowModel(priceFields.value, data)
  priceProducts.value = data.products.map((item) => ({
    rowId: item.rowId,
    bizId: item.bizId,
    product: item.productId,
    amount: item.amount,
    values: {
      priceProductSku:
        typeof item.values.priceProductSku === 'string' ? item.values.priceProductSku : undefined,
      priceProductTax:
        typeof item.values.priceProductTax === 'number' ? item.values.priceProductTax : undefined,
    },
  }))
  priceDialog.value = true
}

function addPriceProduct() {
  priceProducts.value.push({ product: '', amount: 0, values: {} })
}

async function savePrice() {
  if (!(await priceFormRef.value?.validate())) return
  if (priceProducts.value.some((item) => !item.product)) {
    ElMessage.warning('价格表产品不能为空')
    return
  }
  priceSaving.value = true
  try {
    const payload = {
      ...(priceEditingId.value ? { id: priceEditingId.value } : {}),
      name: String(priceForm.value.name ?? '').trim(),
      status: (priceForm.value.status ?? '1') as '1' | '2',
      moduleFields: moduleFields(priceFields.value, priceForm.value),
      products: priceProducts.value,
    }
    if (priceEditingId.value) await productPriceApi.update(payload)
    else await productPriceApi.create(payload)
    ElMessage.success(priceEditingId.value ? '价格表已更新' : '价格表已创建')
    priceDialog.value = false
    await loadPrices()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    priceSaving.value = false
  }
}

async function copyPrice(row: ProductPriceVO) {
  try {
    await productPriceApi.copy(row.id)
    ElMessage.success('价格表已复制')
    await loadPrices()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removePrice(row: ProductPriceVO) {
  if (!(await ElMessageBox.confirm(`确定删除价格表「${row.name}」吗？`, '删除确认', { type: 'warning' }).catch(() => false))) return
  try {
    await productPriceApi.remove(row.id)
    ElMessage.success('价格表已删除')
    await loadPrices()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function openDetail(kind: TabKey, id: string) {
  detailKind.value = kind
  if (kind === 'product') {
    productDetail.value = (await productApi.detail(id)).data
    priceDetail.value = null
  } else {
    priceDetail.value = (await productPriceApi.detail(id)).data
    productDetail.value = null
  }
  detailVisible.value = true
}

async function submitProductBatch(payload: { fieldId: string; fieldValue: unknown }) {
  try {
    await productApi.batchUpdate({ ids: selectedProductIds.value, ...payload })
    productBatchEditVisible.value = false
    selectedProductIds.value = []
    ElMessage.success('产品批量修改成功')
    await loadProducts()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function submitPriceBatch(payload: { fieldId: string; fieldValue: unknown }) {
  try {
    await productPriceApi.batchUpdate({ ids: selectedPriceIds.value, ...payload })
    priceBatchEditVisible.value = false
    selectedPriceIds.value = []
    ElMessage.success('价格表批量修改成功')
    await loadPrices()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openExport(kind: TabKey, mode: 'all' | 'selected') {
  exportKind.value = kind
  exportMode.value = mode
  exportVisible.value = true
}

async function submitExport(payload: { fileName: string; headList: string[] }) {
  exportLoading.value = true
  try {
    if (exportKind.value === 'product') {
      if (exportMode.value === 'all') {
        await productApi.exportAll({
          current: 1,
          pageSize: 500,
          keyword: productQuery.keyword.trim() || undefined,
          status: productQuery.status || undefined,
          ...payload,
        })
      } else {
        await productApi.exportSelected({ ids: selectedProductIds.value, ...payload })
      }
    } else if (exportMode.value === 'all') {
      await productPriceApi.exportAll({
        current: 1,
        pageSize: 500,
        keyword: priceQuery.keyword.trim() || undefined,
        status: priceQuery.status || undefined,
        ...payload,
      })
    } else {
      await productPriceApi.exportSelected({ ids: selectedPriceIds.value, ...payload })
    }
    exportVisible.value = false
    ElMessage.success('导出任务已创建')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    exportLoading.value = false
  }
}

async function openSort(kind: TabKey) {
  sortKind.value = kind
  if (kind === 'product') {
    const { data } = await productApi.page({ current: 1, pageSize: 500 })
    sortRows.value = data.list.map((item) => ({ id: item.id, name: item.name }))
  } else {
    const { data } = await productPriceApi.page({ current: 1, pageSize: 500 })
    sortRows.value = data.list.map((item) => ({ id: item.id, name: item.name }))
  }
  sortVisible.value = true
}

async function handleSortEnd(event: { oldIndex?: number; newIndex?: number }) {
  const oldIndex = event.oldIndex
  const newIndex = event.newIndex
  if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
  const moved = sortRows.value[newIndex]
  if (!moved) return
  const before = sortRows.value[newIndex - 1]
  const after = sortRows.value[newIndex + 1]
  const payload = before
    ? { dragNodeId: moved.id, dropNodeId: before.id, dropPosition: 1 as const }
    : after
      ? { dragNodeId: moved.id, dropNodeId: after.id, dropPosition: -1 as const }
      : { dragNodeId: moved.id, dropPosition: 1 as const }
  try {
    if (sortKind.value === 'product') {
      await productApi.sort(payload)
      await loadProducts()
    } else {
      await productPriceApi.sort(payload)
      await loadPrices()
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function selectedIds(rows: Array<ProductVO | ProductPriceVO>) {
  return rows.map((row) => row.id)
}

function productName(item: ProductPriceItemVO) {
  return item.productName ?? productOptions.value.find((product) => product.id === item.productId)?.name ?? item.productId
}

onMounted(async () => {
  try {
    const [{ data: pf }, { data: prf }] = await Promise.all([
      metadataApi.fields('product'),
      metadataApi.fields('price'),
      fieldRefs.load(),
    ])
    productFields.value = pf
    priceFields.value = prf
    await Promise.all([loadProducts(), loadPrices(), reloadOptions()])
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
})
</script>

<template>
  <el-card shadow="never" class="product-page-card">
    <el-tabs v-model="activeTab" class="crm-tabs">
      <el-tab-pane label="产品" name="product">
        <div class="flex-between flex-wrap gap-3 mb-4">
          <div class="flex flex-wrap gap-2">
            <el-button v-if="auth.hasPerm('product:create')" type="primary" @click="openProductCreate">新建产品</el-button>
            <el-button v-if="auth.hasPerm('product:import')" @click="productImportVisible = true">导入</el-button>
            <el-button v-if="auth.hasPerm('product:export')" @click="openExport('product', 'all')">导出全部</el-button>
            <el-button v-if="auth.hasPerm('product:update')" @click="openSort('product')">调整排序</el-button>
            <el-button
              v-if="auth.hasPerm('product:update')"
              :disabled="!selectedProductIds.length"
              @click="productBatchEditVisible = true"
            >批量编辑</el-button>
            <el-button
              v-if="auth.hasPerm('product:delete')"
              :disabled="!selectedProductIds.length"
              type="danger"
              plain
              @click="batchDeleteProducts"
            >批量删除</el-button>
            <el-button
              v-if="auth.hasPerm('product:export')"
              :disabled="!selectedProductIds.length"
              @click="openExport('product', 'selected')"
            >导出选中</el-button>
            <ExportTaskButton />
          </div>
          <div class="flex gap-2">
            <el-select v-model="productQuery.status" clearable placeholder="状态" class="!w-28" @change="((productQuery.current = 1), loadProducts())">
              <el-option label="上架" value="1" />
              <el-option label="下架" value="2" />
            </el-select>
            <el-input v-model="productQuery.keyword" clearable placeholder="搜索产品名称" class="!w-60" @keyup.enter="((productQuery.current = 1), loadProducts())" @clear="((productQuery.current = 1), loadProducts())" />
          </div>
        </div>

        <el-table v-loading="productLoading" :data="productItems" row-key="id" @selection-change="(rows) => (selectedProductIds = selectedIds(rows))">
          <el-table-column type="selection" width="44" />
          <el-table-column v-for="column in productColumns" :key="column.key" :label="column.label" :min-width="column.listWidth ?? 140" show-overflow-tooltip>
            <template #default="{ row }">
              <el-button v-if="column.key === 'name'" link type="primary" @click="openDetail('product', row.id)">{{ row.name }}</el-button>
              <template v-else>{{ formatFieldValue(column, row, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="130" fixed="right">
            <template #default="{ row }">
              <el-button v-if="auth.hasPerm('product:update')" link type="primary" @click="openProductEdit(row as ProductVO)">编辑</el-button>
              <el-button v-if="auth.hasPerm('product:delete')" link type="danger" @click="removeProduct(row as ProductVO)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="flex justify-end mt-4">
          <el-pagination v-model:current-page="productQuery.current" v-model:page-size="productQuery.pageSize" :total="productTotal" layout="total, sizes, prev, pager, next" @current-change="loadProducts" @size-change="((productQuery.current = 1), loadProducts())" />
        </div>
      </el-tab-pane>

      <el-tab-pane label="价格表" name="price">
        <div class="flex-between flex-wrap gap-3 mb-4">
          <div class="flex flex-wrap gap-2">
            <el-button v-if="auth.hasPerm('price:add')" type="primary" @click="openPriceCreate">新建价格表</el-button>
            <el-button v-if="auth.hasPerm('price:import')" @click="priceImportVisible = true">导入</el-button>
            <el-button v-if="auth.hasPerm('price:export')" @click="openExport('price', 'all')">导出全部</el-button>
            <el-button v-if="auth.hasPerm('price:update')" @click="openSort('price')">调整排序</el-button>
            <el-button v-if="auth.hasPerm('price:update')" :disabled="!selectedPriceIds.length" @click="priceBatchEditVisible = true">批量编辑</el-button>
            <el-button v-if="auth.hasPerm('price:export')" :disabled="!selectedPriceIds.length" @click="openExport('price', 'selected')">导出选中</el-button>
            <ExportTaskButton />
          </div>
          <div class="flex gap-2">
            <el-select v-model="priceQuery.status" clearable placeholder="状态" class="!w-28" @change="((priceQuery.current = 1), loadPrices())">
              <el-option label="启用" value="1" />
              <el-option label="禁用" value="2" />
            </el-select>
            <el-input v-model="priceQuery.keyword" clearable placeholder="搜索价格表名称" class="!w-60" @keyup.enter="((priceQuery.current = 1), loadPrices())" @clear="((priceQuery.current = 1), loadPrices())" />
          </div>
        </div>

        <el-table v-loading="priceLoading" :data="priceItems" row-key="id" @selection-change="(rows) => (selectedPriceIds = selectedIds(rows))">
          <el-table-column type="selection" width="44" />
          <el-table-column v-for="column in priceColumns" :key="column.key" :label="column.label" :min-width="column.listWidth ?? 140" show-overflow-tooltip>
            <template #default="{ row }">
              <el-button v-if="column.key === 'name'" link type="primary" @click="openDetail('price', row.id)">{{ row.name }}</el-button>
              <template v-else>{{ formatFieldValue(column, row, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="190" fixed="right">
            <template #default="{ row }">
              <el-button v-if="auth.hasPerm('price:update')" link type="primary" @click="openPriceEdit(row as ProductPriceVO)">编辑</el-button>
              <el-button v-if="auth.hasPerm('price:add')" link @click="copyPrice(row as ProductPriceVO)">复制</el-button>
              <el-button v-if="auth.hasPerm('price:delete')" link type="danger" @click="removePrice(row as ProductPriceVO)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="flex justify-end mt-4">
          <el-pagination v-model:current-page="priceQuery.current" v-model:page-size="priceQuery.pageSize" :total="priceTotal" layout="total, sizes, prev, pager, next" @current-change="loadPrices" @size-change="((priceQuery.current = 1), loadPrices())" />
        </div>
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="productDialog" :title="productEditingId ? '编辑产品' : '新建产品'" width="680px" destroy-on-close>
    <DynamicForm ref="productFormRef" v-model="productForm" :fields="productFormFields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" />
    <template #footer><el-button @click="productDialog = false">取消</el-button><el-button type="primary" :loading="productSaving" @click="saveProduct">保存</el-button></template>
  </el-dialog>

  <el-dialog v-model="priceDialog" :title="priceEditingId ? '编辑价格表' : '新建价格表'" width="820px" destroy-on-close>
    <DynamicForm ref="priceFormRef" v-model="priceForm" :fields="priceFormFields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" />
    <div class="flex-between mt-4 mb-2"><span class="font-medium">产品信息</span><el-button type="primary" plain size="small" @click="addPriceProduct">添加产品</el-button></div>
    <el-table :data="priceProducts" border>
      <el-table-column label="产品" min-width="240">
        <template #default="{ row }"><el-select v-model="row.product" filterable class="!w-full"><el-option v-for="item in productOptions" :key="item.id" :label="item.name" :value="item.id" /></el-select></template>
      </el-table-column>
      <el-table-column label="产品定价" width="180"><template #default="{ row }"><el-input-number v-model="row.amount" :min="0" :precision="2" :controls="false" class="!w-full" /></template></el-table-column>
      <el-table-column label="产品SKU" min-width="160"><template #default="{ row }"><el-input v-model="row.values.priceProductSku" /></template></el-table-column>
      <el-table-column label="税点" width="150"><template #default="{ row }"><el-input-number v-model="row.values.priceProductTax" :min="0" :precision="2" :controls="false" class="!w-full" /></template></el-table-column>
      <el-table-column label="操作" width="90"><template #default="{ $index }"><el-button link type="danger" @click="priceProducts.splice($index, 1)">删除</el-button></template></el-table-column>
    </el-table>
    <template #footer><el-button @click="priceDialog = false">取消</el-button><el-button type="primary" :loading="priceSaving" @click="savePrice">保存</el-button></template>
  </el-dialog>

  <el-drawer v-model="detailVisible" :title="detailKind === 'product' ? '产品详情' : '价格表详情'" size="720px">
    <template v-if="detailKind === 'product' && productDetail">
      <el-descriptions :column="2" border>
        <el-descriptions-item v-for="field in productFormFields" :key="field.id" :label="field.label">
          <PictureFieldInput
            v-if="field.type === 'picture'"
            :model-value="(productDetail.customData[field.key] as string[] | undefined) ?? []"
            readonly
          />
          <template v-else>{{ formatFieldValue(field, productDetail as unknown as Record<string, unknown>, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
        </el-descriptions-item>
      </el-descriptions>
    </template>
    <template v-if="detailKind === 'price' && priceDetail">
      <el-descriptions :column="2" border>
        <el-descriptions-item v-for="field in priceFormFields" :key="field.id" :label="field.label">{{ formatFieldValue(field, priceDetail as unknown as Record<string, unknown>, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</el-descriptions-item>
      </el-descriptions>
      <div class="font-medium mt-5 mb-2">产品信息</div>
      <el-table :data="priceDetail.products" border><el-table-column label="产品" min-width="220"><template #default="{ row }">{{ productName(row as ProductPriceItemVO) }}</template></el-table-column><el-table-column prop="amount" label="产品定价" width="160" /><el-table-column label="产品SKU" min-width="150"><template #default="{ row }">{{ (row as ProductPriceItemVO).values.priceProductSku ?? '-' }}</template></el-table-column><el-table-column label="税点" width="120"><template #default="{ row }">{{ (row as ProductPriceItemVO).values.priceProductTax ?? '-' }}</template></el-table-column></el-table>
    </template>
  </el-drawer>

  <BatchFieldEditDialog v-model="productBatchEditVisible" title="批量编辑产品" :fields="productFields" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" :selected-count="selectedProductIds.length" @confirm="submitProductBatch" />
  <BatchFieldEditDialog v-model="priceBatchEditVisible" title="批量编辑价格表" :fields="priceFields.filter((field) => !field.hidden)" :members="fieldRefs.members.value" :dept-tree="fieldRefs.deptTree.value" :selected-count="selectedPriceIds.length" @confirm="submitPriceBatch" />

  <CrmImportDialog v-model="productImportVisible" module-label="产品" :download-template="productApi.downloadTemplate" :precheck="productApi.precheckImport" :execute="productApi.importXlsx" @success="() => { loadProducts(); reloadOptions() }" />
  <CrmImportDialog v-model="priceImportVisible" module-label="价格表" :download-template="productPriceApi.downloadTemplate" :precheck="productPriceApi.precheckImport" :execute="productPriceApi.importXlsx" @success="loadPrices" />
  <CrmExportDrawer v-model="exportVisible" :module-label="exportKind === 'product' ? '产品' : '价格表'" :cache-key="`w361-${exportKind}`" :fields="currentExportFields" :display-fields="currentExportDisplayFields" :mode="exportMode" :selected-count="currentSelectedCount" :loading="exportLoading" @confirm="submitExport" />

  <el-drawer v-model="sortVisible" :title="sortKind === 'product' ? '产品排序' : '价格表排序'" size="480px">
    <div class="text-sm text-[var(--el-text-color-secondary)] mb-3">拖动后立即保存排序。</div>
    <draggable v-model="sortRows" item-key="id" handle=".sort-handle" @end="handleSortEnd">
      <template #item="{ element }"><div class="sort-row"><span class="sort-handle">⋮⋮</span><span>{{ element.name }}</span></div></template>
    </draggable>
  </el-drawer>
</template>

<style scoped>
.product-page-card :deep(.el-card__body) { padding: 0 16px 16px; }
.crm-tabs :deep(.el-tabs__header) { margin-bottom: 16px; }
.sort-row { display: flex; align-items: center; gap: 12px; padding: 12px; margin-bottom: 8px; border: 1px solid var(--el-border-color-lighter); border-radius: 4px; background: var(--el-bg-color); }
.sort-handle { cursor: move; color: var(--el-text-color-secondary); }
</style>
