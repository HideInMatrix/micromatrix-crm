<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Ban,
  Columns3,
  Download,
  FolderInput,
  Plus,
  Upload,
  UserRoundCog,
  UserRoundPlus,
} from 'lucide-vue-next'
import type {
  DepartmentVO,
  FieldVO,
  FilterCondition,
  LeadStageConfig,
  LeadVO,
} from '@micromatrix/shared'
import type { ResourcePoolVO } from '@/api/sales'
import type { MemberOption } from '@/api/system'
import { useAuthStore } from '@/stores/auth'
import CrmSearchInput from '@/components/CrmSearchInput.vue'
import SavedViewBar from '@/components/SavedViewBar.vue'
import AdvancedFilter from '@/components/form-engine/AdvancedFilter.vue'

const props = defineProps<{
  isPoolMode: boolean
  canImport: boolean
  canExport: boolean
  pools: ResourcePoolVO[]
  selectedPoolId: string
  itemsCount: number
  totalCount: number
  loading: boolean
  showLegacySearch: boolean
  showAdvanced: boolean
  showQuickSearchPanel: boolean
  showSavedViews: boolean
  keywordValue: string
  statusValue: string
  filtersValue: FilterCondition[]
  leadStages: LeadStageConfig[]
  contextFields: FieldVO[]
  members: MemberOption[]
  deptTree: DepartmentVO[]
  savedViewModule: 'lead' | 'lead_pool'
  defaultColumnKeys: string[]
  selectedRows: LeadVO[]
  batchInvalidLoading: boolean
}>()
const emit = defineEmits<{
  'update:selectedPoolId': [value: string]
  'update:keywordValue': [value: string]
  'update:statusValue': [value: string]
  'update:filtersValue': [value: FilterCondition[]]
  clearSelection: []
  openImport: []
  openCreate: []
  openBatchTransfer: []
  openBatchToPool: []
  openBatchPoolAssign: []
  openExport: [mode: 'all' | 'selected']
  batchInvalid: []
  search: []
  poolChange: []
  refresh: []
  savedViewChange: [viewId?: string]
  clearTemporaryFilters: []
  savedColumns: [keys: string[]]
  batchPick: []
}>()

const auth = useAuthStore()
const savedViewBarRef = ref<InstanceType<typeof SavedViewBar>>()
const poolId = computed({
  get: () => props.selectedPoolId,
  set: (value: string) => emit('update:selectedPoolId', value),
})
const keyword = computed({
  get: () => props.keywordValue,
  set: (value: string) => emit('update:keywordValue', value),
})
const status = computed({
  get: () => props.statusValue,
  set: (value: string) => emit('update:statusValue', value),
})
const filters = computed({
  get: () => props.filtersValue,
  set: (value: FilterCondition[]) => emit('update:filtersValue', value),
})
const itemsCount = computed(() => props.itemsCount)
function openCreate() {
  emit('openCreate')
}
function openExport(mode: 'all' | 'selected') {
  emit('openExport', mode)
}
function handleSearch() {
  emit('search')
}
function handlePoolChange() {
  emit('poolChange')
}
function loadData() {
  emit('refresh')
}
// 按设计隐藏刷新按钮，保留可由父组件主动调用的刷新入口。
defineExpose({ refresh: loadData })
function handleSavedViewChange(viewId?: string) {
  emit('savedViewChange', viewId)
}
function clearTemporaryFilters() {
  emit('clearTemporaryFilters')
}
function handleSavedColumns(keys: string[]) {
  emit('savedColumns', keys)
}
function openBatchTransfer() {
  emit('openBatchTransfer')
}
function handleBatchToPool() {
  emit('openBatchToPool')
}
function handleBatchInvalid() {
  emit('batchInvalid')
}
function handleBatchPick() {
  emit('batchPick')
}
function openBatchPoolAssign() {
  emit('openBatchPoolAssign')
}
</script>

