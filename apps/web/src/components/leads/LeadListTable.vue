<script setup lang="ts">
import { computed, ref } from 'vue'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import type { FieldVO, LeadStageConfig, LeadVO } from '@micromatrix/shared'

type LeadSystemColumn = {
  key: 'status' | 'lastFollowedAt'
  label: string
  listWidth: number
  systemColumn: true
}
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  items: LeadVO[]
  loading: boolean
  isPoolMode: boolean
  canExport: boolean
  canManualConvert: boolean
  listColumns: (FieldVO | LeadSystemColumn)[]
  leadStages: LeadStageConfig[]
  memberMap: Map<string, string>
  deptMap: Map<string, string>
  total: number
  page: number
  pageSize: number
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
  selectionChange: [rows: LeadVO[]]
  stageChange: [row: LeadVO, stageKey: string]
  openOverview: [row: LeadVO]
  claim: [row: LeadVO]
  assign: [row: LeadVO]
  remove: [row: LeadVO]
  edit: [row: LeadVO]
  follow: [row: LeadVO]
  convert: [row: LeadVO]
  toPool: [row: LeadVO]
  pageChange: []
  sizeChange: []
}>()

const auth = useAuthStore()
const tableRef = ref<{ clearSelection: () => void } | null>(null)

function clearSelection() {
  tableRef.value?.clearSelection()
}

defineExpose({ clearSelection })
const paginationLocale = {
  ...zhCn,
  el: {
    ...zhCn.el,
    pagination: { ...zhCn.el.pagination, goto: '跳转到' },
  },
}
const currentPage = computed({
  get: () => props.page,
  set: (value: number) => emit('update:page', value),
})
const currentPageSize = computed({
  get: () => props.pageSize,
  set: (value: number) => emit('update:pageSize', value),
})
const stageByKey = computed(() => new Map(props.leadStages.map((stage) => [stage.key, stage])))
function leadStageLabel(stageKey: string) {
  return stageByKey.value.get(stageKey)?.name ?? stageKey
}
function leadStageTagType(stageKey: string): 'primary' | 'success' | 'info' {
  const kind = stageByKey.value.get(stageKey)?.kind
  if (kind === 'SUCCESS') return 'success'
  if (kind === 'FAILURE') return 'info'
  return 'primary'
}
function handleSelectionChange(rows: LeadVO[]) {
  emit('selectionChange', rows)
}
function handleStageChange(row: LeadVO, key: string) {
  emit('stageChange', row, key)
}
function openOverview(row: LeadVO) {
  emit('openOverview', row)
}
function handleClaim(row: LeadVO) {
  emit('claim', row)
}
function handleAssign(row: LeadVO) {
  emit('assign', row)
}
function handleDelete(row: LeadVO) {
  emit('remove', row)
}
function openEdit(row: LeadVO) {
  emit('edit', row)
}
function openFollow(row: LeadVO) {
  emit('follow', row)
}
function openConvert(row: LeadVO) {
  emit('convert', row)
}
function handleToPool(row: LeadVO) {
  emit('toPool', row)
}
</script>

