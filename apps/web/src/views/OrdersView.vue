<script setup lang="ts">
import {
  ORDER_STATUS_FLOW,
  ORDER_STATUS_LABELS,
  isCustomFieldKey,
  type FieldVO,
  type OrderStatus,
  type OrderVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { contractApi, orderApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<OrderVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const formContractId = ref<string>()
const contractOptions = ref<{ id: string; name: string }[]>([])

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))

const statusActions: Record<string, { label: string; type: 'primary' | 'success' | 'danger' }> = {
  DELIVERING: { label: '开始交付', type: 'primary' },
  ACCEPTED: { label: '验收', type: 'success' },
  COMPLETED: { label: '完成', type: 'success' },
  CANCELED: { label: '取消', type: 'danger' },
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await orderApi.list({
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

async function searchContracts(keyword: string) {
  const { data } = await contractApi.list({
    page: 1,
    pageSize: 20,
    keyword: keyword || undefined,
    status: 'EXECUTING',
  })
  contractOptions.value = data.items.map((c) => ({
    id: c.id,
    name: `${c.code} ${c.name}（${c.customerName}）`,
  }))
}

function openCreate() {
  editingId.value = null
  formModel.value = {}
  formContractId.value = undefined
  searchContracts('')
  dialogVisible.value = true
}

function openEdit(row: OrderVO) {
  editingId.value = row.id
  formContractId.value = row.contractId
  contractOptions.value = [{ id: row.contractId, name: row.contractName ?? '' }]
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
  if (!formContractId.value) {
    ElMessage.warning('请选择关联合同')
    return
  }
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      customData: {},
      contractId: formContractId.value,
    }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await orderApi.update(editingId.value, payload)
      ElMessage.success('订单已更新')
    } else {
      await orderApi.create(payload)
      ElMessage.success('订单已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleStatus(row: OrderVO, status: OrderStatus) {
  const action = statusActions[status]
  const confirmed = await ElMessageBox.confirm(
    `确定对订单「${row.name}」执行「${action.label}」？`,
    '确认',
  ).catch(() => false)
  if (!confirmed) return
  try {
    await orderApi.changeStatus(row.id, status)
    ElMessage.success('状态已更新')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDelete(row: OrderVO) {
  const confirmed = await ElMessageBox.confirm(`确定删除订单「${row.name}」吗？`, '删除确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await orderApi.remove(row.id)
    ElMessage.success('已删除')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  const [{ data }] = await Promise.all([metadataApi.fields('order'), fieldRefs.load()])
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
          placeholder="搜索订单名称 / 编号"
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
            v-for="(label, value) in ORDER_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
      </div>
      <el-button v-if="auth.hasPerm('order:create')" type="primary" @click="openCreate">
        新建订单
      </el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column prop="code" label="编号" width="150" />
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
      <el-table-column label="关联合同" min-width="180" show-overflow-tooltip>
        <template #default="{ row }">{{ row.contractName }}</template>
      </el-table-column>
      <el-table-column label="客户" min-width="140" show-overflow-tooltip>
        <template #default="{ row }">{{ row.customerName }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag
            size="small"
            :type="
              row.status === 'COMPLETED' || row.status === 'ACCEPTED'
                ? 'success'
                : row.status === 'CANCELED'
                  ? 'info'
                  : 'primary'
            "
          >
            {{ ORDER_STATUS_LABELS[row.status as keyof typeof ORDER_STATUS_LABELS] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220" fixed="right">
        <template #default="{ row }">
          <el-button
            v-for="next in ORDER_STATUS_FLOW[row.status as OrderStatus]"
            :key="next"
            link
            :type="statusActions[next].type"
            @click="handleStatus(row as OrderVO, next)"
          >
            {{ statusActions[next].label }}
          </el-button>
          <el-button
            v-if="auth.hasPerm('order:update')"
            link
            @click="openEdit(row as OrderVO)"
          >
            编辑
          </el-button>
          <el-button
            v-if="auth.hasPerm('order:delete') && (row.status === 'PENDING' || row.status === 'CANCELED')"
            link
            type="danger"
            @click="handleDelete(row as OrderVO)"
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
      :title="editingId ? '编辑订单' : '新建订单'"
      width="640px"
      destroy-on-close
    >
      <el-form label-position="top">
        <el-form-item label="关联合同（履约中）" required>
          <el-select
            v-model="formContractId"
            filterable
            remote
            :remote-method="searchContracts"
            :disabled="Boolean(editingId)"
            placeholder="搜索并选择合同"
            class="w-full"
          >
            <el-option v-for="c in contractOptions" :key="c.id" :label="c.name" :value="c.id" />
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
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </el-card>
</template>
