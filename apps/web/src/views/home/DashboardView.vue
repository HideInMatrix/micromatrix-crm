<script setup lang="ts">
import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  type FilterCondition,
  type FollowUpPlanVO,
  type HomeAnalyticsVO,
  type HomeDepartmentNode,
  type HomeStatisticRequest,
  type NotificationVO,
} from '@micromatrix/shared'
import {
  Bell,
  Building2,
  CalendarClock,
  CheckCheck,
  ClipboardCheck,
  ContactRound,
  FileCheck2,
  MessageSquareText,
  Plus,
  RefreshCw,
  Settings2,
  Target,
} from 'lucide-vue-next'
import { ElButton } from 'element-plus'
import type { Component } from 'vue'
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { approvalApi } from '@/api/approvals'
import { changePassword } from '@/api/auth'
import { listCustomerOptions } from '@/api/customers'
import { homeApi } from '@/api/home'
import { extractErrorMessage } from '@/api/http'
import { followUpPlanApi, leadApi } from '@/api/sales'
import { notificationApi } from '@/api/system'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import FollowUpPlanDialog from '@/components/follow-plans/FollowUpPlanDialog.vue'
import EChart from '@/components/EChart.vue'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import { storeHomeFilter } from '@/utils/home-filter'

const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()
const router = useRouter()

const departmentTree = ref<HomeDepartmentNode[]>([])
const activeDeptId = ref('SELF')
const searchType = ref<HomeStatisticRequest['searchType']>('SELF')
const selectedDeptIds = ref<string[]>([])
const statisticLoading = ref(false)
const analytics = ref<HomeAnalyticsVO | null>(null)

const hasLeadRead = computed(() => auth.hasPerm('menu:lead'))
const hasCustomerRead = computed(() => auth.hasPerm('menu:customer'))

interface DepartmentSelectNode {
  value: string
  label: string
  children?: DepartmentSelectNode[]
}

function toDepartmentSelectNodes(nodes: HomeDepartmentNode[]): DepartmentSelectNode[] {
  return nodes.map((node) => ({
    value: node.id,
    label: node.name,
    ...(node.children?.length ? { children: toDepartmentSelectNodes(node.children) } : {}),
  }))
}

const departmentOptions = computed<DepartmentSelectNode[]>(() => [
  { value: 'SELF', label: '本人' },
  ...toDepartmentSelectNodes(departmentTree.value),
])

function flattenDepartmentIds(nodes: HomeDepartmentNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...flattenDepartmentIds(node.children ?? [])])
}

function findDepartment(nodes: HomeDepartmentNode[], id: string): HomeDepartmentNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const child = findDepartment(node.children ?? [], id)
    if (child) return child
  }
  return null
}

async function loadDepartmentTree() {
  try {
    const { data } = await homeApi.departmentTree()
    departmentTree.value = data
    if (!data.length) {
      activeDeptId.value = 'SELF'
      searchType.value = 'SELF'
      selectedDeptIds.value = []
      return
    }
    activeDeptId.value = data[0].id
    if (data.length === 1) {
      searchType.value = 'ALL'
      selectedDeptIds.value = flattenDepartmentIds(data)
    } else {
      searchType.value = 'DEPARTMENT'
      selectedDeptIds.value = flattenDepartmentIds([data[0]])
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDepartmentChange(value: string) {
  if (value === 'SELF') {
    searchType.value = 'SELF'
    selectedDeptIds.value = []
  } else {
    const node = findDepartment(departmentTree.value, value)
    const firstRootId = departmentTree.value[0]?.id
    searchType.value =
      value === firstRootId && departmentTree.value.length === 1 ? 'ALL' : 'DEPARTMENT'
    selectedDeptIds.value = node ? flattenDepartmentIds([node]) : []
  }
  await loadStatistics()
}

function statisticRequest(): HomeStatisticRequest {
  return {
    searchType: searchType.value,
    deptIds: selectedDeptIds.value,
  }
}

async function loadStatistics() {
  statisticLoading.value = true
  try {
    if (!hasLeadRead.value) {
      analytics.value = null
      return
    }
    const { data } = await homeApi.analytics(statisticRequest())
    analytics.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    statisticLoading.value = false
  }
}

function openLeadAnalytics(options: {
  filters?: FilterCondition[]
  leadStageKey?: string
  converted?: boolean
  overdue?: boolean
} = {}) {
  if (!hasLeadRead.value) return
  const key = storeHomeFilter({
    module: 'lead',
    searchType: searchType.value,
    deptIds: selectedDeptIds.value,
    userField: 'OWNER',
    ...options,
  })
  void router.push({ path: '/leads', query: { homeFilter: key } })
}

function openCustomerAnalytics(filters: FilterCondition[] = []) {
  if (!hasCustomerRead.value) return
  const key = storeHomeFilter({
    module: 'customer',
    searchType: searchType.value,
    deptIds: selectedDeptIds.value,
    filters,
  })
  void router.push({ path: '/customers', query: { homeFilter: key } })
}

const resultSummaryFilters = computed<FilterCondition[]>(() => {
  const config = analytics.value?.config
  const field = config?.customerResultField
  if (!field) return []
  if (config.customerResultValues.length === 0) return [{ key: field.key, op: 'notEmpty' }]
  return [
    {
      key: field.key,
      op: config.customerResultValues.length === 1 ? 'eq' : 'in',
      value:
        config.customerResultValues.length === 1
          ? config.customerResultValues[0]
          : config.customerResultValues,
    },
  ]
})

const resultLabel = computed(
  () => analytics.value?.config.customerResultField?.label ?? '业务结果',
)

const funnelOption = computed<Record<string, unknown>>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c}' },
  series: [
    {
      type: 'funnel',
      left: '8%',
      right: '8%',
      top: 12,
      bottom: 12,
      sort: 'none',
      label: { formatter: '{b}  {c}' },
      data: (analytics.value?.funnel ?? []).map((item) => ({
        name: item.name,
        value: item.count,
        stageKey: item.stageKey,
      })),
    },
  ],
}))

