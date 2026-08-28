<script setup lang="ts">
import type { DepartmentVO } from '@micromatrix/shared'
import {
  ChevronDown,
  ExternalLink,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Star,
} from 'lucide-vue-next'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  dashboardApi,
  type DashboardPageInput,
  type DashboardTreeNode,
  type DashboardVO,
} from '@/api/dashboard'
import { extractErrorMessage } from '@/api/http'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import DashboardFormDialog from './dashboard/DashboardFormDialog.vue'
import DashboardPreview from './dashboard/DashboardPreview.vue'

type DropType = 'before' | 'after' | 'inner'
type AllowDropType = 'prev' | 'next' | 'inner'
type TreeNodeLike = { data: unknown }

const auth = useAuthStore()
const refs = useFieldRefs()

const treeLoading = ref(false)
const tableLoading = ref(false)
const treeData = ref<DashboardTreeNode[]>([])
const moduleCounts = ref<Record<string, number>>({})
const activeKey = ref('all')
const activeNode = ref<DashboardTreeNode>()
const treeKeyword = ref('')
const tableKeyword = ref('')
const treeRef = ref<{
  filter: (value: string) => void
  setCurrentKey: (key?: string) => void
}>()

const rows = ref<DashboardVO[]>([])
const tableState = reactive({
  current: 1,
  pageSize: 20,
  total: 0,
  sort: undefined as DashboardPageInput['sort'],
})

const formVisible = ref(false)
const editingDashboardId = ref<string>()
const formDefaultModuleId = ref<string>()

const canCreate = computed(() => auth.hasPerm('dashboard:create'))
const canUpdate = computed(() => auth.hasPerm('dashboard:update'))
const canDelete = computed(() => auth.hasPerm('dashboard:delete'))

const favoriteMode = computed(() => activeKey.value === 'favorite')
const allMode = computed(() => activeKey.value === 'all')
const previewMode = computed(() => activeNode.value?.type === 'DASHBOARD')

const contentTitle = computed(() => {
  if (favoriteMode.value) return '我的收藏'
  if (allMode.value) return '全部仪表板'
  return activeNode.value?.name ?? '仪表板'
})

const activeFavorite = computed(() => Boolean(activeNode.value?.myCollect))

function flattenDepartments(nodes: DepartmentVO[], result: Array<{ label: string; value: string }>) {
  for (const node of nodes) {
    result.push({ label: `部门：${node.name}`, value: node.id })
    if (node.children?.length) flattenDepartments(node.children, result)
  }
}

const scopeOptions = computed(() => {
  const options = refs.members.value.map((member) => ({
    label: `成员：${member.name}`,
    value: member.id,
  }))
  flattenDepartments(refs.deptTree.value, options)
  return options
})

function findNode(nodes: DashboardTreeNode[], id: string): DashboardTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findNode(node.children ?? [], id)
    if (child) return child
  }
  return undefined
}

function collectModuleIds(node: DashboardTreeNode) {
  const ids: string[] = []
  const walk = (current: DashboardTreeNode) => {
    if (current.type === 'MODULE') ids.push(current.id)
    for (const child of current.children ?? []) {
      if (child.type === 'MODULE') walk(child)
    }
  }
  walk(node)
  return ids
}

function firstModule(nodes = treeData.value): DashboardTreeNode | undefined {
  for (const node of nodes) {
    if (node.type === 'MODULE') return node
    const child = firstModule(node.children ?? [])
    if (child) return child
  }
  return undefined
}

function moduleIdsForTable() {
  if (allMode.value || favoriteMode.value || activeNode.value?.type !== 'MODULE') return undefined
  return collectModuleIds(activeNode.value)
}

