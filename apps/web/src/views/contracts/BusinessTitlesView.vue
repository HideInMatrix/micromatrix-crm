<script setup lang="ts">
import {
  CONTRACT_INVOICE_APPROVAL_STATUS_LABELS,
  type BusinessTitleVO,
  type ContractInvoiceApprovalStatus,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { businessTitleApi } from '@/api/deal'
import { extractErrorMessage } from '@/api/http'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const fields = ref<FieldVO[]>([])
const rows = ref<BusinessTitleVO[]>([])
const total = ref(0)
const loading = ref(false)
const filters = ref<FilterCondition[]>([])
const selectedIds = ref<string[]>([])
const query = reactive({ current: 1, pageSize: 10, keyword: '' })

const formVisible = ref(false)
const formSaving = ref(false)
const editingId = ref<string | null>(null)
const form = reactive<Record<string, string>>({})

const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref<BusinessTitleVO | null>(null)

const importVisible = ref(false)
const exportVisible = ref(false)
const exportLoading = ref(false)
const exportMode = ref<'all' | 'selected'>('all')

const listFields = computed(() => fields.value.filter((field) => field.showInList && !field.hidden))
const editableFields = computed(() =>
  fields.value.filter((field) =>
    [
      'name',
      'type',
      'identificationNumber',
      'openingBank',
      'bankAccount',
      'registrationAddress',
      'phoneNumber',
      'registeredCapital',
      'companySize',
      'registrationNumber',
      'province',
      'city',
      'scale',
      'industry',
      'remark',
    ].includes(field.key),
  ),
)

function asTitle(row: unknown) {
  return row as BusinessTitleVO
}

function approvalTagType(status: ContractInvoiceApprovalStatus | null) {
  if (status === 'APPROVED') return 'success'
  if (status === 'APPROVING') return 'warning'
  if (status === 'UNAPPROVED') return 'danger'
  return 'info'
}

function approvalLabel(status: ContractInvoiceApprovalStatus | null) {
  return status ? CONTRACT_INVOICE_APPROVAL_STATUS_LABELS[status] : '-'
}

async function loadMeta() {
  try {
    const [{ data }, _refs] = await Promise.all([businessTitleApi.moduleForm(), fieldRefs.load()])
    fields.value = (data.fields ?? []) as FieldVO[]
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await businessTitleApi.page({
      current: query.current,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
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

function onFilterApply(conditions: FilterCondition[]) {
  filters.value = conditions
  query.current = 1
  void loadData()
}

function resetForm() {
  editingId.value = null
  for (const key of Object.keys(form)) delete form[key]
  for (const field of editableFields.value) form[field.key] = field.key === 'type' ? 'CUSTOM' : ''
}

function openCreate() {
  resetForm()
  formVisible.value = true
}

async function openEdit(row: BusinessTitleVO) {
  try {
    const { data } = await businessTitleApi.detail(row.id)
    resetForm()
    editingId.value = data.id
    for (const field of editableFields.value) {
      const value = data[field.key as keyof BusinessTitleVO]
      form[field.key] = value == null ? '' : String(value)
    }
    formVisible.value = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function validateForm() {
  for (const field of editableFields.value) {
    if (field.required && !String(form[field.key] ?? '').trim()) {
      ElMessage.warning(`请填写${field.label}`)
      return false
    }
  }
  return true
}

async function saveTitle() {
  if (!validateForm()) return
  formSaving.value = true
  try {
    const payload = Object.fromEntries(
      editableFields.value.map((field) => [field.key, String(form[field.key] ?? '').trim() || undefined]),
    )
    if (editingId.value) await businessTitleApi.update({ id: editingId.value, ...payload })
    else await businessTitleApi.create(payload)
    ElMessage.success(editingId.value ? '工商抬头已更新' : '工商抬头已创建')
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
    const { data } = await businessTitleApi.detail(id)
    detail.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    detailLoading.value = false
  }
}

async function approve(row: BusinessTitleVO, approvalStatus: 'APPROVED' | 'UNAPPROVED') {
  let reason: string | undefined
  if (approvalStatus === 'UNAPPROVED') {
    const result = await ElMessageBox.prompt('请输入驳回原因', '驳回工商抬头', {
      inputValidator: (value) => Boolean(value.trim()) || '请输入驳回原因',
    }).catch(() => null)
    if (!result) return
    reason = result.value.trim()
  }
  try {
    await businessTitleApi.approval({ id: row.id, approvalStatus, reason })
    ElMessage.success(approvalStatus === 'APPROVED' ? '审批已通过' : '审批已驳回')
    await loadData()
    if (detail.value?.id === row.id) await openDetail(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function revoke(row: BusinessTitleVO) {
  try {
    await businessTitleApi.revoke(row.id)
    ElMessage.success('审批已撤回')
    await loadData()
    if (detail.value?.id === row.id) await openDetail(row.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeTitle(row: BusinessTitleVO) {
  try {
    const { data: used } = await businessTitleApi.hasInvoice(row.id)
    if (used) {
      ElMessage.warning('该工商抬头已被发票引用，无法删除')
      return
    }
    const confirmed = await ElMessageBox.confirm(`删除工商抬头「${row.name}」？`, '删除确认', {
      type: 'warning',
    }).catch(() => false)
    if (!confirmed) return
    await businessTitleApi.remove(row.id)
    ElMessage.success('工商抬头已删除')
    if (detail.value?.id === row.id) detailVisible.value = false
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
      await businessTitleApi.exportSelected({ ...payload, ids: selectedIds.value })
      selectedIds.value = []
    } else {
      await businessTitleApi.exportAll({
        current: 1,
        pageSize: 500,
        keyword: query.keyword.trim() || undefined,
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
  await loadData()
})
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex items-center gap-2">
        <el-input
          v-model="query.keyword"
          placeholder="通过工商抬头名称 / 纳税人识别号搜索"
          clearable
          class="!w-80"
          @keyup.enter="((query.current = 1), loadData())"
          @clear="((query.current = 1), loadData())"
        />
        <AdvancedFilter
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="onFilterApply"
        />
      </div>
      <div class="flex items-center gap-2">
        <ExportTaskButton />
        <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:IMPORT')" @click="importVisible = true">导入</el-button>
        <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:EXPORT')" :disabled="!rows.length" @click="openExport('all')">导出全部</el-button>
        <el-button
          v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:EXPORT') && selectedIds.length"
          @click="openExport('selected')"
        >导出选中</el-button>
        <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:ADD')" type="primary" @click="openCreate">新建工商抬头</el-button>
      </div>
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      stripe
      class="w-full"
      @selection-change="(selected: BusinessTitleVO[]) => (selectedIds = selected.map((row) => row.id))"
    >
      <el-table-column type="selection" width="48" />
      <el-table-column
        v-for="column in listFields"
        :key="column.key"
        :label="column.label"
        :min-width="column.listWidth ?? 140"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-button v-if="column.key === 'name'" link type="primary" @click="openDetail(row.id)">{{ row.name }}</el-button>
          <el-tag v-else-if="column.key === 'approvalStatus'" :type="approvalTagType(asTitle(row).approvalStatus)" size="small">
            {{ approvalLabel(asTitle(row).approvalStatus) }}
          </el-tag>
          <template v-else>{{ formatFieldValue(column, asTitle(row) as unknown as Record<string, unknown>, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) }}</template>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="310" fixed="right">
        <template #default="{ row }">
          <el-button link @click="openDetail(row.id)">详情</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:UPDATE')" link type="primary" @click="openEdit(asTitle(row))">编辑</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:APPROVAL') && asTitle(row).approvalStatus === 'APPROVING'" link type="success" @click="approve(asTitle(row), 'APPROVED')">通过</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:APPROVAL') && asTitle(row).approvalStatus === 'APPROVING'" link type="danger" @click="approve(asTitle(row), 'UNAPPROVED')">驳回</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:APPROVAL') && ['APPROVING', 'APPROVED', 'UNAPPROVED'].includes(asTitle(row).approvalStatus ?? '')" link @click="revoke(asTitle(row))">撤回</el-button>
          <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:DELETE')" link type="danger" @click="removeTitle(asTitle(row))">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="flex justify-end mt-4">
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
  </el-card>

  <el-drawer v-model="formVisible" :title="editingId ? '编辑工商抬头' : '新建工商抬头'" size="720px" destroy-on-close>
    <el-form label-position="top">
      <div class="grid grid-cols-2 gap-x-4">
        <el-form-item v-for="field in editableFields" :key="field.key" :label="field.label" :required="field.required" :class="field.key === 'remark' ? 'col-span-2' : ''">
          <el-select v-if="field.type === 'select'" v-model="form[field.key]" class="w-full">
            <el-option v-for="option in field.options ?? []" :key="String(option.value)" :label="option.label" :value="String(option.value)" />
          </el-select>
          <el-input v-else-if="field.type === 'textarea'" v-model="form[field.key]" type="textarea" :rows="3" maxlength="255" show-word-limit />
          <el-input v-else v-model="form[field.key]" maxlength="255" />
        </el-form-item>
      </div>
    </el-form>
    <template #footer><el-button @click="formVisible = false">取消</el-button><el-button type="primary" :loading="formSaving" @click="saveTitle">保存</el-button></template>
  </el-drawer>

  <el-drawer v-model="detailVisible" :title="detail?.name || '工商抬头详情'" size="760px" destroy-on-close>
    <div v-loading="detailLoading">
      <template v-if="detail">
        <div class="mb-4 flex items-center gap-2">
          <el-tag :type="approvalTagType(detail.approvalStatus)">{{ approvalLabel(detail.approvalStatus) }}</el-tag>
          <el-tag v-if="detail.type === 'THIRD_PARTY'" type="info">第三方</el-tag>
        </div>
        <el-descriptions :column="2" border>
          <el-descriptions-item v-for="field in fields.filter((item) => !['id'].includes(item.key))" :key="field.key" :label="field.label">
            {{ formatFieldValue(field, detail as unknown as Record<string, unknown>, { memberMap: fieldRefs.memberMap.value, deptMap: fieldRefs.deptMap.value }) || '-' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.unapprovedReason" label="驳回原因">{{ detail.unapprovedReason }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </div>
    <template v-if="detail" #footer>
      <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:UPDATE')" @click="openEdit(detail)">编辑</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:APPROVAL') && detail.approvalStatus === 'APPROVING'" type="success" @click="approve(detail, 'APPROVED')">通过</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:APPROVAL') && detail.approvalStatus === 'APPROVING'" type="danger" plain @click="approve(detail, 'UNAPPROVED')">驳回</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:APPROVAL') && ['APPROVING', 'APPROVED', 'UNAPPROVED'].includes(detail.approvalStatus ?? '')" @click="revoke(detail)">撤回</el-button>
      <el-button v-if="auth.hasPerm('CONTRACT_BUSINESS_TITLE:DELETE')" type="danger" plain @click="removeTitle(detail)">删除</el-button>
    </template>
  </el-drawer>

  <CrmImportDialog
    v-model="importVisible"
    module-label="工商抬头"
    :download-template="businessTitleApi.downloadTemplate"
    :precheck="businessTitleApi.precheckImport"
    :execute="businessTitleApi.importXlsx"
    @success="loadData"
  />
  <CrmExportDrawer
    v-model="exportVisible"
    module-label="工商抬头"
    cache-key="w364-business-title"
    :fields="fields"
    :mode="exportMode"
    :selected-count="selectedIds.length"
    :loading="exportLoading"
    @confirm="submitExport"
  />
</template>