const trendOption = computed<Record<string, unknown>>(() => {
  const trend = analytics.value?.trend
  const series: Array<Record<string, unknown>> = [
    { name: '新增线索', type: 'line', smooth: true, data: trend?.leads ?? [] },
  ]
  if (trend?.results) {
    series.push({
      name: analytics.value?.config.customerResultField?.label ?? '业务结果',
      type: 'line',
      smooth: true,
      data: trend.results,
    })
  }
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: series.map((item) => item.name) },
    grid: { left: 40, right: 20, top: 42, bottom: 30, containLabel: true },
    xAxis: { type: 'category', data: trend?.months ?? [] },
    yAxis: { type: 'value', minInterval: 1 },
    series,
  }
})

const channelOption = computed<Record<string, unknown>>(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: { data: ['线索', '已转客户', resultLabel.value] },
  grid: { left: 32, right: 20, top: 42, bottom: 60, containLabel: true },
  xAxis: {
    type: 'category',
    axisLabel: { interval: 0, rotate: 24 },
    data: (analytics.value?.channels ?? []).map((item) => item.label),
  },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      name: '线索',
      type: 'bar',
      data: (analytics.value?.channels ?? []).map((item) => ({
        value: item.count,
        channelValue: item.value,
      })),
    },
    {
      name: '已转客户',
      type: 'bar',
      data: (analytics.value?.channels ?? []).map((item) => ({
        value: item.convertedCount,
        channelValue: item.value,
      })),
    },
    {
      name: resultLabel.value,
      type: 'bar',
      data: (analytics.value?.channels ?? []).map((item) => ({
        value: item.resultCount,
        channelValue: item.value,
      })),
    },
  ],
}))

const resultOption = computed<Record<string, unknown>>(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: { orient: 'vertical', right: 4, top: 'middle' },
  series: [
    {
      type: 'pie',
      radius: ['38%', '68%'],
      center: ['38%', '50%'],
      data: (analytics.value?.resultDistribution ?? []).map((item) => ({
        name: item.label,
        value: item.count,
        resultValue: item.value,
      })),
    },
  ],
}))