async function refreshTree() {
  treeLoading.value = true
  try {
    const [{ data: tree }, { data: counts }] = await Promise.all([
      dashboardApi.tree(),
      dashboardApi.count(),
    ])
    treeData.value = tree
    moduleCounts.value = counts
    if (!['all', 'favorite'].includes(activeKey.value)) {
      const refreshed = findNode(tree, activeKey.value)
      if (refreshed) activeNode.value = refreshed
      else {
        activeKey.value = 'all'
        activeNode.value = undefined
      }
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    treeLoading.value = false
  }
}

async function loadTable() {
  if (previewMode.value) return
  tableLoading.value = true
  try {
    const payload: DashboardPageInput = {
      current: tableState.current,
      pageSize: tableState.pageSize,
      keyword: tableKeyword.value.trim() || undefined,
      dashboardModuleIds: moduleIdsForTable(),
      sort: tableState.sort,
    }
    const { data } = favoriteMode.value
      ? await dashboardApi.collectPage(payload)
      : await dashboardApi.page(payload)
    rows.value = data.list
    tableState.total = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    tableLoading.value = false
  }
}

async function refreshCurrent() {
  await refreshTree()
  if (!previewMode.value) await loadTable()
}

async function selectSpecial(key: 'all' | 'favorite') {
  activeKey.value = key
  activeNode.value = undefined
  treeRef.value?.setCurrentKey(undefined)
  tableState.current = 1
  await loadTable()
}

async function selectNode(node: DashboardTreeNode) {
  activeKey.value = node.id
  activeNode.value = node
  if (node.type === 'MODULE') {
    tableState.current = 1
    await loadTable()
  }
}

function asDashboardNode(data: unknown) {
  return data as DashboardTreeNode
}

function filterTree(value: string, data: unknown) {
  if (!value) return true
  return asDashboardNode(data).name.toLocaleLowerCase().includes(value.toLocaleLowerCase())
}

watch(treeKeyword, (value) => treeRef.value?.filter(value))

async function addModule(parentId = 'NONE') {
  if (!canCreate.value) return
  try {
    const { value } = await ElMessageBox.prompt('请输入文件夹名称', '新建文件夹', {
      inputPattern: /\S+/,
      inputErrorMessage: '文件夹名称不能为空',
      inputValidator: (input) => (input.length <= 255 ? true : '名称不能超过 255 个字符'),
      confirmButtonText: '创建',
    })
    await dashboardApi.addModule({ name: value.trim(), parentId })
    ElMessage.success('文件夹已创建')
    await refreshTree()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function renameModule(node: DashboardTreeNode) {
  if (!canUpdate.value) return
  try {
    const { value } = await ElMessageBox.prompt('请输入新的文件夹名称', '重命名文件夹', {
      inputValue: node.name,
      inputPattern: /\S+/,
      inputErrorMessage: '文件夹名称不能为空',
      inputValidator: (input) => (input.length <= 255 ? true : '名称不能超过 255 个字符'),
    })
    await dashboardApi.renameModule({ id: node.id, name: value.trim() })
    ElMessage.success('文件夹已重命名')
    await refreshTree()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeModule(node: DashboardTreeNode) {
  if (!canDelete.value) return
  try {
    await ElMessageBox.confirm(`确定删除文件夹「${node.name}」？`, '删除文件夹', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    })
    await dashboardApi.deleteModules([node.id])
    ElMessage.success('文件夹已删除')
    if (activeKey.value === node.id) {
      activeKey.value = 'all'
      activeNode.value = undefined
    }
    await refreshCurrent()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

function openCreate(moduleId?: string) {
  const target = moduleId ? findNode(treeData.value, moduleId) : undefined
  const folder = target?.type === 'MODULE' ? target : firstModule()
  if (!folder) {
    ElMessage.warning('请先创建仪表板文件夹')
    return
  }
  editingDashboardId.value = undefined
  formDefaultModuleId.value = folder.id
  formVisible.value = true
}

function openEdit(id: string) {
  editingDashboardId.value = id
  formDefaultModuleId.value = undefined
  formVisible.value = true
}

async function renameDashboard(node: DashboardTreeNode | DashboardVO) {
  if (!canUpdate.value) return
  const moduleId = 'dashboardModuleId' in node ? node.dashboardModuleId : node.parentId
  try {
    const { value } = await ElMessageBox.prompt('请输入新的仪表板名称', '重命名仪表板', {
      inputValue: node.name,
      inputPattern: /\S+/,
      inputErrorMessage: '仪表板名称不能为空',
      inputValidator: (input) => (input.length <= 255 ? true : '名称不能超过 255 个字符'),
    })
    await dashboardApi.rename({ id: node.id, dashboardModuleId: moduleId, name: value.trim() })
    ElMessage.success('仪表板已重命名')
    await refreshCurrent()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeDashboard(node: DashboardTreeNode | DashboardVO) {
  if (!canDelete.value) return
  try {
    await ElMessageBox.confirm(`确定删除仪表板「${node.name}」？`, '删除仪表板', {
      type: 'warning',
      confirmButtonText: '删除',
      confirmButtonClass: 'el-button--danger',
    })
    await dashboardApi.remove(node.id)
    ElMessage.success('仪表板已删除')
    if (activeKey.value === node.id) {
      const parentId = 'dashboardModuleId' in node ? node.dashboardModuleId : node.parentId
      const parent = findNode(treeData.value, parentId)
      activeKey.value = parent?.id ?? 'all'
      activeNode.value = parent
    }
    await refreshCurrent()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function toggleFavorite(id: string, collected: boolean) {
  try {
    if (collected) await dashboardApi.unCollect(id)
    else await dashboardApi.collect(id)
    ElMessage.success(collected ? '已取消收藏' : '已收藏')
    await refreshCurrent()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await refreshTree()
  }
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function handleNodeCommand(node: DashboardTreeNode, command: string) {
  if (command === 'addModule') await addModule(node.id)
  else if (command === 'addDashboard') openCreate(node.id)
  else if (command === 'editDashboard') openEdit(node.id)
  else if (command === 'rename') {
    if (node.type === 'MODULE') await renameModule(node)
    else await renameDashboard(node)
  } else if (command === 'delete') {
    if (node.type === 'MODULE') await removeModule(node)
    else await removeDashboard(node)
  }
}

function allowDrag(node: TreeNodeLike) {
  const data = asDashboardNode(node.data)
  return canUpdate.value && ['MODULE', 'DASHBOARD'].includes(data.type)
}

function allowDrop(dragging: TreeNodeLike, drop: TreeNodeLike, type: AllowDropType) {
  if (!canUpdate.value) return false
  const draggingData = asDashboardNode(dragging.data)
  const dropData = asDashboardNode(drop.data)
  if (draggingData.type === 'MODULE' && dropData.type === 'DASHBOARD') return false
  if (type === 'inner' && dropData.type === 'DASHBOARD') return false
  if (draggingData.type === 'DASHBOARD' && dropData.type === 'MODULE') return type === 'inner'
  return true
}

async function handleNodeDrop(dragging: TreeNodeLike, drop: TreeNodeLike, type: DropType) {
  const draggingData = asDashboardNode(dragging.data)
  const dropData = asDashboardNode(drop.data)
  try {
    if (draggingData.type === 'MODULE') {
      await dashboardApi.moveModule({
        dragNodeId: draggingData.id,
        dropNodeId: dropData.type === 'DASHBOARD' ? dropData.parentId : dropData.id,
        dropPosition: type === 'inner' ? 0 : type === 'before' ? -1 : 1,
      })
    } else if (dropData.type === 'MODULE') {
      await dashboardApi.move({
        moveId: draggingData.id,
        targetId: draggingData.id,
        dashboardModuleId: dropData.id,
        moveMode: 'APPEND',
      })
    } else {
      await dashboardApi.move({
        moveId: draggingData.id,
        targetId: dropData.id,
        dashboardModuleId: dropData.parentId,
        moveMode: type === 'before' ? 'BEFORE' : 'AFTER',
      })
    }
    ElMessage.success('排序已更新')
    await refreshCurrent()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await refreshTree()
  }
}

async function onSortChange({
  prop,
  order,
}: {
  prop: string | null
  order: 'ascending' | 'descending' | null
}) {
  const sortMap: Record<string, NonNullable<DashboardPageInput['sort']>['name']> = {
    name: 'name',
    dashboardModuleName: 'dashboard_module_name',
    createUserName: 'create_user_name',
    createTime: 'create_time',
  }
  tableState.sort =
    order && prop && sortMap[prop]
      ? { name: sortMap[prop], type: order === 'ascending' ? 'asc' : 'desc' }
      : undefined
  tableState.current = 1
  await loadTable()
}

async function handleTableCommand(row: unknown, command: string) {
  const dashboard = row as DashboardVO
  if (command === 'rename') await renameDashboard(dashboard)
  else if (command === 'delete') await removeDashboard(dashboard)
}

function formatTime(value: number) {
  return value ? new Date(value).toLocaleString() : '-'
}

async function onFormSaved() {
  await refreshCurrent()
}

onMounted(async () => {
  try {
    await Promise.all([refs.load(), refreshTree()])
    await selectSpecial('all')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
})
</script>

<template>
  <div
    class="grid h-[calc(100vh-92px)] min-h-[640px] grid-cols-[300px_minmax(0,1fr)] overflow-hidden rounded-t border border-[var(--el-border-color)] bg-[var(--el-bg-color)]"
    data-testid="dashboard-page"
  >
    <aside class="flex min-h-0 flex-col border-r border-[var(--el-border-color)]">
      <div class="space-y-2 p-4 pb-3">
        <el-input v-model="treeKeyword" clearable placeholder="按名称搜索">
          <template #prefix><Search :size="15" /></template>
        </el-input>

        <button
          type="button"
          class="dashboard-fixed-node"
          :class="{ 'dashboard-fixed-node--active': favoriteMode }"
          data-testid="dashboard-favorite-node"
          @click="selectSpecial('favorite')"
        >
          <span class="flex min-w-0 items-center gap-2"><Star :size="16" />我的收藏</span>
          <span>{{ moduleCounts.myCollect ?? 0 }}</span>
        </button>
      </div>

      <div class="border-y border-[var(--el-border-color)] px-4 py-2">
        <button
          type="button"
          class="dashboard-fixed-node"
          :class="{ 'dashboard-fixed-node--active': allMode }"
          data-testid="dashboard-all-node"
          @click="selectSpecial('all')"
        >
          <span class="flex min-w-0 items-center gap-2"><Folder :size="16" />全部</span>
          <el-button v-if="canCreate" link type="primary" title="新建文件夹" @click.stop="addModule('NONE')">
            <FolderPlus :size="16" />
          </el-button>
        </button>
      </div>

      <div v-loading="treeLoading" class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <el-tree
          ref="treeRef"
          :data="treeData"
          node-key="id"
          :props="{ label: 'name', children: 'children' }"
          highlight-current
          default-expand-all
          draggable
          :allow-drag="allowDrag"
          :allow-drop="allowDrop"
          :filter-node-method="filterTree"
          @node-click="selectNode"
          @node-drop="handleNodeDrop"
        >
          <template #default="{ data }">
            <div class="group flex min-w-0 flex-1 items-center justify-between gap-2 pr-1">
              <div class="flex min-w-0 items-center gap-2">
                <el-button
                  v-if="data.type === 'DASHBOARD'"
                  link
                  :type="data.myCollect ? 'warning' : 'default'"
                  class="!m-0 !p-0"
                  @click.stop="toggleFavorite(data.id, Boolean(data.myCollect))"
                >
                  <Star :size="15" :fill="data.myCollect ? 'currentColor' : 'none'" />
                </el-button>
                <Folder v-else :size="15" class="shrink-0 text-[var(--el-text-color-secondary)]" />
                <span class="truncate">{{ data.name }}</span>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <span v-if="data.type === 'MODULE'" class="text-xs text-[var(--el-text-color-secondary)]">
                  {{ moduleCounts[data.id] ?? 0 }}
                </span>
                <el-dropdown
                  v-if="canCreate || canUpdate || canDelete"
                  trigger="click"
                  @command="(command: string) => handleNodeCommand(data, command)"
                >
                  <el-button link class="opacity-0 group-hover:opacity-100" @click.stop>
                    <MoreHorizontal :size="16" />
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <template v-if="data.type === 'MODULE'">
                        <el-dropdown-item v-if="canCreate" command="addDashboard">新建仪表板</el-dropdown-item>
                        <el-dropdown-item v-if="canCreate" command="addModule">新建子文件夹</el-dropdown-item>
                      </template>
                      <el-dropdown-item
                        v-if="data.type === 'DASHBOARD' && canUpdate"
                        command="editDashboard"
                      >
                        编辑
                      </el-dropdown-item>
                      <el-dropdown-item v-if="canUpdate" command="rename">重命名</el-dropdown-item>
                      <el-dropdown-item v-if="canDelete" command="delete" divided>删除</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>
        </el-tree>
      </div>
    </aside>

    <main class="min-h-0 min-w-0">
      <DashboardPreview
        v-if="previewMode && activeNode"
        :dashboard-id="activeNode.id"
        :title="activeNode.name"
        :favorite="activeFavorite"
        :can-edit="canUpdate"
        @toggle-favorite="toggleFavorite(activeNode.id, activeFavorite)"
        @edit="openEdit(activeNode.id)"
      />

      <div v-else class="flex h-full min-h-0 flex-col">
        <div class="flex h-16 shrink-0 items-center justify-between border-b border-[var(--el-border-color)] px-5">
          <div class="min-w-0">
            <div class="truncate font-medium">{{ contentTitle }}</div>
            <div class="mt-0.5 text-xs text-[var(--el-text-color-secondary)]">
              {{ favoriteMode ? '仅显示当前账号收藏且仍有权限查看的仪表板' : '文件夹会包含其所有子文件夹中的仪表板' }}
            </div>
          </div>
          <div class="flex items-center gap-2">
            <el-button v-if="canCreate" type="primary" @click="openCreate(activeNode?.type === 'MODULE' ? activeNode.id : undefined)">
              <Plus :size="16" />
              新建仪表板
            </el-button>
            <el-input
              v-model="tableKeyword"
              clearable
              placeholder="按名称搜索"
              class="!w-60"
              @keyup.enter="tableState.current = 1; loadTable()"
              @clear="tableState.current = 1; loadTable()"
            >
              <template #prefix><Search :size="15" /></template>
            </el-input>
            <el-button @click="tableState.current = 1; loadTable()">搜索</el-button>
            <el-button circle title="刷新" @click="refreshCurrent"><RefreshCw :size="16" /></el-button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden p-5 pb-2">
          <el-table
            v-loading="tableLoading"
            :data="rows"
            row-key="id"
            height="100%"
            @sort-change="onSortChange"
          >
            <el-table-column prop="name" label="名称" min-width="220" fixed sortable="custom">
              <template #default="{ row }">
                <div class="flex min-w-0 items-center gap-2">
                  <el-button
                    link
                    :type="row.myCollect ? 'warning' : 'default'"
                    class="!m-0 !p-0"
                    @click="toggleFavorite(row.id, row.myCollect)"
                  >
                    <Star :size="16" :fill="row.myCollect ? 'currentColor' : 'none'" />
                  </el-button>
                  <el-button link type="primary" class="min-w-0" @click="openExternal(row.resourceUrl)">
                    <span class="truncate">{{ row.name }}</span>
                    <ExternalLink :size="13" class="ml-1 shrink-0" />
                  </el-button>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="240" show-overflow-tooltip>
              <template #default="{ row }">{{ row.description || '-' }}</template>
            </el-table-column>
            <el-table-column
              prop="dashboardModuleName"
              label="文件夹"
              min-width="150"
              sortable="custom"
              show-overflow-tooltip
            />
            <el-table-column label="成员范围" min-width="220">
              <template #default="{ row }">
                <span v-if="!row.members.length" class="text-[var(--el-text-color-secondary)]">全部成员</span>
                <div v-else class="flex flex-wrap gap-1">
                  <el-tag v-for="member in row.members" :key="`${member.type}-${member.id}`" size="small" effect="plain">
                    {{ member.name }}
                  </el-tag>
                </div>
              </template>
            </el-table-column>
            <el-table-column
              prop="createUserName"
              label="创建人"
              width="130"
              sortable="custom"
              show-overflow-tooltip
            />
            <el-table-column prop="createTime" label="创建时间" width="190" sortable="custom">
              <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
            </el-table-column>
            <el-table-column v-if="canUpdate || canDelete" label="操作" width="145" fixed="right">
              <template #default="{ row }">
                <el-button v-if="canUpdate" link type="primary" @click="openEdit(row.id)">编辑</el-button>
                <el-dropdown trigger="click" @command="(command: string) => handleTableCommand(row, command)">
                  <el-button link type="primary">
                    更多<ChevronDown :size="14" />
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item v-if="canUpdate" command="rename">重命名</el-dropdown-item>
                      <el-dropdown-item v-if="canDelete" command="delete" divided>删除</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <div class="flex h-14 shrink-0 items-center justify-end px-5">
          <el-pagination
            v-model:current-page="tableState.current"
            v-model:page-size="tableState.pageSize"
            :total="tableState.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="total, sizes, prev, pager, next, jumper"
            @current-change="loadTable"
            @size-change="tableState.current = 1; loadTable()"
          />
        </div>
      </div>
    </main>

    <DashboardFormDialog
      v-model="formVisible"
      :dashboard-id="editingDashboardId"
      :default-module-id="formDefaultModuleId"
      :folder-tree="treeData"
      :scope-options="scopeOptions"
      @saved="onFormSaved"
    />
  </div>
</template>

<style scoped>
.dashboard-fixed-node {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-radius: 4px;
  padding: 0 8px;
  color: var(--el-text-color-regular);
  font-size: 14px;
  text-align: left;
}

.dashboard-fixed-node:hover,
.dashboard-fixed-node--active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}

:deep(.el-tree-node__content) {
  height: 34px;
  border-radius: 4px;
}

:deep(.el-tree--highlight-current .el-tree-node.is-current > .el-tree-node__content) {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
}
</style>
