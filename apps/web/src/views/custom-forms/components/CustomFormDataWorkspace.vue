<script setup lang="ts">
import type {
  CustomFormDataPageVO,
  CustomFormDataVO,
  CustomFormListVO,
  DepartmentVO,
  FieldVO,
  FilterCondition,
  ImportResultVO,
} from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import type { ImportType } from '@/api/import-export'
import { dataSourceApi } from '@/api/data-source'
import type { MemberOption } from '@/api/system'
import BatchFieldEditDialog from '@/components/BatchFieldEditDialog.vue'
import CrmExportDrawer from '@/components/CrmExportDrawer.vue'
import CrmImportDialog from '@/components/CrmImportDialog.vue'
import CrmTableUtilityActions from '@/components/CrmTableUtilityActions.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'
import {
  dataSourceDisplayKey,
  formatFieldValue,
} from '@/components/form-engine/field-display'

const props = defineProps<{
  activeForm?: CustomFormListVO
  page: CustomFormDataPageVO
  loading: boolean
  currentUserId?: string
  members: MemberOption[]
  deptTree: DepartmentVO[]
  visibleFields: FieldVO[]
  filterableFields: FieldVO[]
  savedViewModule: string
  savedViewFields: FieldVO[]
  defaultColumnKeys: string[]
  selectedIds: string[]
  batchSaving: boolean
  batchEditableFields: FieldVO[]
  exportFields: FieldVO[]
  exportDisplayFields: Array<{ key: string; label: string }>
  exportMode: 'all' | 'selected'
  exportLoading: boolean
  downloadTemplate: (importType: ImportType) => Promise<{ data: Blob }>
  precheckImport: (file: File, importType: ImportType) => Promise<{ data: ImportResultVO }>
  executeImport: (file: File, importType: ImportType) => Promise<{ data: ImportResultVO }>
}>()

const keyword = defineModel<string>('keyword', { required: true })
const filters = defineModel<FilterCondition[]>('filters', { required: true })
const importVisible = defineModel<boolean>('importVisible', { required: true })
const exportVisible = defineModel<boolean>('exportVisible', { required: true })
const batchEditVisible = defineModel<boolean>('batchEditVisible', { required: true })

const emit = defineEmits<{
  query: [reset?: boolean]
  advancedFilter: []
  savedViewChange: [viewId: string | undefined]
  clearFilters: []
  columnsChange: [keys: string[]]
  importOpen: []
  exportOpen: [mode: 'all' | 'selected']
  batchEditOpen: []
  batchDelete: []
  create: []
  selectionChange: [rows: CustomFormDataVO[]]
  edit: [row: CustomFormDataVO]
  remove: [row: CustomFormDataVO]
  exportConfirm: [payload: { fileName: string; headList: string[] }]
  batchEditConfirm: [payload: { fieldId: string; fieldValue: unknown }]
  pageChange: [current: number]
  pageSizeChange: [pageSize: number]
}>()

const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()