const performanceOption = computed<Record<string, unknown>>(() => ({
  tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
  legend: {
    data: analytics.value?.config.customerResultField
      ? ['线索', '已转客户', resultLabel.value]
      : ['线索', '已转客户'],
  },
  grid: { left: 40, right: 20, top: 42, bottom: 58, containLabel: true },
  xAxis: {
    type: 'category',
    axisLabel: { interval: 0, rotate: 24 },
    data: (analytics.value?.performance ?? []).map((item) => item.ownerName),
  },
  yAxis: { type: 'value', minInterval: 1 },
  series: [
    {
      name: '线索',
      type: 'bar',
      data: (analytics.value?.performance ?? []).map((item) => ({
        value: item.leadCount,
        ownerId: item.ownerId,
      })),
    },
    {
      name: '已转客户',
      type: 'bar',
      data: (analytics.value?.performance ?? []).map((item) => ({
        value: item.convertedCount,
        ownerId: item.ownerId,
      })),
    },
    ...(analytics.value?.config.customerResultField
      ? [
          {
            name: resultLabel.value,
            type: 'bar',
            data: (analytics.value?.performance ?? []).map((item) => ({
              value: item.resultCount,
              ownerId: item.ownerId,
            })),
          },
        ]
      : []),
  ],
}))

