<script setup lang="ts">
import {
  LEAD_STATUS_LABELS,
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type LeadVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi } from '@/api/sales'
import CsvImportDialog from '@/components/CsvImportDialog.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const activeTab = ref<'mine' | 'pool'>('mine')
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const items = ref<LeadVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, keyword: '', status: '' })
const filters = ref<FilterCondition[]>([])

const dialogVisible = ref(false)
const editingId = ref<string | null>(null)
const saving = ref(false)
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const formModel = ref<Record<string, unknown>>({})
const toPool = ref(false)

const followVisible = ref(false)
const followTarget = ref<LeadVO | null>(null)

const convertVisible = ref(false)
const convertTarget = ref<LeadVO | null>(null)
const convertForm = reactive({ createContact: true, withOpportunity: false, oppName: '', oppAmount: undefined as number | undefined })

const listColumns = computed(() => fields.value.filter((f) => f.showInList && !f.hidden))

async function loadFields() {
  const { data } = await metadataApi.fields('lead')
  fields.value = data
}

async function loadData() {
  loading.value = true
  try {
    const { data } = await leadApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      scope: activeTab.value,
      status: query.status || undefined,
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

function handleTabChange() {
  query.page = 1
  loadData()
}

function openCreate() {
  editingId.value = null
  toPool.value = activeTab.value === 'pool'
  formModel.value = {}
  dialogVisible.value = true
}

function openEdit(row: LeadVO) {
  editingId.value = row.id
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
  const valid = await dynamicFormRef.value?.validate()
  if (!valid) return
  saving.value = true
  try {
    const payload: Record<string, unknown> = { customData: {} }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    if (editingId.value) {
      await leadApi.update(editingId.value, payload)
      ElMessage.success('线索已更新')
    } else {
      payload.toPool = toPool.value
      await leadApi.create(payload)
      ElMessage.success('线索已创建')
    }
    dialogVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleClaim(row: LeadVO) {
  try {
    await leadApi.claim(row.id)
    ElMessage.success(`已领取「${row.name}」`)
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleToPool(row: LeadVO) {
  const confirmed = await ElMessageBox.confirm(`将「${row.name}」退回线索池？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await leadApi.toPool(row.id)
    ElMessage.success('已退回线索池')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

const assignVisible = ref(false)
const assignTarget = ref<LeadVO | null>(null)
const importVisible = ref(false)

async function handleImport(rows: Record<string, unknown>[]) {
  try {
    const { data } = await leadApi.import(rows)
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
    const { data } = await leadApi.exportCsv({
      keyword: query.keyword.trim() || undefined,
      scope: activeTab.value,
      status: query.status || undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
    })
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = `线索导出_${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function handleAssign(row: LeadVO) {
  assignTarget.value = row
  assignVisible.value = true
}

async function handleAssignConfirm(userId: string) {
  if (!assignTarget.value) return
  try {
    await leadApi.assign(assignTarget.value.id, userId)
    ElMessage.success('已分配')
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleInvalid(row: LeadVO) {
  const confirmed = await ElMessageBox.confirm(`标记「${row.name}」为无效线索？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  await leadApi.markInvalid(row.id)
  ElMessage.success('已标记无效')
  loadData()
}

function openFollow(row: LeadVO) {
  followTarget.value = row
  followVisible.value = true
}

function openConvert(row: LeadVO) {
  convertTarget.value = row
  Object.assign(convertForm, {
    createContact: Boolean(row.contactName),
    withOpportunity: false,
    oppName: `${row.name}-商机`,
    oppAmount: undefined,
  })
  convertVisible.value = true
}

async function handleConvert() {
  if (!convertTarget.value) return
  try {
    const result = await leadApi.convert(convertTarget.value.id, {
      createContact: convertForm.createContact,
      opportunity: convertForm.withOpportunity
        ? { name: convertForm.oppName, amount: convertForm.oppAmount }
        : undefined,
    })
    ElMessage.success(
      `转化成功：已创建客户${result.data.opportunityId ? '、商机' : ''}`,
    )
    convertVisible.value = false
    loadData()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

onMounted(async () => {
  await Promise.all([loadFields(), fieldRefs.load()])
  loadData()
})
</script>

<template>
  <el-card shadow="never">
    <el-tabs v-model="activeTab" @tab-change="handleTabChange">
      <el-tab-pane label="我的线索" name="mine" />
      <el-tab-pane label="线索池" name="pool" />
    </el-tabs>

    <div class="flex-between flex-wrap gap-3 mb-4">
      <div class="flex gap-2 items-center">
        <el-input
          v-model="query.keyword"
          placeholder="搜索名称 / 联系人 / 电话"
          clearable
          class="!w-60"
          @keyup.enter="handleSearch"
          @clear="handleSearch"
        />
        <el-select v-model="query.status" clearable placeholder="状态" class="!w-28" @change="handleSearch">
          <el-option
            v-for="(label, value) in LEAD_STATUS_LABELS"
            :key="value"
            :label="label"
            :value="value"
          />
        </el-select>
        <AdvancedFilter
          :fields="fields"
          :members="fieldRefs.members.value"
          :dept-tree="fieldRefs.deptTree.value"
          @apply="(c) => ((filters = c), handleSearch())"
        />
      </div>
      <div class="flex gap-2">
        <template v-if="auth.hasPerm('lead:import')">
          <el-button @click="handleExport">导出</el-button>
          <el-button @click="importVisible = true">导入</el-button>
        </template>
        <el-button v-if="auth.hasPerm('lead:create')" type="primary" @click="openCreate">
          新建线索
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
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag
            :type="row.status === 'CONVERTED' ? 'success' : row.status === 'INVALID' ? 'info' : 'primary'"
            size="small"
          >
            {{ LEAD_STATUS_LABELS[row.status as keyof typeof LEAD_STATUS_LABELS] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="最近跟进" width="110">
        <template #default="{ row }">
          {{ row.lastFollowedAt ? new Date(row.lastFollowedAt).toLocaleDateString() : '-' }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="250" fixed="right">
        <template #default="{ row }">
          <template v-if="activeTab === 'pool'">
            <el-button link type="primary" @click="handleClaim(row as LeadVO)">领取</el-button>
            <el-button
              v-if="auth.hasPerm('lead:assign')"
              link
              @click="handleAssign(row as LeadVO)"
            >
              分配
            </el-button>
          </template>
          <template v-else>
            <el-button link type="primary" @click="openFollow(row as LeadVO)">跟进</el-button>
            <el-dropdown trigger="click" class="ml-2">
              <el-button link type="primary">更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item
                    v-if="row.status === 'FOLLOWING' && auth.hasPerm('lead:convert')"
                    @click="openConvert(row as LeadVO)"
                  >
                    转化为客户
                  </el-dropdown-item>
                  <el-dropdown-item @click="openEdit(row as LeadVO)">编辑</el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:assign')"
                    @click="handleAssign(row as LeadVO)"
                  >
                    分配
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status === 'FOLLOWING' && auth.hasPerm('lead:assign')"
                    @click="handleToPool(row as LeadVO)"
                  >
                    退回线索池
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="row.status === 'FOLLOWING'"
                    @click="handleInvalid(row as LeadVO)"
                  >
                    标记无效
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
      :title="editingId ? '编辑线索' : '新建线索'"
      width="640px"
      destroy-on-close
    >
      <el-alert
        v-if="!editingId && activeTab === 'pool'"
        title="将创建到线索池（无负责人）"
        type="info"
        :closable="false"
        class="mb-3"
      />
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

    <el-dialog v-model="convertVisible" title="线索转化" width="480px" destroy-on-close>
      <p class="text-sm text-[var(--el-text-color-secondary)] mb-4">
        将线索「{{ convertTarget?.name }}」转化为正式客户
      </p>
      <el-form label-width="110px">
        <el-form-item label="创建联系人">
          <el-switch v-model="convertForm.createContact" :disabled="!convertTarget?.contactName" />
          <span class="text-xs text-[var(--el-text-color-placeholder)] ml-2">
            {{ convertTarget?.contactName ? `联系人：${convertTarget.contactName}` : '线索无联系人信息' }}
          </span>
        </el-form-item>
        <el-form-item label="同时创建商机">
          <el-switch v-model="convertForm.withOpportunity" />
        </el-form-item>
        <template v-if="convertForm.withOpportunity">
          <el-form-item label="商机名称">
            <el-input v-model="convertForm.oppName" />
          </el-form-item>
          <el-form-item label="预计金额">
            <el-input-number v-model="convertForm.oppAmount" :min="0" :precision="2" controls-position="right" class="!w-full" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="convertVisible = false">取消</el-button>
        <el-button type="primary" @click="handleConvert">确认转化</el-button>
      </template>
    </el-dialog>

    <FollowUpDrawer
      v-model="followVisible"
      target-type="lead"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="loadData"
    />

    <MemberSelectDialog
      v-model="assignVisible"
      :title="`分配线索「${assignTarget?.name ?? ''}」`"
      :members="fieldRefs.members.value"
      @confirm="handleAssignConfirm"
    />

    <CsvImportDialog
      v-model="importVisible"
      :fields="fields"
      module-label="线索"
      @submit="handleImport"
    />
  </el-card>
</template>
