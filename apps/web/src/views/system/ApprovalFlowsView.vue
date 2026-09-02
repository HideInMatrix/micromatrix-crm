<script setup lang="ts">
import {
  APPROVAL_FORM_TYPE_LABELS,
  type ApprovalFlowListItem,
  type ApprovalFormType,
} from '@micromatrix/shared'
import { Eye, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, reactive, ref } from 'vue'
import { approvalApi } from '@/api/approvals'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'
import ApprovalFlowDrawer from './approval-flows/ApprovalFlowDrawer.vue'

type DrawerMode = 'create' | 'edit' | 'detail'
type SortField = 'number' | 'name' | 'formType' | 'enabled' | 'createdAt' | 'updatedAt'
const SORT_FIELDS: SortField[] = ['number', 'name', 'formType', 'enabled', 'createdAt', 'updatedAt']

const auth = useAuthStore()
const loading = ref(false)
const switchingId = ref<string | null>(null)
const rows = ref<ApprovalFlowListItem[]>([])
const total = ref(0)
const drawerVisible = ref(false)
const drawerMode = ref<DrawerMode>('detail')
const activeFlowId = ref<string | null>(null)
const query = reactive<{
  page: number
  pageSize: number
  keyword: string
  formType?: ApprovalFormType
  enabled?: 'true' | 'false'
  sortBy: SortField
  sortOrder: 'asc' | 'desc'
}>({
  page: 1,
  pageSize: 10,
  keyword: '',
  formType: undefined,
  enabled: undefined,
  sortBy: 'updatedAt',
  sortOrder: 'desc',
})

const canAdd = computed(() => auth.hasPerm('system:process:add'))
const canUpdate = computed(() => auth.hasPerm('system:process:update'))
const canDelete = computed(() => auth.hasPerm('system:process:delete'))