function chartDataValue(event: unknown, key: string): string | null {
  if (!event || typeof event !== 'object') return null
  const data = (event as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

function handleFunnelClick(event: unknown) {
  const stageKey = chartDataValue(event, 'stageKey')
  if (stageKey) openLeadAnalytics({ leadStageKey: stageKey })
}

function handleChannelClick(event: unknown) {
  const source = analytics.value?.config.leadSourceField
  const value = chartDataValue(event, 'channelValue')
  if (!source || !value) return
  openLeadAnalytics({
    filters: [
      value === '__EMPTY__'
        ? { key: source.key, op: 'isEmpty' }
        : { key: source.key, op: 'eq', value },
    ],
  })
}

function handleResultClick(event: unknown) {
  const field = analytics.value?.config.customerResultField
  const value = chartDataValue(event, 'resultValue')
  if (field && value) openCustomerAnalytics([{ key: field.key, op: 'eq', value }])
}

function handlePerformanceClick(event: unknown) {
  const ownerId = chartDataValue(event, 'ownerId')
  if (!ownerId) return
  openLeadAnalytics({
    filters: [
      ownerId === '__UNASSIGNED__'
        ? { key: 'owner', op: 'isEmpty' }
        : { key: 'owner', op: 'eq', value: ownerId },
    ],
  })
}

function formatCount(value: number | null | undefined) {
  return (value ?? 0).toLocaleString('zh-CN')
}

function formatAmount(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return `¥${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
}

// ===== 快捷入口 =====

type QuickAccessKey =
  | 'customer'
  | 'contact'
  | 'lead'
  | 'followRecord'
  | 'followPlan'

interface QuickAccessItem {
  key: QuickAccessKey
  label: string
  icon: Component
  permissions: string[]
  moduleEnabled: () => boolean
}

function hasAnyPermission(permissions: string[]) {
  return permissions.some((permission) => auth.hasPerm(permission))
}

const quickAccessCatalog = computed<QuickAccessItem[]>(() => {
  const catalog: QuickAccessItem[] = [
    {
      key: 'customer',
      label: '新建客户',
      icon: Building2,
      permissions: ['customer:create'],
      moduleEnabled: () => moduleConfig.isEnabled('customer'),
    },
    {
      key: 'contact',
      label: '新建联系人',
      icon: ContactRound,
      permissions: ['contact:create'],
      moduleEnabled: () => moduleConfig.isEnabled('customer'),
    },
    {
      key: 'lead',
      label: '新建线索',
      icon: Target,
      permissions: ['lead:create'],
      moduleEnabled: () => moduleConfig.isEnabled('lead'),
    },
    {
      key: 'followRecord',
      label: '新建跟进记录',
      icon: MessageSquareText,
      permissions: ['customer:update', 'lead:update'],
      moduleEnabled: () => moduleConfig.isEnabled('customer') || moduleConfig.isEnabled('lead'),
    },
    {
      key: 'followPlan',
      label: '新建跟进计划',
      icon: CalendarClock,
      permissions: ['customer:update', 'lead:update'],
      moduleEnabled: () => moduleConfig.isEnabled('customer') || moduleConfig.isEnabled('lead'),
    },
  ]
  return catalog.filter((item) => item.moduleEnabled() && hasAnyPermission(item.permissions))
})

const quickAccessKeys = ref<QuickAccessKey[]>([])
const quickAccessDraft = ref<QuickAccessKey[]>([])
const quickAccessDialogVisible = ref(false)

function quickAccessStorageKey() {
  return `micromatrix:home-quick-access:${auth.user?.id ?? 'anonymous'}`
}

function loadQuickAccess() {
  let saved: QuickAccessKey[] = []
  try {
    const raw = localStorage.getItem(quickAccessStorageKey())
    if (raw) saved = JSON.parse(raw) as QuickAccessKey[]
  } catch {
    localStorage.removeItem(quickAccessStorageKey())
  }
  const allowed = new Set(quickAccessCatalog.value.map((item) => item.key))
  const valid = saved.filter((key) => allowed.has(key)).slice(0, 5)
  quickAccessKeys.value = valid.length
    ? valid
    : quickAccessCatalog.value.slice(0, 1).map((item) => item.key)
}

const displayedQuickAccess = computed(() =>
  quickAccessKeys.value
    .map((key) => quickAccessCatalog.value.find((item) => item.key === key))
    .filter((item): item is QuickAccessItem => !!item),
)

const availableQuickAccess = computed(() =>
  quickAccessCatalog.value.filter((item) => !quickAccessDraft.value.includes(item.key)),
)

function openQuickAccessSettings() {
  quickAccessDraft.value = [...quickAccessKeys.value]
  quickAccessDialogVisible.value = true
}

function addQuickAccess(key: QuickAccessKey) {
  if (quickAccessDraft.value.length >= 5) {
    ElMessage.warning('快捷入口最多选择 5 个')
    return
  }
  quickAccessDraft.value.push(key)
}

function removeQuickAccess(key: QuickAccessKey) {
  if (quickAccessDraft.value.length <= 1) {
    ElMessage.warning('快捷入口至少保留 1 个')
    return
  }
  quickAccessDraft.value = quickAccessDraft.value.filter((item) => item !== key)
}

function saveQuickAccess() {
  if (!quickAccessDraft.value.length) return
  quickAccessKeys.value = [...quickAccessDraft.value]
  localStorage.setItem(quickAccessStorageKey(), JSON.stringify(quickAccessKeys.value))
  quickAccessDialogVisible.value = false
}

function routeCreate(path: string) {
  void router.push({ path, query: { create: '1', from: 'home' } })
}

function handleQuickAccess(key: QuickAccessKey) {
  if (key === 'customer') return routeCreate('/customers')
  if (key === 'contact') return routeCreate('/contacts')
  if (key === 'lead') return routeCreate('/leads')
  if (key === 'followRecord') return openFollowTargetDialog()
  followPlanDialogVisible.value = true
}

// ===== 我的计划 =====

const plansLoading = ref(false)
const plans = ref<FollowUpPlanVO[]>([])
const followPlanDialogVisible = ref(false)

async function loadPlans() {
  plansLoading.value = true
  try {
    const { data } = await followUpPlanApi.list({ page: 1, pageSize: 8, mine: true })
    plans.value = data.items
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    plansLoading.value = false
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

// ===== 审批 =====

const approvalCounts = reactive({ pending: 0, handled: 0, mine: 0, copied: 0 })

async function loadApprovalCounts() {
  if (!auth.hasPerm('menu:approval')) return
  try {
    const [pending, handled, mine, copied] = await Promise.all([
      approvalApi.myPending({ page: 1, pageSize: 1 }),
      approvalApi.myHandled({ page: 1, pageSize: 1 }),
      approvalApi.myApplications({ page: 1, pageSize: 1 }),
      approvalApi.myCopied({ page: 1, pageSize: 1 }),
    ])
    approvalCounts.pending = pending.data.total
    approvalCounts.handled = handled.data.total
    approvalCounts.mine = mine.data.total
    approvalCounts.copied = copied.data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

const approvalItems = computed(() => [
  { key: 'pending', label: '待我审批', count: approvalCounts.pending, icon: ClipboardCheck },
  { key: 'handled', label: '我处理的', count: approvalCounts.handled, icon: CheckCheck },
  { key: 'mine', label: '我发起的', count: approvalCounts.mine, icon: Plus },
  { key: 'copied', label: '抄送我的', count: approvalCounts.copied, icon: FileCheck2 },
])

function openApproval(key: string) {
  void router.push({ path: '/approvals', query: { tab: key } })
}

// ===== 消息 =====

const notifications = ref<NotificationVO[]>([])
const notificationsLoading = ref(false)

async function loadNotifications() {
  notificationsLoading.value = true
  try {
    const { data } = await notificationApi.list({ page: 1, pageSize: 8 })
    notifications.value = data.items
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    notificationsLoading.value = false
  }
}

async function openNotification(item: NotificationVO) {
  try {
    if (!item.readAt) await notificationApi.markRead(item.id)
  } catch {
    // 阅读状态失败不阻断业务跳转。
  }
  if (item.link?.startsWith('/')) await router.push(item.link)
  else await router.push('/notifications')
}

// ===== 默认密码 =====

const passwordDialogVisible = ref(false)
const passwordSaving = ref(false)
const passwordForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' })
let defaultPasswordMessage: { close: () => void } | null = null

function showDefaultPasswordMessage() {
  if (!auth.user?.defaultPwd || defaultPasswordMessage) return
  defaultPasswordMessage = ElMessage({
    type: 'warning',
    showClose: true,
    duration: 0,
    message: h('span', { class: 'flex items-center' }, [
      '当前账号仍在使用默认密码，建议尽快修改以保护账号安全。',
      h(
        ElButton,
        {
          link: true,
          type: 'primary',
          class: '!ml-2',
          onClick: () => {
            passwordDialogVisible.value = true
          },
        },
        () => '修改密码',
      ),
    ]),
    onClose: () => {
      defaultPasswordMessage = null
    },
  })
}

async function savePassword() {
  if (passwordForm.newPassword.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    ElMessage.warning('两次输入的新密码不一致')
    return
  }
  passwordSaving.value = true
  try {
    await changePassword({
      oldPassword: passwordForm.oldPassword,
      newPassword: passwordForm.newPassword,
    })
    await auth.fetchMe(true)
    passwordDialogVisible.value = false
    passwordForm.oldPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
    defaultPasswordMessage?.close()
    ElMessage.success('密码修改成功')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    passwordSaving.value = false
  }
}

// ===== 跟进记录快捷创建 =====

type FollowTargetType = 'lead' | 'customer'
const followTargetDialogVisible = ref(false)
const followDrawerVisible = ref(false)
const followTargetLoading = ref(false)
const followTarget = reactive({ type: 'customer' as FollowTargetType, id: '', name: '' })
const followTargetOptions = ref<Array<{ id: string; name: string }>>([])

async function loadFollowTargets() {
  followTargetLoading.value = true
  followTarget.id = ''
  followTarget.name = ''
  try {
    if (followTarget.type === 'customer') {
      const { data } = await listCustomerOptions()
      followTargetOptions.value = data
    } else {
      const { data } = await leadApi.list({ page: 1, pageSize: 100, scope: 'mine' })
      followTargetOptions.value = data.items.map((item) => ({ id: item.id, name: item.name }))
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    followTargetLoading.value = false
  }
}

function openFollowTargetDialog() {
  followTargetDialogVisible.value = true
  void loadFollowTargets()
}

function confirmFollowTarget() {
  const item = followTargetOptions.value.find((option) => option.id === followTarget.id)
  if (!item) {
    ElMessage.warning('请选择跟进对象')
    return
  }
  followTarget.name = item.name
  followTargetDialogVisible.value = false
  followDrawerVisible.value = true
}

const pageLoading = ref(true)

onMounted(async () => {
  showDefaultPasswordMessage()
  try {
    await Promise.all([
      moduleConfig.load(),
      loadDepartmentTree(),
      loadPlans(),
      loadApprovalCounts(),
      loadNotifications(),
    ])
    loadQuickAccess()
    await loadStatistics()
  } finally {
    pageLoading.value = false
  }
})

onBeforeUnmount(() => {
  defaultPasswordMessage?.close()
})
</script>

<template>
  <div v-loading="pageLoading" class="w-full min-w-[1000px]" data-testid="home-page">
    <el-card shadow="never" class="mb-4">
      <div class="mb-4 flex items-center justify-between gap-4">
        <div>
          <div class="text-base font-semibold">业务工作台</div>
          <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
            指标按当前用户数据范围计算；阶段、渠道和业务结果均来自可配置字段。
          </div>
        </div>
        <div class="dashboard-overview-actions flex items-center gap-2">
          <el-tree-select
            v-model="activeDeptId"
            :data="departmentOptions"
            check-strictly
            filterable
            class="!w-60"
            @change="handleDepartmentChange"
          />
          <el-button
            v-if="auth.hasPerm('system:module')"
            data-testid="home-analytics-settings"
            @click="router.push('/system/sales-settings')"
          >
            <Settings2 :size="16" aria-hidden="true" />
          </el-button>
          <el-button
            data-testid="home-overview-refresh"
            :loading="statisticLoading"
            @click="loadStatistics"
          >
            <RefreshCw :size="16" aria-hidden="true" />
          </el-button>
        </div>
      </div>

      <div v-loading="statisticLoading" class="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <button
          type="button"
          class="min-h-[106px] cursor-pointer rounded-[6px] border border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] p-4 text-left"
          @click="openLeadAnalytics()"
        >
          <div class="text-sm text-[var(--el-text-color-secondary)]">线索总量</div>
          <div class="mt-3 text-2xl font-semibold text-[var(--el-color-primary)]">
            {{ formatCount(analytics?.summary.totalLeads) }}
          </div>
        </button>

        <button
          type="button"
          class="min-h-[106px] cursor-pointer rounded-[6px] border border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] p-4 text-left"
          @click="openLeadAnalytics({ converted: true })"
        >
          <div class="text-sm text-[var(--el-text-color-secondary)]">已转客户</div>
          <div class="mt-3 text-2xl font-semibold text-[var(--el-color-primary)]">
            {{ formatCount(analytics?.summary.convertedLeads) }}
          </div>
        </button>

        <button
          type="button"
          class="min-h-[106px] cursor-pointer rounded-[6px] border border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] p-4 text-left"
          @click="openLeadAnalytics({ converted: true })"
        >
          <div class="text-sm text-[var(--el-text-color-secondary)]">转化率</div>
          <div class="mt-3 text-2xl font-semibold">
            {{ analytics?.summary.conversionRate ?? 0 }}%
          </div>
        </button>

        <button
          type="button"
          class="min-h-[106px] cursor-pointer rounded-[6px] border border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] p-4 text-left"
          @click="openLeadAnalytics({ overdue: true })"
        >
          <div class="text-sm text-[var(--el-text-color-secondary)]">超时未跟进</div>
          <div class="mt-3 text-2xl font-semibold text-[var(--el-color-danger)]">
            {{ formatCount(analytics?.summary.overdueLeads) }}
          </div>
        </button>

        <button
          v-if="analytics?.config.customerResultField"
          type="button"
          class="min-h-[106px] cursor-pointer rounded-[6px] border border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] p-4 text-left"
          @click="openCustomerAnalytics(resultSummaryFilters)"
        >
          <div class="text-sm text-[var(--el-text-color-secondary)]">{{ resultLabel }}人数</div>
          <div class="mt-3 text-2xl font-semibold text-[var(--el-color-primary)]">
            {{ formatCount(analytics?.summary.resultCustomers) }}
          </div>
        </button>

        <button
          v-if="analytics?.config.customerResultAmountField"
          type="button"
          class="min-h-[106px] cursor-pointer rounded-[6px] border border-[var(--el-border-color-lighter)] bg-[var(--el-bg-color)] p-4 text-left"
          @click="openCustomerAnalytics(resultSummaryFilters)"
        >
          <div class="text-sm text-[var(--el-text-color-secondary)]">{{ resultLabel }}金额</div>
          <div class="mt-3 text-2xl font-semibold">
            {{ formatAmount(analytics?.summary.resultAmount) }}
          </div>
        </button>
      </div>
    </el-card>

    <div class="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <el-card shadow="never">
        <div class="mb-2 font-semibold">阶段漏斗</div>
        <EChart :option="funnelOption" height="320px" @chart-click="handleFunnelClick" />
      </el-card>
      <el-card shadow="never">
        <div class="mb-2 font-semibold">近 6 个月趋势</div>
        <EChart :option="trendOption" height="320px" />
      </el-card>
    </div>

    <div class="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <el-card shadow="never">
        <div class="mb-2 flex items-center justify-between">
          <span class="font-semibold">渠道统计</span>
          <span class="text-xs text-[var(--el-text-color-secondary)]">
            {{ analytics?.config.leadSourceField?.label ?? '未配置渠道字段' }}
          </span>
        </div>
        <EChart
          v-if="analytics?.config.leadSourceField"
          :option="channelOption"
          height="340px"
          @chart-click="handleChannelClick"
        />
        <el-empty v-else description="请在业务设置中选择线索渠道字段" :image-size="60" />
      </el-card>

      <el-card shadow="never">
        <div class="mb-2 font-semibold">人员绩效</div>
        <EChart
          :option="performanceOption"
          height="340px"
          @chart-click="handlePerformanceClick"
        />
      </el-card>
    </div>

    <el-card
      v-if="analytics?.config.customerResultField"
      shadow="never"
      class="mb-4"
    >
      <div class="mb-2 flex items-center justify-between">
        <span class="font-semibold">{{ resultLabel }}分布</span>
        <span class="text-xs text-[var(--el-text-color-secondary)]">
          {{ analytics?.config.customerResultField?.label }}
        </span>
      </div>
      <EChart :option="resultOption" height="300px" @chart-click="handleResultClick" />
    </el-card>


    <div class="grid grid-cols-[minmax(0,1fr)_400px] items-stretch gap-4">
      <div class="min-w-0">
        <el-card v-if="quickAccessCatalog.length" shadow="never" class="mb-4">
          <div class="mb-4 flex items-center justify-between font-semibold">
            <span>快捷入口</span>
            <el-button data-testid="home-quick-settings" link @click="openQuickAccessSettings">
              <Settings2 :size="15" aria-hidden="true" />自定义
            </el-button>
          </div>
          <div class="flex min-h-24 items-center justify-around gap-4">
            <button
              v-for="item in displayedQuickAccess"
              :key="item.key"
              type="button"
              class="flex w-[116px] cursor-pointer flex-col items-center gap-2 border-0 bg-transparent p-2 text-[var(--el-text-color-primary)]"
              :data-testid="`home-quick-${item.key}`"
              @click="handleQuickAccess(item.key)"
            >
              <span
                class="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
                ><component :is="item.icon" :size="28"
              /></span>
              <span>{{ item.label }}</span>
            </button>
          </div>
        </el-card>

        <el-card shadow="never" class="min-h-[330px]">
          <div class="mb-3 flex items-center justify-between font-semibold">
            <span>我的计划</span>
            <el-button link @click="router.push({ path: '/follow-plans', query: { mine: '1' } })"
              >查看更多</el-button
            >
          </div>
          <div v-loading="plansLoading" class="max-h-[390px] overflow-auto">
            <button
              v-for="plan in plans"
              :key="plan.id"
              type="button"
              class="flex w-full cursor-pointer items-center gap-4 border-0 border-b border-[var(--el-border-color-lighter)] bg-transparent py-3 text-[var(--el-text-color-primary)] last:border-b-0"
              @click="router.push({ path: '/follow-plans', query: { id: plan.id, mine: '1' } })"
            >
              <div class="min-w-0 flex-1 text-left">
                <div class="flex items-center gap-2">
                  <span class="font-medium truncate">{{ plan.targetName }}</span>
                  <el-tag size="small" type="info">{{
                    FOLLOW_UP_PLAN_STATUS_LABELS[plan.status]
                  }}</el-tag>
                </div>
                <div class="mt-1 text-sm text-[var(--el-text-color-secondary)] truncate">
                  {{ plan.content }}
                </div>
              </div>
              <div class="flex-none text-xs text-[var(--el-text-color-secondary)]">
                {{ formatDate(plan.estimatedAt) }}
              </div>
            </button>
            <el-empty
              v-if="!plansLoading && plans.length === 0"
              description="暂无跟进计划"
              :image-size="60"
            />
          </div>
        </el-card>
      </div>

      <div class="flex min-w-0 flex-col gap-4">
        <el-card v-if="auth.hasPerm('menu:approval')" shadow="never">
          <div class="mb-4 flex items-center justify-between font-semibold">
            <span>我的待办</span>
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-2">
            <button
              v-for="item in approvalItems"
              :key="item.key"
              type="button"
              class="flex h-[42px] cursor-pointer items-center gap-2 rounded-[4px] border-0 bg-[var(--el-fill-color-light)] p-2 text-[var(--el-text-color-primary)]"
              :data-testid="`home-approval-${item.key}`"
              @click="openApproval(item.key)"
            >
              <span
                class="inline-flex h-[25px] w-[25px] items-center justify-center rounded-md bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
                ><component :is="item.icon" :size="16"
              /></span>
              <span class="flex-1 text-left">{{ item.label }}</span>
              <strong class="text-[var(--el-color-primary)]">{{ item.count }}</strong>
            </button>
          </div>
        </el-card>

        <el-card shadow="never" class="flex-1">
          <div class="mb-2 flex items-center justify-between font-semibold">
            <span>消息通知</span>
            <el-button link @click="router.push('/notifications')">查看更多</el-button>
          </div>
          <div v-loading="notificationsLoading" class="max-h-[470px] overflow-auto">
            <button
              v-for="item in notifications"
              :key="item.id"
              type="button"
              class="relative flex w-full cursor-pointer items-center gap-2 border-0 border-b border-[var(--el-border-color-lighter)] bg-transparent py-[11px] text-[var(--el-text-color-primary)] last:border-b-0"
              @click="openNotification(item)"
            >
              <span
                v-if="!item.readAt"
                class="absolute top-2.5 -left-1.5 h-1.5 w-1.5 rounded-full bg-[var(--el-color-danger)]"
              />
              <span
                class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
                ><Bell :size="15"
              /></span>
              <span class="min-w-0 flex-1 text-left">
                <span class="block truncate font-medium">{{ item.title }}</span>
                <span class="mt-1 block truncate text-xs text-[var(--el-text-color-secondary)]">
                  {{ item.content || '查看详情' }}
                </span>
              </span>
              <span class="text-xs text-[var(--el-text-color-secondary)] whitespace-nowrap">
                {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}
              </span>
            </button>
            <el-empty
              v-if="!notificationsLoading && notifications.length === 0"
              description="暂无消息"
              :image-size="56"
            />
          </div>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="quickAccessDialogVisible" title="自定义快捷入口" width="620px">
      <div class="text-sm text-[var(--el-text-color-secondary)] mb-4">
        至少选择 1 个，最多选择 5 个。
      </div>
      <div class="font-medium mb-3">已选功能</div>
      <div class="mb-6 grid grid-cols-4 gap-3">
        <button
          v-for="key in quickAccessDraft"
          :key="key"
          type="button"
          class="relative flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-[var(--el-border-color)] bg-[var(--el-bg-color)] p-2.5 text-[var(--el-text-color-primary)]"
          @click="removeQuickAccess(key)"
        >
          <component :is="quickAccessCatalog.find((item) => item.key === key)?.icon" :size="24" />
          <span>{{ quickAccessCatalog.find((item) => item.key === key)?.label }}</span>
          <span
            class="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--el-color-danger)] text-white"
            >−</span
          >
        </button>
      </div>
      <div class="font-medium mb-3">待添加功能</div>
      <div class="grid grid-cols-4 gap-3">
        <button
          v-for="item in availableQuickAccess"
          :key="item.key"
          type="button"
          class="relative flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-[var(--el-border-color)] bg-[var(--el-bg-color)] p-2.5 text-[var(--el-text-color-primary)]"
          @click="addQuickAccess(item.key)"
        >
          <component :is="item.icon" :size="24" />
          <span>{{ item.label }}</span>
          <span
            class="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--el-color-success)] text-white"
            >+</span
          >
        </button>
      </div>
      <template #footer>
        <el-button @click="quickAccessDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveQuickAccess">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="passwordDialogVisible" title="修改密码" width="460px">
      <el-form label-width="92px">
        <el-form-item label="原密码" required>
          <el-input
            v-model="passwordForm.oldPassword"
            type="password"
            show-password
            autocomplete="current-password"
          />
        </el-form-item>
        <el-form-item label="新密码" required>
          <el-input
            v-model="passwordForm.newPassword"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
        <el-form-item label="确认密码" required>
          <el-input
            v-model="passwordForm.confirmPassword"
            type="password"
            show-password
            autocomplete="new-password"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="savePassword">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="followTargetDialogVisible" title="选择跟进对象" width="520px">
      <el-form label-width="86px">
        <el-form-item label="对象类型">
          <el-radio-group v-model="followTarget.type" @change="loadFollowTargets">
            <el-radio-button value="customer">客户</el-radio-button>
            <el-radio-button value="lead">线索</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="业务对象" required>
          <el-select
            v-model="followTarget.id"
            :loading="followTargetLoading"
            filterable
            class="w-full"
            placeholder="请选择"
          >
            <el-option
              v-for="item in followTargetOptions"
              :key="item.id"
              :label="item.name"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="followTargetDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmFollowTarget">下一步</el-button>
      </template>
    </el-dialog>

    <FollowUpDrawer
      v-model="followDrawerVisible"
      :target-type="followTarget.type"
      :target-id="followTarget.id || null"
      :target-name="followTarget.name"
    />

    <FollowUpPlanDialog v-model="followPlanDialogVisible" @saved="loadPlans" />

  </div>
</template>
<style scoped>
.dashboard-overview-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