<template>
  <div class="lead-list-table">
    <el-table
      ref="tableRef"
      v-loading="loading"
      :data="items"
      height="100%"
      row-key="id"
      class="lead-list-table__grid w-full"
      @selection-change="handleSelectionChange"
    >
      <el-table-column
        v-if="
          (!isPoolMode &&
            (canExport ||
              auth.hasPerm('lead:transfer') ||
              auth.hasPerm('lead:recycle') ||
              auth.hasPerm('lead:update') ||
              auth.hasPerm('lead:delete'))) ||
          (isPoolMode &&
            (canExport ||
              auth.hasPerm('leadPool:pick') ||
              auth.hasPerm('leadPool:assign') ||
              auth.hasPerm('leadPool:update') ||
              auth.hasPerm('leadPool:delete')))
        "
        type="selection"
        width="46"
      />
      <el-table-column
        v-for="column in listColumns"
        :key="column.key"
        :label="column.label"
        :min-width="column.listWidth ?? 140"
        show-overflow-tooltip
      >
        <template #default="{ row }">
          <el-button
            v-if="column.key === 'name'"
            link
            type="primary"
            @click="openOverview(row as LeadVO)"
          >
            {{
              formatFieldValue(column as FieldVO, row, {
                memberMap: memberMap,
                deptMap: deptMap,
              })
            }}
          </el-button>
          <template v-else-if="column.key === 'status'">
            <el-select
              v-if="!isPoolMode && auth.hasPerm('lead:update') && !row.transitionId"
              :model-value="row.status"
              size="small"
              class="w-full"
              @change="handleStageChange(row as LeadVO, String($event))"
            >
              <el-option
                v-for="stage in leadStages"
                :key="stage.key"
                :label="stage.name"
                :value="stage.key"
                :disabled="stage.enabled === false"
              />
            </el-select>
            <el-tag v-else :type="leadStageTagType(row.status)" size="small">
              {{ leadStageLabel(row.status) }}
            </el-tag>
          </template>
          <template v-else-if="column.key === 'lastFollowedAt'">
            {{ row.lastFollowedAt ? new Date(row.lastFollowedAt).toLocaleDateString() : '-' }}
          </template>
          <template v-else>
            {{
              formatFieldValue(column as FieldVO, row, {
                memberMap: memberMap,
                deptMap: deptMap,
              })
            }}
          </template>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <template v-if="isPoolMode">
            <el-button
              v-if="auth.hasPerm('leadPool:pick')"
              link
              type="primary"
              @click="handleClaim(row as LeadVO)"
            >
              领取
            </el-button>
            <el-button
              v-if="auth.hasPerm('leadPool:assign')"
              link
              @click="handleAssign(row as LeadVO)"
            >
              分配
            </el-button>
            <el-button
              v-if="auth.hasPerm('leadPool:delete')"
              link
              type="danger"
              @click="handleDelete(row as LeadVO)"
            >
              删除
            </el-button>
          </template>
          <template v-else-if="row.transitionType !== 'CUSTOMER'">
            <el-button v-if="auth.hasPerm('lead:update')" link @click="openEdit(row as LeadVO)">
              编辑
            </el-button>
            <el-button v-if="auth.hasPerm('lead:update')" link @click="openFollow(row as LeadVO)">
              跟进
            </el-button>
            <el-dropdown
              v-if="
                canManualConvert ||
                auth.hasPerm('lead:recycle') ||
                auth.hasPerm('lead:transfer') ||
                auth.hasPerm('lead:delete')
              "
              trigger="click"
            >
              <el-button link>更多</el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-if="canManualConvert" @click="openConvert(row as LeadVO)">
                    转换
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:recycle')"
                    @click="handleToPool(row as LeadVO)"
                  >
                    移入线索池
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:transfer')"
                    @click="handleAssign(row as LeadVO)"
                  >
                    转移
                  </el-dropdown-item>
                  <el-dropdown-item
                    v-if="auth.hasPerm('lead:delete')"
                    :divided="
                      canManualConvert ||
                      auth.hasPerm('lead:recycle') ||
                      auth.hasPerm('lead:transfer')
                    "
                    @click="handleDelete(row as LeadVO)"
                  >
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
    </el-table>

    <div class="lead-list-pagination mt-4 flex justify-center overflow-x-auto">
      <el-config-provider :locale="paginationLocale">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="currentPageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="sizes, total, prev, pager, next, jumper"
          @current-change="emit('pageChange')"
          @size-change="emit('sizeChange')"
        />
      </el-config-provider>
    </div>
  </div>
</template>

<style scoped>
/* el-table 的 height=100% 使用内置滚动容器固定表头；分页始终留在下方。 */
.lead-list-table {
  display: grid;
  flex: 1 1 0;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  min-width: 0;
}

.lead-list-table :deep(.lead-list-table__grid.el-table) {
  min-height: 0;
}

.lead-list-pagination :deep(.el-pagination) {
  --el-pagination-font-size: 14px;
  --el-pagination-button-color: #606266;
  --el-pagination-hover-color: var(--el-color-primary);
  --el-pagination-button-bg-color: transparent;
  --el-pagination-bg-color: transparent;
  justify-content: center;
  gap: 8px;
  color: #606266;
  font-size: 14px;
}

.lead-list-pagination :deep(.el-pager li.is-active) {
  color: var(--el-color-primary);
}

.lead-list-pagination :deep(.el-pagination__jump .el-input) {
  width: 64px;
}

.lead-list-table :deep(.lead-list-table__grid.el-table) {
  --el-table-header-bg-color: #f5f7fa;
  --el-table-header-text-color: #606266;
  --el-table-text-color: #606266;
  font-size: 14px;
}

.lead-list-table :deep(.el-table__header th.el-table__cell) {
  height: 44px;
  padding: 0;
  background-color: #f5f7fa;
  color: #606266;
  font-size: 14px;
}

.lead-list-table :deep(.el-table__body td.el-table__cell),
.lead-list-table :deep(.el-table__body .cell) {
  font-size: 14px;
}

.lead-list-table :deep(.el-table .el-tag),
.lead-list-table :deep(.el-table .el-select__selected-item),
.lead-list-table :deep(.el-pagination) {
  font-size: 14px;
}

.lead-list-table :deep(.el-table .el-button.is-link),
.lead-list-table :deep(.el-table .el-dropdown .el-button.is-link) {
  --el-button-text-color: var(--el-color-primary);
  --el-button-hover-link-text-color: var(--el-color-primary);
  color: var(--el-color-primary);
  font-size: 14px;
}
</style>
