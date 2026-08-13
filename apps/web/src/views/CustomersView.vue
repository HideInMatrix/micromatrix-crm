<script setup lang="ts">
import {
  isCustomFieldKey,
  type CustomerVO,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import {
  createCustomer,
  exportCustomersCsv,
  importCustomers,
  listCustomers,
  removeCustomer,
  updateCustomer,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi } from '@/api/sales'
import CsvImportDialog from '@/components/CsvImportDialog.vue'
import CustomerDetailDrawer from '@/components/CustomerDetailDrawer.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const activeTab = ref<'mine' | 'sea'>('mine')
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<CustomerVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '' })
const filters = ref<FilterCondition[]>([])

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

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))

async function loadFields() {
  const { data } = await metadataApi.fields('customer')
  fields.value = data
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      scope: activeTab.value,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
    })
    items.value = data.items
    total.value = data.total
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
    await customerExtraApi.toSea(row.id)
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

function openDetail(row: CustomerVO) {
  detailTarget.value = row
  detailVisible.value = true
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
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
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

function openFollow(row: CustomerVO) {
  followTarget.value = row
  followVisible.value = true
}

onMounted(async () => {
  await Promise.all([loadFields(), fieldRefs.load()])
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="query.page = 1, loadData()">
      <el-tab-pane label="我的客户" name="mine" />
      <el-tab-pane label="客户公海" name="sea" />
    </el-tabs>

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2 items-center">
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
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>
      <div class="flex gap-2">
        <template v-if="auth.hasPerm('customer:import')">
          <el-button @click="handleExport">导出</el-button>
          <el-button @click="importVisible = true">导入</el-button>
        </template>
        <el-button v-if="auth.hasPerm('customer:create')" type="primary" @click="openCreate">
          新建客户
        </el-button>
      </div>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
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
            <el-button link @click="openDetail(row as CustomerVO)">详情</el-button>
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
  </el-card>
</template>