<template>
  <!-- 搜索和视图配置位于表格操作栏上方，避免打断操作栏与表格的 16px 间距。 -->
  <div
    v-if="showLegacySearch || (showAdvanced && !showQuickSearchPanel)"
    class="mb-4 flex flex-wrap items-center justify-end gap-2"
  >
    <CrmSearchInput
      v-if="showLegacySearch"
      v-model="keyword"
      placeholder="搜索名称 / 手机号"
      @search="handleSearch"
    />
    <el-select
      v-if="showLegacySearch"
      v-model="status"
      clearable
      placeholder="状态"
      class="!w-32"
      @change="handleSearch"
    >
      <el-option
        v-for="stage in leadStages"
        :key="stage.key"
        :label="stage.enabled === false ? stage.name + '（已停用）' : stage.name"
        :value="stage.key"
      />
    </el-select>
    <AdvancedFilter
      v-if="showAdvanced && !showQuickSearchPanel"
      v-model="filters"
      :fields="contextFields"
      :members="members"
      :dept-tree="deptTree"
      @apply="(c) => ((filters = c), handleSearch())"
    />
  </div>

  <div v-show="showSavedViews" class="mb-4">
    <SavedViewBar
      ref="savedViewBarRef"
      :module="savedViewModule"
      :fields="contextFields"
      :members="members"
      :dept-tree="deptTree"
      :current-filters="filters"
      :default-column-keys="defaultColumnKeys"
      @change="handleSavedViewChange"
      @clear-filters="clearTemporaryFilters"
      @columns-change="handleSavedColumns"
    />
  </div>

  <div
    class="lead-table-primary-toolbar mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3"
    data-testid="crm-table-primary-toolbar"
  >
    <div class="flex min-w-0 flex-wrap items-center gap-4">
      <el-select
        v-if="isPoolMode"
        v-model="poolId"
        class="!w-52"
        placeholder="选择线索池"
        @change="handlePoolChange"
      >
        <el-option v-for="pool in pools" :key="pool.id" :label="pool.name" :value="pool.id" />
      </el-select>
      <span v-if="selectedRows.length" class="shrink-0 text-[14px] text-[#000000]">
        已选{{ selectedRows.length }}条线索
      </span>
      <span v-else class="shrink-0 text-[14px] text-[#000000]">共{{ totalCount }}条线索</span>

      <template v-if="selectedRows.length">
        <template v-if="!isPoolMode">
          <el-button
            v-if="auth.hasPerm('lead:transfer')"
            class="lead-table-toolbar-action lead-table-toolbar-action--outline"
            @click="openBatchTransfer"
          >
            <UserRoundCog :size="14" :stroke-width="1.8" aria-hidden="true" />批量转移
          </el-button>
          <el-button
            v-if="auth.hasPerm('lead:recycle')"
            class="lead-table-toolbar-action lead-table-toolbar-action--outline"
            @click="handleBatchToPool"
          >
            <FolderInput :size="14" :stroke-width="1.8" aria-hidden="true" />批量移入线索池
          </el-button>
          <el-button
            v-if="auth.hasPerm('lead:update')"
            class="lead-table-toolbar-action lead-table-toolbar-action--outline"
            :loading="batchInvalidLoading"
            @click="handleBatchInvalid"
          >
            <Ban
              v-if="!batchInvalidLoading"
              :size="14"
              :stroke-width="1.8"
              aria-hidden="true"
            />批量无效
          </el-button>
        </template>
        <template v-else>
          <el-button
            v-if="auth.hasPerm('leadPool:pick')"
            class="lead-table-toolbar-action lead-table-toolbar-action--outline"
            @click="handleBatchPick"
          >
            <UserRoundPlus :size="14" :stroke-width="1.8" aria-hidden="true" />批量领取
          </el-button>
          <el-button
            v-if="auth.hasPerm('leadPool:assign')"
            class="lead-table-toolbar-action lead-table-toolbar-action--outline"
            @click="openBatchPoolAssign"
          >
            <UserRoundCog :size="14" :stroke-width="1.8" aria-hidden="true" />批量分配
          </el-button>
        </template>
        <el-button
          v-if="canExport"
          class="lead-table-toolbar-action lead-table-toolbar-action--outline"
          @click="openExport('selected')"
        >
          <Download :size="14" :stroke-width="1.8" aria-hidden="true" />批量导出
        </el-button>
        <button
          type="button"
          class="h-[36px] cursor-pointer border-0 bg-transparent px-1 py-0 text-[14px] leading-5 text-[#606266] hover:text-[var(--el-color-primary)]"
          @click="emit('clearSelection')"
        >
          取消选择
        </button>
      </template>
    </div>

    <div class="flex shrink-0 flex-wrap items-center gap-3">
      <el-button
        v-if="canExport && !selectedRows.length"
        class="lead-table-toolbar-action lead-table-toolbar-action--outline"
        :disabled="itemsCount === 0"
        @click="openExport('all')"
      >
        <Download :size="14" :stroke-width="1.8" aria-hidden="true" />导出全部
      </el-button>
      <el-button
        v-if="canImport"
        class="lead-table-toolbar-action lead-table-toolbar-action--outline"
        :disabled="isPoolMode && !poolId"
        @click="emit('openImport')"
      >
        <Upload :size="14" :stroke-width="1.8" aria-hidden="true" />批量导入
      </el-button>
      <el-button
        class="lead-table-toolbar-action lead-table-toolbar-action--outline"
        aria-label="列设置"
        @click="savedViewBarRef?.openColumnSettings()"
      >
        <Columns3 :size="14" :stroke-width="1.8" aria-hidden="true" />列设置
      </el-button>
      <el-button
        v-if="!isPoolMode && auth.hasPerm('lead:create')"
        type="primary"
        class="lead-table-toolbar-action lead-table-toolbar-action--primary"
        @click="openCreate"
      >
        <Plus :size="14" :stroke-width="1.8" aria-hidden="true" />新建线索
      </el-button>
    </div>
  </div>
</template>

<style scoped>
/* 只针对线索列表的操作按钮，不改变全局 Element Plus 按钮。 */
.lead-table-primary-toolbar :deep(.el-button + .el-button) {
  margin-left: 0;
}
.lead-table-primary-toolbar :deep(.lead-table-toolbar-action.el-button) {
  box-sizing: border-box;
  height: auto;
  min-height: 36px;
  padding: 8px 20px;
  border-radius: 4px;
  font-size: 14px;
  line-height: 18px;
  font-weight: 400;
  gap: 6px;
}
.lead-table-primary-toolbar :deep(.lead-table-toolbar-action.el-button > span) {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.lead-table-primary-toolbar :deep(.lead-table-toolbar-action--outline.el-button) {
  --el-button-bg-color: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
  --el-button-border-color: var(--el-color-primary);
  --el-button-text-color: var(--el-color-primary);
  --el-button-hover-bg-color: color-mix(in srgb, var(--el-color-primary) 16%, transparent);
  --el-button-hover-border-color: var(--el-color-primary);
  --el-button-hover-text-color: var(--el-color-primary);
}
.lead-table-primary-toolbar :deep(.lead-table-toolbar-action--primary.el-button) {
  --el-button-bg-color: var(--el-color-primary);
  --el-button-border-color: var(--el-color-primary);
  --el-button-text-color: #ffffff;
  --el-button-hover-bg-color: var(--el-color-primary-light-3);
  --el-button-hover-border-color: var(--el-color-primary-light-3);
}
</style>
