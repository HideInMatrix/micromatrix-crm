<script setup lang="ts">
import CrmDialog from '@/components/CrmDialog.vue'
import {
  DEFAULT_LEAD_STAGES,
  type LeadVO,
  type LeadStageConfig,
  type FieldVO,
  type HomeLeadStatistic,
  type FilterCondition,
  type HomeAnalyticsVO,
  type HomeAnalyticsWidgetResult,
  type HomeWidgetPeriod,
  type HomeDepartmentNode,
  type HomeStatisticRequest,
  type NotificationVO,
} from '@micromatrix/shared'
import {
  Bell,
  Plus,
  Minus,
  Building2,
  GitPullRequest,
  Layers3,
  Clock3,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Send,
  Database,
  UserRoundPlus,
  SquareCheckBig,
  PieChart,
  CalendarClock,
  CalendarDays,
  BellRing,
  MessageCircleMore,
  ContactRound,
  MessageSquareText,
  RefreshCw,
  Settings2,
} from 'lucide-vue-next'
import { ElButton } from 'element-plus'
import type { Component } from 'vue'
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { changePassword } from '@/api/auth'
import { listCustomerOptions } from '@/api/customers'
import { homeApi } from '@/api/home'
import { extractErrorMessage } from '@/api/http'
import { leadApi } from '@/api/sales'
import { metadataApi } from '@/api/metadata'
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
const widgetLoading = ref(false)
const widgetPeriodSelections = ref<Record<string, HomeWidgetPeriod>>({})
const widgetPeriodOptions: Array<{ label: string; value: HomeWidgetPeriod }> = [
  { label: '近7天', value: '7d' },
  { label: '近30天', value: '30d' },
  { label: '全部时间', value: 'all' },
]
let latestAnalyticsRequest = 0
const todayStatistic = ref<HomeLeadStatistic | null>(null)
const pendingPoolCount = ref(0)
const myLeads = ref<LeadVO[]>([])
const myLeadsTotal = ref(0)
const myLeadsLoading = ref(false)
const leadFields = ref<FieldVO[]>([])
const leadStages = ref<LeadStageConfig[]>([])
const unreadNotifications = ref(0)
const canAccessPool = computed(() => auth.hasPerm('leadPool:read'))
const selectableFields = computed(() => leadFields.value.filter((f) =>
  !f.system && !f.hidden && ['text', 'select', 'radio', 'multiselect'].includes(f.type),
))
const homeLeadColumns = computed(() => {
  const candidates = selectableFields.value
  const professional = candidates.find((f) => /专业|意向/.test(f.label))
  const source = candidates.find((f) => /渠道|来源/.test(f.label) && f.key !== professional?.key)
  const selected = [professional, source].filter((f): f is FieldVO => !!f)
  return [...selected, ...candidates.filter((f) => !selected.some((x) => x.key === f.key))].slice(0, 2)
})
const stageLabel = (stage: string) =>
  leadStages.value.find((entry) => entry.key === stage)?.name
    ?? DEFAULT_LEAD_STAGES.find((entry) => entry.key === stage)?.name
    ?? stage

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

async function loadAnalytics() {
  const sequence = ++latestAnalyticsRequest
  widgetLoading.value = true
  try {
    const { data } = await homeApi.analytics({
      ...statisticRequest(),
      widgetPeriods: { ...widgetPeriodSelections.value },
    })
    // 多次快速切换只保留最后一次请求结果，避免旧响应覆盖新选择。
    if (sequence === latestAnalyticsRequest) analytics.value = data
  } catch (error) {
    if (sequence === latestAnalyticsRequest) ElMessage.error(extractErrorMessage(error))
  } finally {
    if (sequence === latestAnalyticsRequest) widgetLoading.value = false
  }
}

function changeWidgetPeriod(id: string, period: HomeWidgetPeriod) {
  if (!widgetPeriodOptions.some((item) => item.value === period)) return
  widgetPeriodSelections.value = { ...widgetPeriodSelections.value, [id]: period }
  void loadAnalytics()
}