const memberMap = computed(() => new Map(props.members.map((item) => [item.id, item.name])))
const deptMap = computed(() => {
  const output = new Map<string, string>()
  const walk = (nodes: DepartmentVO[]) => {
    for (const node of nodes) {
      output.set(node.id, node.name)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(props.deptTree)
  return output
})
const dataSourceMap = ref(new Map<string, string>())
let dataSourceResolveSeq = 0

async function resolvePageDataSources() {
  const seq = ++dataSourceResolveSeq
  const groups = new Map<string, Set<string>>()
  for (const field of props.page.fields) {
    if (!['data_source', 'data_source_multiple'].includes(field.type)) continue
    const sourceType = field.config?.dataSourceType
    if (!sourceType) continue
    const ids = groups.get(sourceType) ?? new Set<string>()
    for (const row of props.page.list) {
      const value = row.values[field.key]
      const values = Array.isArray(value) ? value : value ? [value] : []
      for (const item of values) {
        if (typeof item === 'string' && item) ids.add(item)
      }
    }
    groups.set(sourceType, ids)
  }

  const next = new Map<string, string>()
  await Promise.all(
    [...groups.entries()].map(async ([sourceType, ids]) => {
      if (!ids.size) return
      try {
        const options = await dataSourceApi.resolve(sourceType, [...ids])
        for (const option of options) {
          next.set(dataSourceDisplayKey(sourceType, option.id), option.name)
        }
      } catch {
        // 列表主数据已经有权限；引用源无权限或已删除时保留 ID 降级展示。
      }
    }),
  )
  if (seq === dataSourceResolveSeq) dataSourceMap.value = next
}

watch(
  () => props.page,
  () => void resolvePageDataSources(),
  { immediate: true },
)

function asDataRow(row: unknown): CustomFormDataVO {
  return row as CustomFormDataVO
}

function canEdit(rowValue: unknown) {
  const row = asDataRow(rowValue)
  return (
    props.page.access.canManageAll ||
    (props.page.access.canManageOwn && row.ownerId === props.currentUserId)
  )
}

function displayValue(field: FieldVO, rowValue: unknown) {
  const row = asDataRow(rowValue)
  return formatFieldValue(
    field,
    {
      ...row,
      customData: row.values,
      ownerName: memberMap.value.get(row.ownerId),
    },
    {
      memberMap: memberMap.value,
      deptMap: deptMap.value,
      dataSourceMap: dataSourceMap.value,
    },
  )
}

function emitEdit(row: unknown) {
  emit('edit', asDataRow(row))
}

function emitRemove(row: unknown) {
  emit('remove', asDataRow(row))
}
</script>

<template>
  <el-card shadow="never" class="min-w-0 flex-1" body-class="h-full !p-4 flex flex-col min-h-0">
    <template v-if="activeForm">
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h2 class="m-0 truncate text-base font-600">{{ activeForm.name }}</h2>
            <el-tag v-if="activeForm.isAdmin" size="small">管理员</el-tag>
            <el-tag v-if="!activeForm.enable" size="small" type="info">已停用</el-tag>
          </div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            共 {{ page.total }} 条数据
          </div>
        </div>
        <div class="flex items-center gap-2">
          <el-input
            v-model="keyword"
            clearable
            placeholder="搜索名称"
            class="w-[220px]"
            @keyup.enter="emit('query', true)"
            @clear="emit('query', true)"
          />
          <el-button @click="emit('query', true)">查询</el-button>
          <AdvancedFilter
            v-model="filters"
            :fields="filterableFields"
            :members="members"
            :dept-tree="deptTree"
            @apply="emit('advancedFilter')"
          />
          <CrmTableUtilityActions
            :refreshing="loading"
            @columns="savedViewBarRef?.openColumnSettings()"
            @refresh="emit('query')"
          />
          <el-button v-if="page.access.canCreate" @click="emit('importOpen')">导入</el-button>
          <el-button @click="emit('exportOpen', 'all')">导出全部</el-button>
          <el-button :disabled="!selectedIds.length" @click="emit('exportOpen', 'selected')">
            导出选中
          </el-button>
          <el-button
            v-if="page.access.canManageAll || page.access.canManageOwn"
            :disabled="!selectedIds.length"
            @click="emit('batchEditOpen')"
          >
            批量修改
          </el-button>
          <el-button
            v-if="page.access.canManageAll || page.access.canManageOwn"
            type="danger"
            plain
            :loading="batchSaving"
            :disabled="!selectedIds.length"
            @click="emit('batchDelete')"
          >
            批量删除
          </el-button>
          <el-button
            v-if="page.access.canCreate"
            type="primary"
            :disabled="!activeForm.enable && !activeForm.isAdmin"
            @click="emit('create')"
          >
            新建数据
          </el-button>
        </div>
      </div>

      <SavedViewBar
        v-if="page.fields.length"
        :key="activeForm.id"
        ref="savedViewBarRef"
        :module="savedViewModule"
        :fields="savedViewFields"
        :filter-fields="filterableFields"
        :members="members"
        :dept-tree="deptTree"
        :current-filters="filters"
        :default-column-keys="defaultColumnKeys"
        @change="emit('savedViewChange', $event)"
        @clear-filters="emit('clearFilters')"
        @columns-change="emit('columnsChange', $event)"
      />

      <div v-loading="loading" class="min-h-0 flex-1 overflow-hidden">
        <el-table
          :data="page.list"
          height="100%"
          border
          @selection-change="emit('selectionChange', $event)"
        >
          <el-table-column type="selection" width="46" :selectable="canEdit" />
          <el-table-column
            v-for="field in visibleFields"
            :key="field.id"
            :label="field.label"
            :min-width="field.listWidth ?? 150"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ displayValue(field, row) }}</template>
          </el-table-column>
          <el-table-column label="更新时间" width="175">
            <template #default="{ row }">{{ new Date(row.updateTime).toLocaleString() }}</template>
          </el-table-column>
          <el-table-column label="操作" width="120" fixed="right">
            <template #default="{ row }">
              <template v-if="canEdit(row)">
                <el-button link type="primary" @click="emitEdit(row)">编辑</el-button>
                <el-button link type="danger" @click="emitRemove(row)">删除</el-button>
              </template>
              <span v-else class="text-xs text-[var(--el-text-color-placeholder)]">只读</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <div class="mt-4 flex justify-end">
        <el-pagination
          :current-page="page.current"
          :page-size="page.pageSize"
          layout="total, sizes, prev, pager, next"
          :total="page.total"
          :page-sizes="[20, 50, 100]"
          @current-change="emit('pageChange', $event)"
          @size-change="emit('pageSizeChange', $event)"
        />
      </div>
    </template>
    <el-empty v-else description="请选择或新建一个自定义表单" class="m-auto" />
  </el-card>

  <CrmImportDialog
    v-if="activeForm"
    v-model="importVisible"
    :module-label="activeForm.name"
    :download-template="downloadTemplate"
    :precheck="precheckImport"
    :execute="executeImport"
    @success="emit('query', true)"
  />

  <CrmExportDrawer
    v-if="activeForm"
    v-model="exportVisible"
    :module-label="activeForm.name"
    :cache-key="`custom-form:${activeForm.id}`"
    :fields="exportFields"
    :display-fields="exportDisplayFields"
    :mode="exportMode"
    :selected-count="selectedIds.length"
    :loading="exportLoading"
    @confirm="emit('exportConfirm', $event)"
  />

  <BatchFieldEditDialog
    v-if="activeForm"
    v-model="batchEditVisible"
    :fields="batchEditableFields"
    :members="members"
    :dept-tree="deptTree"
    :selected-count="selectedIds.length"
    :loading="batchSaving"
    title="批量修改自定义表单数据"
    @confirm="emit('batchEditConfirm', $event)"
  />
</template>
