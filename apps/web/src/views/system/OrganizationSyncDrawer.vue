<script setup lang="ts">
import type {
  DepartmentVO,
  OrganizationSyncAction,
  OrganizationSyncBatchVO,
  OrganizationSyncGateVO,
  OrganizationSyncItemVO,
  OrganizationSyncResolution,
} from '@micromatrix/shared'
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { deptApi, memberApi, organizationSyncApi, type MemberOption } from '@/api/system'

const props = defineProps<{
  modelValue: boolean
  targetDepartmentId: string
  targetDepartmentName: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  synced: []
}>()

const loading = ref(false)
const generating = ref(false)
const applying = ref(false)
const resolvingId = ref('')
const gate = ref<OrganizationSyncGateVO | null>(null)
const batches = ref<OrganizationSyncBatchVO[]>([])
const currentBatch = ref<OrganizationSyncBatchVO | null>(null)
const items = ref<OrganizationSyncItemVO[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const resourceType = ref('')
const action = ref('')
const keyword = ref('')
const departments = ref<DepartmentVO[]>([])
const members = ref<MemberOption[]>([])
const resolutions = reactive<
  Record<string, { resolution: OrganizationSyncResolution | ''; localId: string }>
>({})
let pollTimer: ReturnType<typeof setInterval> | null = null

const flatDepartments = computed(() => {
  const result: DepartmentVO[] = []
  const walk = (nodes: DepartmentVO[]) => {
    for (const node of nodes) {
      result.push(node)
      if (node.children?.length) walk(node.children)
    }
  }
  walk(departments.value)
  return result
})

const stage = computed(() => {
  const status = currentBatch.value?.status
  if (!status) return 0
  if (status === 'FETCHING') return 1
  if (status === 'PREVIEW_READY') return currentBatch.value?.counts.conflict ? 2 : 3
  if (status === 'APPLYING') return 3
  return 4
})

const canPreview = computed(
  () =>
    Boolean(props.targetDepartmentId) &&
    !gate.value?.disabledReason &&
    !generating.value &&
    !applying.value,
)
const previewTargetMatches = computed(
  () =>
    !currentBatch.value ||
    currentBatch.value.targetDepartmentId === props.targetDepartmentId,
)
const canApply = computed(
  () =>
    currentBatch.value?.status === 'PREVIEW_READY' &&
    previewTargetMatches.value &&
    currentBatch.value.counts.conflict === 0 &&
    !applying.value,
)

type TagType = 'primary' | 'warning' | 'danger' | 'success' | 'info'

const countCards = computed<Array<{ key: string; label: string; value: number; type: TagType }>>(
  () => {
    const counts = currentBatch.value?.counts
    return [
      { key: 'create', label: '新增', value: counts?.create ?? 0, type: 'primary' },
      { key: 'update', label: '更新', value: counts?.update ?? 0, type: 'warning' },
      { key: 'disable', label: '禁用', value: counts?.disable ?? 0, type: 'danger' },
      { key: 'unchanged', label: '不变', value: counts?.unchanged ?? 0, type: 'success' },
      { key: 'conflict', label: '待处理', value: counts?.conflict ?? 0, type: 'danger' },
      { key: 'skip', label: '跳过', value: counts?.skip ?? 0, type: 'info' },
    ]
  },
)

const actionLabels: Record<OrganizationSyncAction, string> = {
  CREATE: '新增',
  UPDATE: '更新',
  DISABLE: '禁用',
  UNCHANGED: '不变',
  CONFLICT: '冲突',
  SKIP: '跳过',
}

function actionTag(actionValue: OrganizationSyncAction) {
  if (actionValue === 'CREATE') return 'primary'
  if (actionValue === 'UPDATE') return 'warning'
  if (actionValue === 'DISABLE' || actionValue === 'CONFLICT') return 'danger'
  if (actionValue === 'UNCHANGED') return 'success'
  return 'info'
}

function sourceLabel(item: OrganizationSyncItemVO) {
  const name = item.sourceData['name']
  return typeof name === 'string' ? name : item.externalId
}

function changeSummary(item: OrganizationSyncItemVO) {
  if (!item.changes) return item.action === 'UNCHANGED' ? '无变化' : '-'
  return Object.entries(item.changes)
    .slice(0, 3)
    .map(
      ([key, value]) =>
        `${fieldLabel(key)}：${displayValue(value.before)} → ${displayValue(value.after)}`,
    )
    .join('；')
}

function fieldLabel(key: string) {
  return (
    {
      name: '名称',
      sort: '排序',
      parentId: '上级部门',
      deptId: '所属部门',
      position: '职位',
      phone: '手机号',
      status: '状态',
      mappingActive: '外部映射',
    }[key] ?? key
  )
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function formatTime(value: string | null) {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function departmentName(id: string) {
  return flatDepartments.value.find((department) => department.id === id)?.name ?? '未知部门'
}

async function loadBase() {
  loading.value = true
  try {
    const [gateResponse, batchResponse, deptResponse, memberResponse] = await Promise.all([
      organizationSyncApi.status(),
      organizationSyncApi.batches({ page: 1, pageSize: 10 }),
      deptApi.tree(),
      memberApi.options(),
    ])
    gate.value = gateResponse.data
    batches.value = batchResponse.data.items
    departments.value = deptResponse.data
    members.value = memberResponse.data
    const preferred = gateResponse.data.activeBatch ?? gateResponse.data.latestBatch
    if (preferred) {
      currentBatch.value = preferred
      await loadItems()
    } else {
      currentBatch.value = null
      items.value = []
      total.value = 0
    }
    updatePolling()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function loadItems() {
  if (!currentBatch.value) return
  const { data } = await organizationSyncApi.items(currentBatch.value.id, {
    page: page.value,
    pageSize,
    resourceType: resourceType.value || undefined,
    action: action.value || undefined,
    keyword: keyword.value.trim() || undefined,
  })
  items.value = data.items
  total.value = data.total
  for (const item of data.items) {
    resolutions[item.id] = {
      resolution: item.resolution ?? '',
      localId: item.resolvedLocalId ?? item.localId ?? '',
    }
  }
}

async function selectBatch(id: string) {
  const { data } = await organizationSyncApi.batch(id)
  currentBatch.value = data
  page.value = 1
  await loadItems()
}

function applyItemKeyword() {
  page.value = 1
  void loadItems()
}

async function createPreview() {
  generating.value = true
  try {
    if (!props.targetDepartmentId) {
      ElMessage.warning('请先在左侧部门树选择同步目标部门')
      return
    }
    const { data } = await organizationSyncApi.preview({
      targetDepartmentId: props.targetDepartmentId,
    })
    currentBatch.value = data
    ElMessage.success(data.status === 'PREVIEW_READY' ? '同步预览已生成' : '同步预览状态已更新')
    await loadBase()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadBase()
  } finally {
    generating.value = false
  }
}

async function saveResolution(item: OrganizationSyncItemVO) {
  const draft = resolutions[item.id]
  if (!draft?.resolution) {
    ElMessage.warning('请选择处理方式')
    return
  }
  if (draft.resolution === 'BIND' && !draft.localId) {
    ElMessage.warning('请选择要绑定的本地资源')
    return
  }
  resolvingId.value = item.id
  try {
    const { data } = await organizationSyncApi.resolve(currentBatch.value!.id, {
      items: [
        {
          itemId: item.id,
          resolution: draft.resolution,
          ...(draft.resolution === 'BIND' ? { localId: draft.localId } : {}),
        },
      ],
    })
    currentBatch.value = data
    ElMessage.success('冲突处理已保存')
    await loadItems()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    resolvingId.value = ''
  }
}

async function applyPreview() {
  if (!currentBatch.value) return
  const counts = currentBatch.value.counts
  const confirmed = await ElMessageBox.confirm(
    `本次将新增 ${counts.create} 项、更新 ${counts.update} 项、禁用 ${counts.disable} 项。确认按当前预览应用吗？`,
    '应用企业微信组织同步',
    { type: 'warning', confirmButtonText: '确认应用' },
  ).catch(() => false)
  if (!confirmed) return
  applying.value = true
  try {
    const { data } = await organizationSyncApi.apply(currentBatch.value.id)
    currentBatch.value = data
    ElMessage.success('企业微信组织架构同步完成')
    emit('synced')
    await loadBase()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    await loadBase()
  } finally {
    applying.value = false
  }
}

async function pollStatus() {
  if (!props.modelValue) return
  try {
    const { data } = await organizationSyncApi.status()
    gate.value = data
    const next = data.activeBatch ?? data.latestBatch
    if (next && next.id === currentBatch.value?.id && next.status !== currentBatch.value.status) {
      currentBatch.value = next
      await loadItems()
      if (next.status === 'SUCCEEDED') emit('synced')
    }
    updatePolling()
  } catch {
    stopPolling()
  }
}

function updatePolling() {
  const active = gate.value?.activeBatch
  if (active && !pollTimer) pollTimer = setInterval(() => void pollStatus(), 2_000)
  if (!active) stopPolling()
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) void loadBase()
    else stopPolling()
  },
)
watch([resourceType, action], () => {
  page.value = 1
  void loadItems()
})
onBeforeUnmount(stopPolling)
</script>

<template>
  <el-drawer
    :model-value="modelValue"
    title="企业微信同步"
    size="min(760px, 92vw)"
    destroy-on-close
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-loading="loading" class="sync-drawer">
      <el-alert
        v-if="gate?.disabledReason"
        :title="gate.disabledReason"
        type="warning"
        :closable="false"
        show-icon
        class="mb-4"
      />

      <el-alert
        v-else
        :title="`同步到：${targetDepartmentName || '未选择部门'}`"
        description="企业微信可见范围的顶层部门将在该部门下新增或更新，其下级组织按原层级同步；选中部门本身不会被改名、移动或修改排序。"
        type="info"
        :closable="false"
        show-icon
        class="mb-4"
      />

      <el-alert
        v-if="currentBatch && !previewTargetMatches"
        :title="`当前预览属于“${departmentName(currentBatch.targetDepartmentId)}”`"
        description="当前预览与左侧选中的同步目标不一致，不能直接应用。请为当前目标重新生成预览。"
        type="warning"
        :closable="false"
        show-icon
        class="mb-4"
      />

      <div class="sync-toolbar">
        <div>
          <div class="text-sm font-medium">同步批次</div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            先生成差异预览，确认冲突和影响范围后再应用。
          </div>
        </div>
        <div class="flex items-center gap-2">
          <el-select
            v-if="batches.length"
            :model-value="currentBatch?.id"
            class="!w-52"
            placeholder="选择历史批次"
            @change="selectBatch"
          >
            <el-option
              v-for="batchItem in batches"
              :key="batchItem.id"
              :label="`${formatTime(batchItem.createdAt)} · ${departmentName(batchItem.targetDepartmentId)} · ${batchItem.status}`"
              :value="batchItem.id"
            />
          </el-select>
          <el-button
            type="primary"
            plain
            :disabled="!canPreview"
            :loading="generating"
            @click="createPreview"
          >
            生成预览
          </el-button>
        </div>
      </div>

      <el-steps :active="stage" finish-status="success" align-center class="my-5">
        <el-step title="准备" />
        <el-step title="获取数据" />
        <el-step title="处理冲突" />
        <el-step title="应用变更" />
        <el-step title="完成" />
      </el-steps>

      <template v-if="currentBatch">
        <div v-if="currentBatch.errorMessage" class="mb-4">
          <el-alert
            :title="currentBatch.errorMessage"
            :type="currentBatch.status === 'INVALIDATED' ? 'warning' : 'error'"
            :closable="false"
            show-icon
          />
        </div>

        <div class="count-grid">
          <div v-for="card in countCards" :key="card.key" class="count-card">
            <span>{{ card.label }}</span>
            <el-tag :type="card.type" effect="plain">{{ card.value }}</el-tag>
          </div>
        </div>

        <div class="filter-row">
          <el-radio-group v-model="resourceType" size="small">
            <el-radio-button value="">全部资源</el-radio-button>
            <el-radio-button value="DEPARTMENT">部门</el-radio-button>
            <el-radio-button value="USER">成员</el-radio-button>
          </el-radio-group>
          <div class="flex items-center gap-2">
            <el-input
              v-model="keyword"
              clearable
              size="small"
              class="!w-44"
              placeholder="搜索名称 / 外部 ID"
              @keyup.enter="applyItemKeyword"
              @clear="applyItemKeyword"
            />
            <el-select v-model="action" clearable placeholder="全部动作" size="small" class="!w-32">
              <el-option
                v-for="(label, value) in actionLabels"
                :key="value"
                :label="label"
                :value="value"
              />
            </el-select>
          </div>
        </div>

        <el-table :data="items" stripe max-height="430">
          <el-table-column label="资源" min-width="150">
            <template #default="{ row }">
              <div class="font-medium">{{ sourceLabel(row as OrganizationSyncItemVO) }}</div>
              <div class="text-xs text-[var(--el-text-color-secondary)]">
                {{ row.resourceType === 'DEPARTMENT' ? '部门' : '成员' }} · {{ row.externalId }}
              </div>
            </template>
          </el-table-column>
          <el-table-column label="动作" width="82">
            <template #default="{ row }">
              <el-tag :type="actionTag(row.action)" size="small" effect="plain">
                {{ actionLabels[row.action as OrganizationSyncAction] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="字段变化" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">{{
              changeSummary(row as OrganizationSyncItemVO)
            }}</template>
          </el-table-column>
          <el-table-column label="冲突处理" min-width="260">
            <template #default="{ row }">
              <div v-if="row.action === 'CONFLICT'" class="resolution-cell">
                <div class="mb-2 text-xs text-[var(--el-color-danger)]">
                  {{ row.conflictMessage }}
                </div>
                <div class="flex gap-2">
                  <el-select v-model="resolutions[row.id].resolution" class="!w-24" size="small">
                    <el-option label="绑定" value="BIND" />
                    <el-option label="跳过" value="SKIP" />
                  </el-select>
                  <el-select
                    v-if="resolutions[row.id].resolution === 'BIND'"
                    v-model="resolutions[row.id].localId"
                    filterable
                    size="small"
                    class="min-w-0 flex-1"
                    placeholder="选择本地资源"
                  >
                    <el-option
                      v-for="option in row.resourceType === 'DEPARTMENT'
                        ? flatDepartments
                        : members"
                      :key="option.id"
                      :label="option.name"
                      :value="option.id"
                    />
                  </el-select>
                  <el-button
                    type="primary"
                    link
                    :loading="resolvingId === row.id"
                    @click="saveResolution(row as OrganizationSyncItemVO)"
                  >
                    保存
                  </el-button>
                </div>
              </div>
              <span v-else-if="row.resolution === 'BIND'">已绑定本地资源</span>
              <span v-else-if="row.action === 'SKIP'">已跳过</span>
              <span v-else>-</span>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="total > pageSize"
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="prev, pager, next"
          class="mt-4 justify-end"
          @current-change="loadItems"
        />
      </template>

      <el-empty v-else description="尚未生成企业微信组织同步预览" :image-size="72" />
    </div>

    <template #footer>
      <div class="flex justify-between">
        <span class="text-xs text-[var(--el-text-color-secondary)]">
          本地手工成员不会因同步被删除或禁用。
        </span>
        <div class="flex gap-2">
          <el-button @click="emit('update:modelValue', false)">关闭</el-button>
          <el-button type="primary" :disabled="!canApply" :loading="applying" @click="applyPreview">
            应用同步
          </el-button>
        </div>
      </div>
    </template>
  </el-drawer>
</template>

<style scoped>
.sync-drawer {
  min-height: 520px;
}
.sync-toolbar,
.filter-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.count-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 18px;
}
.count-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 10px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  font-size: 13px;
}
.filter-row {
  margin-bottom: 12px;
}
.resolution-cell {
  padding: 4px 0;
}
@media (max-width: 1100px) {
  .count-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
