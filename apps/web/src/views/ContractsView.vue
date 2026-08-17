<script setup lang="ts">
import {
  CONTRACT_STATUS_LABELS,
  isCustomFieldKey,
  type ContractVO,
  type FieldVO,
  type LineItemVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { approvalApi } from '@/api/approvals'
import { listCustomers } from '@/api/customers'
import { contractApi, quoteApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import ContractDetailDrawer from '@/components/ContractDetailDrawer.vue'
import LineItemsEditor from '@/components/LineItemsEditor.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<ContractVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const formCustomerId = ref<string>()
const fromQuoteId = ref<string>()
const lineItems = ref<LineItemVO[]>([])
const customerOptions = ref<{ id: string; name: string }[]>([])
const quoteOptions = ref<{ id: string; name: string }[]>([])

const detailVisible = ref(false)
const detailId = ref<string | null>(null)

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))

async function loadData() {
  loading.value = true
  try {
    const { data } = await contractApi.list({
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

async function loadQuotes(customerId?: string) {
  if (!customerId) {
    quoteOptions.value = []
    return
  }
  const { data } = await quoteApi.list({ page: 1, pageSize: 50, customerId, status: 'CONFIRMED' })
  quoteOptions.value = data.items.map((q) => ({ id: q.id, name: `${q.code} ${q.name}（¥${q.totalAmount}）` }))
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  formCustomerId.value = undefined
  fromQuoteId.value = undefined
  lineItems.value = []
  searchCustomers('')
  dialogVisible.value = true
}

function openEdit(row: ContractVO) {
  if (row.status !== 'DRAFT') {
    ElMessage.warning('仅草稿状态的合同可编辑')
    return
  }
  editingId.value = row.id
  formCustomerId.value = row.customerId
  fromQuoteId.value = undefined
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
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      customData: {},
      customerId: formCustomerId.value,
    }
    const effectiveItems = lineItems.value.filter((i) => i.productName)
    if (effectiveItems.length > 0) payload.items = effectiveItems
    if (!editingId.value && fromQuoteId.value) payload.fromQuoteId = fromQuoteId.value
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await contractApi.update(editingId.value, payload)
      ElMessage.success('合同已更新')
    } else {
      await contractApi.create(payload)
      ElMessage.success('合同已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleSubmitApproval(row: ContractVO) {
  const confirmed = await ElMessageBox.confirm(
    `提交合同「${row.name}」进入审批流程？审批通过后自动生效。`,
    '提交审批',
  ).catch(() => false)
  if (!confirmed) return
  try {
    await approvalApi.submit('contract', row.id)
    ElMessage.success('已提交审批')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleChangeStatus(row: ContractVO, status: string, label: string) {
  const confirmed = await ElMessageBox.confirm(`将合同「${row.name}」变更为「${label}」？`, '确认').catch(
    () => false,
  )
  if (!confirmed) return
  try {
    await contractApi.changeStatus(row.id, status)
    ElMessage.success('状态已更新')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: ContractVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除合同「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await contractApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openDetail(row: ContractVO) {
  detailId.value = row.id
  detailVisible.value = true
}

onMounted(async () => {
  const [{ data }] = await Promise.all([metadataApi.fields('contract'), fieldRefs.load()])
  fields.value = data
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="搜索合同名称 / 编号"
          clearable
          class="!w-60"
          @keyup.enter="((query.page = 1), loadData())"
          @clear="((query.page = 1), loadData())"
        />
        <el-select
          v-model="query.status"
          clearable
          placeholder="状态"
          class="!w-30"
          @change="((query.page = 1), loadData())"
        >
          <el-option
            v-for="(label, value) in CONTRACT_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </div>
      <el-button v-if="auth.hasPerm('contract:create')" type="primary" @click="openCreate">
        新建合同
      </el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe class="w-full">
      <el-table-column prop="code" label="编号" width="150" />
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
      <el-table-column label="客户" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">{{ row.customerName }}</template>
      </el-table-column>
      <el-table-column label="金额" width="110" align="right">
        <template #default="{ row }">¥{{ row.amount.toLocaleString('zh-CN') }}</template>
      </el-table-column>
      <el-table-column label="回款进度" width="140">
        <template #default="{ row }">
          <el-progress
            :percentage="row.amount > 0 ? Math.min(100, Math.round((row.paidAmount / row.amount) * 100)) : 0"
            :stroke-width="8"
          />
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag
            size="small"
            :type="
              row.status === 'EXECUTING'
                ? 'primary'
                : row.status === 'COMPLETED'
                  ? 'success'
                  : row.status === 'TERMINATED'
                    ? 'danger'
                    : 'info'
            "
          >
            {{ CONTRACT_STATUS_LABELS[row.status as keyof typeof CONTRACT_STATUS_LABELS] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row as ContractVO)">详情</el-button>
          <template v-if="row.status === 'DRAFT'">
            <template v-if="row.approvalStatus === 'PENDING'">
              <el-tag type="warning" size="small">审批中</el-tag>
            </template>
            <template v-else>
              <el-button link @click="openEdit(row as ContractVO)">编辑</el-button>
              <el-button link type="warning" @click="handleSubmitApproval(row as ContractVO)">
                提审
              </el-button>
              <el-button
                link
                type="success"
                @click="handleChangeStatus(row as ContractVO, 'EXECUTING', '履约中')"
              >
                生效
              </el-button>
              <el-button
                v-if="auth.hasPerm('contract:delete')"
                link
                type="danger"
                @click="handleDelete(row as ContractVO)"
              >
                删除
              </el-button>
            </template>
          </template>
          <template v-else-if="row.status === 'EXECUTING'">
            <el-button
              link
              type="success"
              @click="handleChangeStatus(row as ContractVO, 'COMPLETED', '已完成')"
            >
              完成
            </el-button>
            <el-button
              link
              type="danger"
              @click="handleChangeStatus(row as ContractVO, 'TERMINATED', '已终止')"
            >
              终止
            </el-button>
          </template>
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
      :title="editingId ? '编辑合同' : '新建合同'"
      width="860px"
      destroy-on-close
    >
      <el-form label-position="top">
        <div class="grid grid-cols-2 gap-4">
          <el-form-item label="关联客户" required>
            <el-select
              v-model="formCustomerId"
              filterable
              remote
              :remote-method="searchCustomers"
              placeholder="搜索并选择客户"
              class="w-full"
              @change="loadQuotes($event)"
            >
              <el-option v-for="c in customerOptions" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item v-if="!editingId" label="从已确认报价创建（可选，自动复制明细）">
            <el-select v-model="fromQuoteId" clearable placeholder="选择报价单" class="w-full">
              <el-option v-for="q in quoteOptions" :key="q.id" :label="q.name" :value="q.id" />
            </el-select>
          </el-form-item>
        </div>
      </el-form>
      <DynamicForm
        ref="dynamicFormRef"
        v-model="formModel"
        :fields="fields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <el-divider content-position="left">
        合同明细{{ fromQuoteId && !editingId ? '（留空则复制报价明细）' : '' }}
      </el-divider>
      <LineItemsEditor v-model="lineItems" />
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>

    <ContractDetailDrawer v-model="detailVisible" :contract-id="detailId" @changed="loadData" />
  </el-card>
</template>