async function load() {
  loading.value = true
  try {
    const { data } = await approvalApi.flows({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      formType: query.formType,
      enabled: query.enabled,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    })
    rows.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  load()
}

function reset() {
  query.keyword = ''
  query.formType = undefined
  query.enabled = undefined
  query.sortBy = 'updatedAt'
  query.sortOrder = 'desc'
  query.page = 1
  load()
}

function handleSort({
  prop,
  order,
}: {
  prop: string | null
  order: 'ascending' | 'descending' | null
}) {
  query.sortBy = prop && SORT_FIELDS.includes(prop as SortField) ? (prop as SortField) : 'updatedAt'
  query.sortOrder = order === 'ascending' ? 'asc' : 'desc'
  query.page = 1
  load()
}

function asFlowRow(row: unknown): ApprovalFlowListItem {
  return row as ApprovalFlowListItem
}

function openDrawer(mode: DrawerMode, id?: string) {
  drawerMode.value = mode
  activeFlowId.value = id ?? null
  drawerVisible.value = true
}

async function toggleEnabled(row: ApprovalFlowListItem, value: boolean | string | number) {
  if (typeof value !== 'boolean') return
  if (value && !row.runtimeReady) {
    ElMessage.warning('该表单的审批运行时尚未接入，当前只能保持停用')
    return
  }
  const action = value ? '启用' : '停用'
  try {
    await ElMessageBox.confirm(
      value
        ? `启用后，${APPROVAL_FORM_TYPE_LABELS[row.formType]}单据将按该流程进入审批。`
        : '停用仅影响后续新提交，历史审批实例仍按原版本继续处理。',
      `${action}流程`,
      { type: value ? 'warning' : 'info' },
    )
  } catch {
    return
  }
  switchingId.value = row.id
  try {
    await approvalApi.updateFlowEnabled(row.id, value)
    ElMessage.success(`流程已${action}`)
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    switchingId.value = null
  }
}

async function remove(row: ApprovalFlowListItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除流程「${row.name}」吗？已生成的版本与历史审批实例会保留。`,
      '删除流程',
      { type: 'warning', confirmButtonText: '删除', confirmButtonClass: 'el-button--danger' },
    )
    await approvalApi.removeFlow(row.id)
    ElMessage.success('流程已删除')
    if (rows.value.length === 1 && query.page > 1) query.page -= 1
    await load()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(extractErrorMessage(error))
  }
}

function formatDate(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(load)
</script>

<template>
  <el-card shadow="never" body-class="!p-0" class="process-card">
    <div class="page-heading">
      <div>
        <div class="text-lg font-semibold">流程设置</div>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          配置报价、合同、发票和订单的审批流程；节点调整将生成不可变版本。
        </div>
      </div>
      <el-button
        v-if="canAdd"
        type="primary"
        :icon="Plus"
        data-testid="create-flow"
        @click="openDrawer('create')"
      >
        新建流程
      </el-button>
    </div>

    <div class="filter-bar">
      <el-input
        v-model="query.keyword"
        clearable
        class="!w-64"
        placeholder="搜索流程编号或名称"
        :prefix-icon="Search"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select
        v-model="query.formType"
        clearable
        class="!w-36"
        placeholder="表单类型"
        @change="search"
      >
        <el-option
          v-for="(label, value) in APPROVAL_FORM_TYPE_LABELS"
          :key="value"
          :label="label"
          :value="value"
        />
      </el-select>
      <el-select
        v-model="query.enabled"
        clearable
        class="!w-32"
        placeholder="状态"
        @change="search"
      >
        <el-option label="已启用" value="true" />
        <el-option label="已停用" value="false" />
      </el-select>
      <el-button type="primary" plain @click="search">查询</el-button>
      <el-button @click="reset">重置</el-button>
      <el-button :icon="RefreshCw" circle aria-label="刷新流程列表" @click="load" />
    </div>

    <el-table
      v-loading="loading"
      :data="rows"
      row-key="id"
      data-testid="approval-flow-table"
      @sort-change="handleSort"
    >
      <el-table-column prop="number" label="流程编号" width="160" sortable="custom" />
      <el-table-column prop="name" label="流程名称" min-width="190" sortable="custom">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDrawer('detail', row.id)">{{
            row.name
          }}</el-button>
        </template>
      </el-table-column>
      <el-table-column prop="formType" label="表单类型" width="125" sortable="custom">
        <template #default="{ row }">{{
          APPROVAL_FORM_TYPE_LABELS[row.formType as ApprovalFormType]
        }}</template>
      </el-table-column>
      <el-table-column label="执行时机" min-width="155">
        <template #default="{ row }">
          <div class="flex flex-wrap gap-1">
            <el-tag v-if="row.createExecute" size="small">新建</el-tag>
            <el-tag v-if="row.updateExecute" size="small" type="info">编辑</el-tag>
            <el-tag v-if="row.deleteExecute" size="small" type="info">删除</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="版本" width="82" align="center">
        <template #default="{ row }">V{{ row.currentVersion }}</template>
      </el-table-column>
      <el-table-column label="运行时" width="112">
        <template #default="{ row }">
          <el-tag :type="row.runtimeReady ? 'success' : 'warning'" effect="plain">
            {{ row.runtimeReady ? '已接入' : '仅配置' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="enabled" label="状态" width="105" sortable="custom">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            :disabled="!canUpdate || !row.runtimeReady"
            :loading="switchingId === row.id"
            :data-flow-enabled="row.id"
            @change="(value: boolean | string | number) => toggleEnabled(asFlowRow(row), value)"
          />
        </template>
      </el-table-column>
      <el-table-column prop="createdAt" label="创建信息" min-width="175" sortable="custom">
        <template #default="{ row }">
          <div>{{ row.createdByName || '-' }}</div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            {{ formatDate(row.createdAt) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="updatedAt" label="最后修改" min-width="180" sortable="custom">
        <template #default="{ row }">
          <div>{{ row.updatedByName || '-' }}</div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            {{ formatDate(row.updatedAt) }}
          </div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" :icon="Eye" @click="openDrawer('detail', row.id)"
            >查看</el-button
          >
          <el-button
            v-if="canUpdate"
            link
            type="primary"
            :icon="Pencil"
            :data-flow-edit="row.id"
            @click="openDrawer('edit', row.id)"
          >
            编辑
          </el-button>
          <el-button
            v-if="canDelete"
            link
            type="danger"
            :icon="Trash2"
            :disabled="row.enabled"
            @click="remove(asFlowRow(row))"
          >
            删除
          </el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无流程配置">
          <el-button v-if="canAdd" type="primary" @click="openDrawer('create')"
            >新建第一个流程</el-button
          >
        </el-empty>
      </template>
    </el-table>

    <div class="pagination-wrap">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        :page-sizes="[10, 20, 50]"
        layout="total, sizes, prev, pager, next"
        @change="load"
      />
    </div>
  </el-card>

  <ApprovalFlowDrawer
    v-if="drawerVisible"
    v-model="drawerVisible"
    :mode="drawerMode"
    :flow-id="activeFlowId"
    @saved="load"
  />
</template>

<style scoped>
.process-card {
  min-height: calc(100vh - 112px);
}

.page-heading,
.filter-bar,
.pagination-wrap {
  display: flex;
  align-items: center;
}

.page-heading {
  justify-content: space-between;
  padding: 20px 22px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.filter-bar {
  flex-wrap: wrap;
  gap: 10px;
  padding: 16px 22px;
  background: var(--el-fill-color-extra-light);
}

.pagination-wrap {
  justify-content: flex-end;
  padding: 16px 22px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
