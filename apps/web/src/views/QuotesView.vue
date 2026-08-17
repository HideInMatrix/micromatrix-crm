<script setup lang="ts">
import {
  QUOTE_STATUS_LABELS,
  isCustomFieldKey,
  type FieldVO,
  type LineItemVO,
  type QuoteVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { approvalApi } from '@/api/approvals'
import { listCustomers } from '@/api/customers'
import { quoteApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { opportunityApi } from '@/api/sales'
import LineItemsEditor from '@/components/LineItemsEditor.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const route = useRoute()
const formOpportunityId = ref<string>()

const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<QuoteVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const formCustomerId = ref<string>()
const lineItems = ref<LineItemVO[]>([])
const customerOptions = ref<{ id: string; name: string }[]>([])

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))

async function loadData() {
  loading.value = true
  try {
    const { data } = await quoteApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      status: query.status || undefined,
    })
    items.value = data.items
    total.value = data.total
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

function openCreate() {
  editingId.value = null
  formModel.value = {}
  formCustomerId.value = undefined
  formOpportunityId.value = undefined
  lineItems.value = []
  searchCustomers('')
  dialogVisible.value = true
}

async function openFromOpportunity(opportunityId: string) {
  try {
    const { data } = await opportunityApi.get(opportunityId)
    editingId.value = null
    formOpportunityId.value = data.id
    formCustomerId.value = data.customerId
    customerOptions.value = [{ id: data.customerId, name: data.customerName ?? '' }]
    lineItems.value = (data.items ?? []).map((item) => ({ ...item }))
    formModel.value = { name: `${data.name}-报价` }
    dialogVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openEdit(row: QuoteVO) {
  if (row.status !== 'DRAFT') {
    ElMessage.warning('仅草稿状态的报价可编辑')
    return
  }
  editingId.value = row.id
  formCustomerId.value = row.customerId
  customerOptions.value = [{ id: row.customerId, name: row.customerName ?? '' }]
  lineItems.value = row.items.map((item) => ({ ...item }))
  formModel.value = Object.fromEntries(
    fields.value
      .filter((f) => f.type !== 'formula')
      .map((f) => [
        f.key,
        isCustomFieldKey(f.key)
          ? row.customData[f.key]
          : (row as unknown as Record<string, unknown>)[f.key],
      ]),
  )
  dialogVisible.value = true
}

async function handleSave() {
  if (!formCustomerId.value) {
    ElMessage.warning('请选择客户')
    return
  }
  if (lineItems.value.filter((i) => i.productName).length === 0) {
    ElMessage.warning('请至少添加一行明细')
    return
  }
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      customData: {},
      customerId: formCustomerId.value,
      items: lineItems.value.filter((i) => i.productName),
      opportunityId: formOpportunityId.value,
    }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await quoteApi.update(editingId.value, payload)
      ElMessage.success('报价已更新')
    } else {
      await quoteApi.create(payload)
      ElMessage.success('报价已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleSubmitApproval(row: QuoteVO) {
  const confirmed = await ElMessageBox.confirm(
    `提交报价「${row.name}」进入审批流程？`,
    '提交审批',
  ).catch(() => false)
  if (!confirmed) return
  try {
    await approvalApi.submit('quote', row.id)
    ElMessage.success('已提交审批')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleConfirm(row: QuoteVO) {
  const confirmed = await ElMessageBox.confirm(
    `确认报价「${row.name}」？确认后不可再编辑。`,
    '确认报价',
  ).catch(() => false)
  if (!confirmed) return
  try {
    await quoteApi.confirm(row.id)
    ElMessage.success('已确认')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleVoid(row: QuoteVO) {
  const confirmed = await ElMessageBox.confirm(`作废报价「${row.name}」？`, '作废确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await quoteApi.void(row.id)
    ElMessage.success('已作废')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: QuoteVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除报价「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await quoteApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  const [{ data }] = await Promise.all([metadataApi.fields('quote'), fieldRefs.load()])
  fields.value = data
  loadData()
  const fromId = route.query.fromOpportunity
  if (typeof fromId === 'string' && fromId) await openFromOpportunity(fromId)
})
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="搜索主题 / 单号"
          clearable
          class="!w-60"
          @keyup.enter="((query.page = 1), loadData())"
          @clear="((query.page = 1), loadData())"
        />
        <el-select
          v-model="query.status"
          clearable
          placeholder="状态"
          class="!w-28"
          @change="((query.page = 1), loadData())"
        >
          <el-option
            v-for="(label, value) in QUOTE_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </div>
      <el-button v-if="auth.hasPerm('quote:create')" type="primary" @click="openCreate">
        新建报价
      </el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe class="w-full">
      <el-table-column prop="code" label="单号" width="150" />
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
      <el-table-column label="合计金额" width="120" align="right">
        <template #default="{ row }">¥{{ row.totalAmount.toLocaleString('zh-CN') }}</template>
      </el-table-column>
      <el-table-column label="状态" width="130">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'CONFIRMED' ? 'success' : row.status === 'VOID' ? 'info' : 'primary'"
            size="small"
          >
            {{ QUOTE_STATUS_LABELS[row.status as keyof typeof QUOTE_STATUS_LABELS] }}
          </el-tag>
          <el-tag v-if="row.approvalStatus === 'PENDING'" type="warning" size="small" class="ml-1">
            审批中
          </el-tag>
          <el-tag v-else-if="row.approvalStatus === 'REJECTED'" type="danger" size="small" class="ml-1">
            已驳回
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <template v-if="row.status === 'DRAFT'">
            <template v-if="row.approvalStatus !== 'PENDING'">
              <el-button link type="primary" @click="openEdit(row as QuoteVO)">编辑</el-button>
              <el-button link type="warning" @click="handleSubmitApproval(row as QuoteVO)">
                提审
              </el-button>
              <el-button link type="success" @click="handleConfirm(row as QuoteVO)">确认</el-button>
              <el-button link @click="handleVoid(row as QuoteVO)">作废</el-button>
            </template>
          </template>
          <el-button
            v-if="auth.hasPerm('quote:delete')"
            link
            type="danger"
            @click="handleDelete(row as QuoteVO)"
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
        layout="total, prev, pager, next"
        @current-change="loadData"
      />
    </div>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? '编辑报价' : '新建报价'"
      width="860px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="关联客户" required>
          <el-select
            v-model="formCustomerId"
            filterable
            remote
            :remote-method="searchCustomers"
            placeholder="搜索并选择客户"
            class="w-full"
          >
            <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <DynamicForm
        ref="dynamicFormRef"
        v-model="formModel"
        :fields="fields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <el-divider content-position="left">报价明细</el-divider>
      <LineItemsEditor v-model="lineItems" />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