async function loadStatistics() {
  statisticLoading.value = true
  try {
    if (!hasLeadRead.value) {
      analytics.value = null
      return
    }
    const [_, todayResult] = await Promise.all([
      loadAnalytics(),
      homeApi.lead({ ...statisticRequest(), priorPeriodEnable: true }),
    ])
    todayStatistic.value = todayResult.data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    statisticLoading.value = false
  }
}

function openLeadAnalytics(options: {
  searchType?: HomeStatisticRequest['searchType']
  period?: 'TODAY'
  filters?: FilterCondition[]
  leadStageKey?: string
  converted?: boolean
  overdue?: boolean
} = {}) {
  if (!hasLeadRead.value) return
  const key = storeHomeFilter({
    module: 'lead',
    searchType: options.searchType ?? searchType.value,
    deptIds: options.searchType === 'SELF' ? [] : selectedDeptIds.value,
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

function widgetChartOption(widget: HomeAnalyticsWidgetResult): Record<string, unknown> {
  const data = widget.items.map((item) => ({ name: item.label, value: item.count }))
  if (widget.config.chartType === 'bar') {
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 30, right: 20, top: 16, bottom: 54, containLabel: true },
      xAxis: { type: 'category', data: widget.items.map((item) => item.label), axisLabel: { rotate: 20, interval: 0 } },
      yAxis: { type: 'value', minInterval: 1 },
      series: [{ type: 'bar', barMaxWidth: 44, data: widget.items.map((item) => item.count) }],
    }
  }
  const range = widgetPeriodRange(widget.period)
  return {
    color: chartPalette,
    tooltip: {
      trigger: 'item',
      backgroundColor: '#41465D',
      borderWidth: 0,
      padding: [9, 12],
      textStyle: { color: '#FFFFFF', fontSize: 13, lineHeight: 22 },
      formatter: (params: { name: string; value: number; percent: number }) => {
        // 分组名称由用户配置的表单选项生成，插入 HTML Tooltip 前需要转义。
        const label = params.name.replace(/[&<>"']/g, (char) => ({
          '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        })[char] ?? char)
        return `${range}<br/>${label}：${params.value}条 / ${params.percent}%`
      },
    },
    legend: { show: false },
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: '43%',
        style: {
          text: String(widget.total),
          fontSize: 30,
          fontWeight: 700,
          fill: '#1D2639',
          textAlign: 'center',
        },
      },
      {
        type: 'text',
        left: 'center',
        top: '56%',
        style: {
          text: widget.config.module === 'lead' ? '总线索数' : '总客户数',
          fontSize: 13,
          fill: '#96A3B8',
          textAlign: 'center',
        },
      },
    ],
    series: [{
      type: 'pie',
      // 南丁格尔玫瑰图：角度表示占比，半径也随统计数量变化。
      roseType: 'radius',
      radius: ['50%', '83%'],
      center: ['50%', '50%'],
      startAngle: 90,
      stillShowZeroSum: false,
      label: { show: false },
      labelLine: { show: false },
      itemStyle: { borderWidth: 0 },
      emphasis: { scale: true, scaleSize: 5 },
      data,
    }],
  }
}

function widgetPeriodRange(period: HomeWidgetPeriod): string {
  if (period === 'all') return '全部时间'
  const now = new Date()
  const before = new Date(now.getTime() - (period === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000)
  const format = (date: Date) =>
    `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${format(before)}~${format(now)}`
}

function formatCount(value: number | null | undefined) {
  return (value ?? 0).toLocaleString('zh-CN')
}

async function refreshHome() {
  await Promise.all([loadStatistics(), loadMyLeads(), loadPendingPools(), loadNotifications()])
}

function formatPercentage(value: number | null | undefined) {
  if (value === null || value === undefined) return '暂无昨日对比'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function elapsedLabel(value: string | null): string {
  if (!value) return '尚未跟进'
  const delta = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(delta)) return '-'
  if (delta < 0) return '刚刚'
  const hours = Math.floor(delta / 3_600_000)
  if (hours < 1) return '1小时内'
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function leadFieldValue(lead: LeadVO, field: FieldVO): string {
  const raw = lead.customData[field.key]
  if (raw === null || raw === undefined || raw === '') return '-'
  const values = Array.isArray(raw) ? raw : [raw]
  return values.map((value) => field.options?.find((option) => option.value === String(value))?.label
    ?? String(value)).join('、') || '-'
}

async function loadMyLeads() {
  if (!hasLeadRead.value) return
  myLeadsLoading.value = true
  try {
    const [list, form] = await Promise.all([
      leadApi.list({
        page: 1,
        pageSize: 5,
        homeFilter: JSON.stringify({ module: 'lead', searchType: 'SELF', deptIds: [] }),
      }),
      metadataApi.formConfig('lead'),
    ])
    myLeads.value = list.data.items
    myLeadsTotal.value = list.data.total
    leadFields.value = form.data.fields
    leadStages.value = form.data.formProp.leadStages ?? []
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    myLeadsLoading.value = false
  }
}

async function loadPendingPools() {
  if (!canAccessPool.value) return
  try {
    const { data: pools } = await leadApi.poolOptions()
    const counts = await Promise.all(pools.map(async (pool) => {
      const { data } = await leadApi.list({ scope: 'pool', poolId: pool.id, page: 1, pageSize: 1 })
      return data.total
    }))
    pendingPoolCount.value = counts.reduce((sum, count) => sum + count, 0)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openMyLead(lead: LeadVO) {
  void router.push({ path: '/leads', query: { id: lead.id } })
}

function followMyLead(lead: LeadVO) {
  followTarget.type = 'lead'
  followTarget.id = lead.id
  followTarget.name = lead.name
  followDrawerVisible.value = true
}

function openPoolLeads() {
  if (!canAccessPool.value) return
  void router.push('/leads/pool')
}

// ===== 快捷入口 =====

type QuickAccessKey =
  | 'customer'
  | 'contact'
  | 'lead'
  | 'leadImport'
  | 'poolImport'
  | 'followRecord'
  | 'followPlan'

interface QuickAccessItem {
  key: QuickAccessKey
  label: string
  icon: Component
  permissions: string[]
  moduleEnabled: () => boolean
  description?: string
  theme?: 'blue' | 'green' | 'purple'
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
      icon: UserRoundPlus,
      description: '手动创建学生线索',
      theme: 'blue',
      permissions: ['lead:create'],
      moduleEnabled: () => moduleConfig.isEnabled('lead'),
    },
    {
      key: 'leadImport',
      label: '导入线索',
      icon: SquareCheckBig,
      permissions: ['lead:import'],
      moduleEnabled: () => moduleConfig.isEnabled('lead'),
      description: '批量导入学生信息',
      theme: 'green',
    },
    {
      key: 'poolImport',
      label: '导入线索池',
      icon: Database,
      permissions: ['leadPool:import'],
      moduleEnabled: () => moduleConfig.isEnabled('lead') && auth.hasPerm('leadPool:read'),
      description: '从其他渠道导入',
      theme: 'purple',
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
  return `micromatrix:home-quick-access:v2:${auth.user?.id ?? 'anonymous'}`
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
    : (['lead', 'leadImport', 'poolImport'] as QuickAccessKey[])
      .filter((key) => allowed.has(key))
      .concat(quickAccessCatalog.value.map((item) => item.key).filter((key) =>
        !['lead', 'leadImport', 'poolImport'].includes(key),
      )).slice(0, 3)
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
  if (key === 'leadImport') return void router.push({ path: '/leads', query: { import: '1' } })
  if (key === 'poolImport') return void router.push({ path: '/leads/pool', query: { import: '1' } })
  if (key === 'followRecord') return openFollowTargetDialog()
  followPlanDialogVisible.value = true
}

const followPlanDialogVisible = ref(false)

// ===== 消息 =====

const notifications = ref<NotificationVO[]>([])
const notificationsLoading = ref(false)

async function loadNotifications() {
  notificationsLoading.value = true
  try {
    const { data } = await notificationApi.list({ page: 1, pageSize: 8 })
    notifications.value = data.items
    const unread = await notificationApi.unreadCount()
    unreadNotifications.value = unread.data.count
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

const chartPalette = ['#2185FF', '#FFA04B', '#FF684D', '#36CF92', '#85EFA5', '#586AFF', '#A17CED', '#BCC6D7']
const pageLoading = ref(true)

onMounted(async () => {
  showDefaultPasswordMessage()
  try {
    await Promise.all([
      moduleConfig.load(),
      loadDepartmentTree(),
      loadMyLeads(),
      loadPendingPools(),
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
  <div
    v-loading="pageLoading"
    class="min-h-full min-w-[1030px]"
    data-testid="home-page"
  >
    <div class="mb-3 flex items-center justify-end gap-2" data-testid="home-toolbar">
      <el-tree-select
        v-model="activeDeptId"
        :data="departmentOptions"
        check-strictly
        filterable
        class="!w-44"
        @change="handleDepartmentChange"
      />
      <el-button
        data-testid="home-overview-refresh"
        :loading="statisticLoading"
        @click="refreshHome"
      >
        <RefreshCw :size="16" aria-hidden="true" />
      </el-button>
    </div>

    <div class="mb-3 grid grid-cols-3 gap-3" data-testid="home-kpi-row">
      <button
        type="button"
        class="flex min-h-[128px] cursor-pointer items-center gap-5 rounded-[10px] border-0 p-5 text-left shadow-[0_3px_12px_rgba(42,88,149,0.055)]"
        style="background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, #FFFFFF 100%)"
        :disabled="!hasLeadRead"
        data-testid="home-kpi-today"
        @click="openLeadAnalytics({ period: 'TODAY' })"
      >
        <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#EAF4FF] text-[#2687FF]">
          <GitPullRequest :size="35" :stroke-width="2.4" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex flex-col gap-1">
          <span class="text-[16px] text-[#333333]">今日新增线索</span>
          <strong class="text-[32px] leading-9 tabular-nums text-[#171C26] font-[DingBold]">
            {{ formatCount(todayStatistic?.todayClue.value) }}
          </strong>
          <span class="flex items-center gap-1 text-[12px] text-[#6B7A99]">
            较昨日
            <span
              class="inline-flex items-center gap-0.5 font-semibold"
              :class="(todayStatistic?.todayClue.priorPeriodCompareRate ?? 0) > 0
                ? 'text-[#FF4848]'
                : (todayStatistic?.todayClue.priorPeriodCompareRate ?? 0) < 0
                  ? 'text-[#16B87F]' : 'text-[#6B7A99]'"
            >
              <TrendingUp
                v-if="(todayStatistic?.todayClue.priorPeriodCompareRate ?? 0) > 0"
                :size="12"
                :stroke-width="2.5"
                aria-hidden="true"
              />
              <TrendingDown
                v-else-if="(todayStatistic?.todayClue.priorPeriodCompareRate ?? 0) < 0"
                :size="12"
                :stroke-width="2.5"
                aria-hidden="true"
              />
              {{ formatPercentage(todayStatistic?.todayClue.priorPeriodCompareRate) }}
            </span>
          </span>
        </span>
      </button>
      <button
        type="button"
        class="flex min-h-[128px] cursor-pointer items-center gap-5 rounded-[10px] border-0 p-5 text-left shadow-[0_3px_12px_rgba(42,88,149,0.055)]"
        style="background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, #FFFFFF 100%)"
        :disabled="!canAccessPool"
        data-testid="home-kpi-pending"
        @click="openPoolLeads"
      >
        <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#F0EEFF] text-[#8878F6]">
          <Layers3 :size="35" :stroke-width="2.3" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex flex-col gap-1">
          <span class="text-[16px] text-[#333333]">待分配线索</span>
          <strong class="text-[32px] leading-9 tabular-nums text-[#171C26] font-[DingBold]">
            {{ formatCount(pendingPoolCount) }}
          </strong>
          <span aria-hidden="true" class="invisible h-[22px] shrink-0" />
        </span>
      </button>
      <button
        type="button"
        class="flex min-h-[128px] cursor-pointer items-center gap-5 rounded-[10px] border-0 p-5 text-left shadow-[0_3px_12px_rgba(42,88,149,0.055)]"
        style="background: linear-gradient(180deg, rgba(255, 255, 255, 0.5) 0%, #FFFFFF 100%)"
        :disabled="!hasLeadRead"
        data-testid="home-kpi-overdue"
        @click="openLeadAnalytics({ overdue: true })"
      >
        <span class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-[#FEECEC] text-[#F04444]">
          <Clock3 :size="35" :stroke-width="2.4" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex flex-col gap-1">
          <span class="text-[16px] text-[#333333]">超时未跟进</span>
          <strong class="text-[32px] leading-9 tabular-nums text-[#171C26] font-[DingBold]">
            {{ formatCount(analytics?.summary.overdueLeads) }}
          </strong>
          <span class="text-[12px] text-[#6B7A99]">超过未跟进</span>
        </span>
      </button>
    </div>

    <div class="mb-3 grid grid-cols-2 items-stretch gap-3">
      <section class="min-h-[390px] min-w-0 rounded-xl bg-white px-5 py-4" data-testid="home-my-leads">
        <div class="mb-4 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <CalendarClock :size="18" :stroke-width="2.4" class="shrink-0 text-[#2687FF]" aria-hidden="true" />
            <div class="flex items-end gap-2">
              <span class="text-[18px] font-semibold text-[#1D2129]">我的线索</span>
              <span v-if="myLeadsTotal" class="text-[12px] leading-[18px] text-[#8A97AC]">待处理{{ myLeadsTotal }}条</span>
            </div>
          </div>
          <el-button
            link
            type="primary"
            :disabled="!hasLeadRead"
            @click="openLeadAnalytics({ searchType: 'SELF' })"
          >
            查看全部 <ChevronRight :size="15" />
          </el-button>
        </div>
        <div
          v-if="!myLeadsLoading && !myLeads.length"
          class="flex min-h-[315px] flex-col items-center justify-center"
          data-testid="home-my-leads-empty"
        >
          <div class="relative flex h-[142px] w-[174px] items-center justify-center" aria-hidden="true">
            <span class="absolute top-6 right-2 h-3 w-3 rounded-full bg-[#D6FBE7]" />
            <span class="absolute bottom-4 left-1 h-2.5 w-2.5 rounded-full bg-[#B6D0FF]" />
            <div class="relative flex h-[108px] w-[118px] items-center justify-center rounded-[24px] bg-[#EFF5FF]">
              <CalendarDays :size="86" :stroke-width="1.5" class="text-[#5684FF]" />
              <Clock3
                :size="47"
                :stroke-width="1.5"
                class="absolute -right-2 -bottom-2 rounded-full bg-[#EFF5FF] text-[#5684FF]"
              />
            </div>
          </div>
          <div class="mt-4 flex flex-col items-center gap-[5px] text-center">
            <span class="text-[16px] font-medium text-[#000000]">{{ hasLeadRead ? '暂无待跟进线索' : '暂无线索查看权限' }}</span>
            <span class="text-[14px] text-[#8A97AC]">{{ hasLeadRead ? '新的跟进任务会显示在这里' : '请联系管理员开通线索查看权限' }}</span>
          </div>
        </div>
        <el-table
          v-else
          v-loading="myLeadsLoading"
          :data="myLeads"
          size="small"
          class="!w-full"
          :header-cell-style="{ background: '#F5F7FA', color: '#666666', fontSize: '14px', height: '42px', fontWeight: 500 }"
          :cell-style="{ height: '43px', color: '#344054', fontSize: '14px' }"
          :empty-text="hasLeadRead ? '暂无属于我的线索' : '暂无线索查看权限'"
          data-testid="home-my-leads-table"
        >
          <el-table-column prop="name" label="学员姓名" min-width="112" show-overflow-tooltip>
            <template #default="{ row }">
              <el-button link type="primary" class="!text-[14px] !text-[#1580FF]" @click="openMyLead(row as LeadVO)">{{ row.name }}</el-button>
            </template>
          </el-table-column>
          <el-table-column label="手机号" min-width="117">
            <template #default="{ row }">{{ row.phone || '-' }}</template>
          </el-table-column>
          <el-table-column
            v-for="field in homeLeadColumns"
            :key="field.key"
            :label="field.label"
            min-width="100"
            show-overflow-tooltip
          >
            <template #default="{ row }">{{ leadFieldValue(row as LeadVO, field) }}</template>
          </el-table-column>
          <el-table-column label="当前状态" min-width="94" show-overflow-tooltip>
            <template #default="{ row }">
              <el-tag size="small" type="warning" effect="light" class="!text-[12px]">{{ stageLabel(row.status) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最近跟进" min-width="85">
            <template #default="{ row }">
              <span class="text-[14px] text-[#F04438]">
                {{ elapsedLabel(row.lastFollowedAt) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" min-width="82" align="center">
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :disabled="!auth.hasPerm('lead:update')"
                class="!text-[14px] !text-[#1580FF]"
                @click="followMyLead(row as LeadVO)"
              >立即跟进</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="min-h-[390px] min-w-0 rounded-xl bg-white px-5 py-4" data-testid="home-message-center">
        <div class="mb-4 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Bell :size="18" class="shrink-0 text-[#2687FF]" :stroke-width="2.4" aria-hidden="true" />
            <span class="text-[18px] font-semibold text-[#1D2129]">消息中心</span>
            <span v-if="unreadNotifications" class="text-xs text-[#A7B2C5]">未读消息 {{ unreadNotifications }} 条</span>
          </div>
          <el-button link type="primary" @click="router.push('/notifications')">
            查看全部 <ChevronRight :size="15" />
          </el-button>
        </div>
        <div
          v-loading="notificationsLoading"
          class="flex max-h-[315px] flex-col gap-[8px] overflow-y-auto"
          data-testid="home-message-list"
        >
          <button
            v-for="item in notifications.slice(0, 5)"
            :key="item.id"
            type="button"
            class="flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-[#F6F8FB] px-3 py-2 text-left transition-colors hover:bg-[#EEF3FD]"
            @click="openNotification(item)"
          >
            <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#E8F3FF] text-[#2788FF]">
              <Bell :size="21" aria-hidden="true" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13px] font-semibold text-[#434B5B]">
                <span v-if="!item.readAt" class="mr-1 text-[#F05150]">[未读]</span>{{ item.title }}
              </span>
              <span class="mt-1 block truncate text-xs text-[#8893A3]">{{ item.content || '查看消息详情' }}</span>
            </span>
            <span class="shrink-0 text-right text-xs text-[#A3AEC1]">
              <span class="block">{{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}</span>
              <span class="mt-1 block text-[#2687FF]">{{ item.readAt ? '查看详情' : '标为已读' }}</span>
            </span>
          </button>
          <div
            v-if="!notificationsLoading && !notifications.length"
            class="flex min-h-[315px] flex-col items-center justify-center"
            data-testid="home-message-empty"
          >
            <div class="relative flex h-[142px] w-[174px] items-center justify-center" aria-hidden="true">
              <span class="absolute top-5 left-3 h-4 w-4 rounded-full bg-[#D6FBE7]" />
              <span class="absolute top-10 right-2 h-3 w-3 rounded-full bg-[#C9D9FF]" />
              <BellRing :size="110" :stroke-width="1.4" class="text-[#5684FF]" />
              <MessageCircleMore
                :size="57"
                :stroke-width="1.4"
                class="absolute right-0 bottom-3 rounded-[16px] bg-[#EAF1FF] text-[#5684FF]"
              />
            </div>
            <div class="mt-4 flex flex-col items-center gap-[5px] text-center">
              <span class="text-[16px] font-medium text-[#000000]">暂无新消息</span>
              <span class="text-[14px] text-[#8A97AC]">有新动态时会及时通知你</span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <div class="grid grid-cols-2 items-stretch gap-3" data-testid="home-bottom-grid">
      <section class="min-w-0 rounded-xl bg-white px-5 py-4" data-testid="home-quick-access">
        <div class="mb-4 flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Send :size="18" class="shrink-0 text-[#2687FF]" aria-hidden="true" />
            <span class="text-[18px] font-semibold text-[#1D2129]">快捷入口</span>
          </div>
          <el-button v-if="quickAccessCatalog.length" link data-testid="home-quick-settings" @click="openQuickAccessSettings">
            <Settings2 :size="15" class="mr-1" aria-hidden="true" />自定义
          </el-button>
        </div>
        <div class="grid min-h-[256px] grid-cols-3 gap-3">
          <div
            v-for="item in displayedQuickAccess"
            :key="item.key"
            class="flex min-w-0 flex-col items-center justify-center rounded-xl border px-3 py-7 text-center"
            :class="item.theme === 'green'
              ? 'border-[#D9F4E9] bg-[#F0FBF7]'
              : item.theme === 'purple'
                ? 'border-[#EAE2FF] bg-[#F7F4FF]'
                : 'border-[#E7EEFF] bg-[#F3F6FF]'"
            :data-testid="`home-quick-${item.key}`"
          >
            <span
              class="flex h-15 w-15 items-center justify-center rounded-full"
              :class="item.theme === 'green'
                ? 'bg-[#DDF9EE] text-[#1CB785]'
                : item.theme === 'purple'
                  ? 'bg-[#EEE4FF] text-[#8B61F6]'
                  : 'bg-[#E5ECFF] text-[#5379F9]'"
            >
              <component :is="item.icon" :size="30" :stroke-width="2" aria-hidden="true" />
            </span>
            <div class="mt-[22px] flex min-w-0 flex-col items-center gap-2">
              <div class="text-[16px] font-semibold leading-[24px] text-[#1D2939]">{{ item.label }}</div>
              <div class="max-w-full truncate text-[12px] font-normal leading-[18px] text-[#8A97AC]">{{ item.description || '快速进入相关功能' }}</div>
            </div>
            <el-button
              class="mt-7 !h-[36px] !w-[96px] !rounded-[4px] !border !border-solid !bg-white !px-[20px] !py-[8px] !text-[14px] !font-medium !leading-[18px]"
              :class="item.theme === 'green'
                ? '!border-[#CDF1E3] !text-[#1CB785]'
                : item.theme === 'purple'
                  ? '!border-[#E7DCFF] !text-[#8B61F6]'
                  : '!border-[#DCE5FF] !text-[#4C6FFF]'"
              :data-testid="`home-quick-action-${item.key}`"
              @click="handleQuickAccess(item.key)"
            >{{ item.key === 'lead' || item.key === 'customer' ? '立即创建' : item.key.includes('Import') ? '选择文件' : '立即进入' }}</el-button>
          </div>
          <div v-if="!displayedQuickAccess.length" class="col-span-3 flex items-center justify-center text-sm text-[#99A4B4]">
            当前账号暂无可用快捷操作
          </div>
        </div>
      </section>

      <section
        v-for="widget in analytics?.widgets ?? []"
        :key="widget.config.id"
        class="min-w-0 rounded-xl bg-white px-5 py-4"
        :data-testid="`home-statistic-widget-${widget.config.id}`"
      >
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <PieChart :size="18" class="shrink-0 text-[#2687FF]" aria-hidden="true" />
            <span class="truncate text-[18px] font-semibold text-[#1D2129]">{{ widget.config.title }}</span>
          </div>
          <el-select
            :model-value="widgetPeriodSelections[widget.config.id] ?? widget.period"
            class="!w-28 shrink-0"
            size="small"
            :loading="widgetLoading"
            :data-testid="`home-widget-period-${widget.config.id}`"
            aria-label="统计时间范围"
            @change="changeWidgetPeriod(widget.config.id, $event)"
          >
            <el-option
              v-for="option in widgetPeriodOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </el-select>
        </div>
        <template v-if="widget.total > 0">
          <div v-if="widget.config.chartType === 'list'" class="max-h-[255px] space-y-4 overflow-y-auto py-3">
            <div v-for="item in widget.items" :key="item.value" class="flex items-center gap-3">
              <span class="w-28 shrink-0 truncate text-[13px] text-[#647087]" :title="item.label">{{ item.label }}</span>
              <el-progress class="min-w-0 flex-1" :show-text="false" :percentage="Math.round(item.count * 100 / widget.total)" />
              <span class="w-12 text-right text-[13px] tabular-nums">{{ item.count }}条</span>
            </div>
          </div>
          <div v-else-if="widget.config.chartType === 'donut'" class="grid grid-cols-[minmax(0,1.1fr)_minmax(135px,0.9fr)] items-center gap-3">
            <EChart :option="widgetChartOption(widget)" height="260px" />
            <div class="max-h-[260px] space-y-3 overflow-y-auto pr-2" data-testid="home-rose-legend">
              <div
                v-for="(item, index) in widget.items"
                :key="item.value"
                class="flex min-w-0 items-center gap-2 text-[13px]"
              >
                <span
                  class="h-2.5 w-2.5 shrink-0 rounded-full"
                  :style="{ backgroundColor: chartPalette[index % chartPalette.length] }"
                  aria-hidden="true"
                />
                <span class="max-w-[45%] shrink-0 truncate text-[#555E6E]" :title="item.label">
                  {{ item.label }}
                </span>
                <span class="min-w-2 flex-1 border-b border-dashed border-[#D9DFE9]" aria-hidden="true" />
                <span class="shrink-0 tabular-nums text-[#555E6E]">{{ item.count }}条</span>
              </div>
            </div>
          </div>
          <EChart v-else :option="widgetChartOption(widget)" height="260px" />
        </template>
        <el-empty v-else description="该时间范围内暂无统计数据" :image-size="65" />
      </section>
      <section
        v-if="!analytics?.widgets?.length"
        class="min-w-0 rounded-xl bg-white px-5 py-4"
        data-testid="home-widgets-empty"
      >
        <div class="mb-3 flex items-center gap-2">
          <PieChart :size="18" class="shrink-0 text-[#2687FF]" aria-hidden="true" />
          <span class="text-[18px] font-semibold text-[#1D2129]">数据分析</span>
        </div>
        <el-empty description="暂无统计组件" :image-size="65" />
      </section>
    </div>

    <CrmDialog v-model="quickAccessDialogVisible" title="自定义快捷入口" width="620px">
      <div class="text-sm text-[var(--el-text-color-secondary)] mb-4">
        至少选择 1 个，最多选择 5 个。
      </div>
      <div class="font-medium mb-3">已选功能</div>
      <div class="mb-6 grid grid-cols-4 gap-3">
        <button
          v-for="key in quickAccessDraft"
          :key="key"
          type="button"
          class="relative flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-[var(--el-border-color)] bg-[var(--el-bg-color)] p-2.5 text-center text-[var(--el-text-color-primary)]"
          @click="removeQuickAccess(key)"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
            <component
              :is="quickAccessCatalog.find((item) => item.key === key)?.icon"
              :size="28"
              :stroke-width="2"
              class="block h-7 w-7 shrink-0"
            />
          </span>
          <span class="block w-full text-center">{{ quickAccessCatalog.find((item) => item.key === key)?.label }}</span>
          <span
            class="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--el-color-danger)] text-white"
            aria-label="移除快捷入口"
          ><Minus :size="14" :stroke-width="2" aria-hidden="true" /></span>
        </button>
      </div>
      <div class="font-medium mb-3">待添加功能</div>
      <div class="grid grid-cols-4 gap-3">
        <button
          v-for="item in availableQuickAccess"
          :key="item.key"
          type="button"
          class="relative flex min-h-[92px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-[var(--el-border-color)] bg-[var(--el-bg-color)] p-2.5 text-center text-[var(--el-text-color-primary)]"
          @click="addQuickAccess(item.key)"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden="true">
            <component
              :is="item.icon"
              :size="28"
              :stroke-width="2"
              class="block h-7 w-7 shrink-0"
            />
          </span>
          <span class="block w-full text-center">{{ item.label }}</span>
          <span
            class="absolute -top-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--el-color-success)] text-white"
            aria-label="添加快捷入口"
          ><Plus :size="14" :stroke-width="2" aria-hidden="true" /></span>
        </button>
      </div>
      <template #footer>
        <el-button @click="quickAccessDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveQuickAccess">保存</el-button>
      </template>
    </CrmDialog>

    <CrmDialog v-model="passwordDialogVisible" title="修改密码" width="460px">
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
    </CrmDialog>

    <CrmDialog v-model="followTargetDialogVisible" title="选择跟进对象" width="520px">
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
    </CrmDialog>

    <FollowUpDrawer
      v-model="followDrawerVisible"
      :target-type="followTarget.type"
      :target-id="followTarget.id || null"
      :target-name="followTarget.name"
    />

    <FollowUpPlanDialog v-model="followPlanDialogVisible" />

  </div>
</template>
