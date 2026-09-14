<script setup lang="ts">
import {
  FOLLOW_UP_PLAN_STATUS_LABELS,
  type ContractVO,
  type FollowUpPlanVO,
  type HomeDepartmentNode,
  type HomeLeadStatistic,
  type HomeOpportunityFilterStatus,
  type HomeOpportunityStatistic,
  type HomeStatisticPeriod,
  type HomeStatisticRequest,
  type HomeStatisticValue,
  type HomeTimeField,
  type HomeUserField,
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
  FileSignature,
  Handshake,
  MessageSquareText,
  Plus,
  ReceiptText,
  RefreshCw,
  Settings2,
  ShoppingCart,
  Target,
} from 'lucide-vue-next'
import { ElButton } from 'element-plus'
import type { Component } from 'vue'
import { computed, h, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { approvalApi } from '@/api/approvals'
import { changePassword } from '@/api/auth'
import { listCustomerOptions } from '@/api/customers'
import { businessTitleApi, contractApi, contractInvoiceApi } from '@/api/deal'
import { homeApi } from '@/api/home'
import { extractErrorMessage } from '@/api/http'
import { followUpPlanApi, leadApi, opportunityApi } from '@/api/sales'
import { notificationApi } from '@/api/system'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import FollowUpPlanDialog from '@/components/follow-plans/FollowUpPlanDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import { storeHomeFilter } from '@/utils/home-filter'

const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()
const router = useRouter()

const periods: Array<{ key: HomeStatisticPeriod; label: string }> = [
  { key: 'TODAY', label: '今天' },
  { key: 'THIS_WEEK', label: '本周' },
  { key: 'THIS_MONTH', label: '本月' },
  { key: 'THIS_YEAR', label: '本年' },
]

const leadPeriodKeys: Record<HomeStatisticPeriod, keyof HomeLeadStatistic> = {
  TODAY: 'todayClue',
  THIS_WEEK: 'thisWeekClue',
  THIS_MONTH: 'thisMonthClue',
  THIS_YEAR: 'thisYearClue',
}

const opportunityPeriodKeys: Record<
  HomeStatisticPeriod,
  { count: keyof HomeOpportunityStatistic; amount: keyof HomeOpportunityStatistic }
> = {
  TODAY: { count: 'todayOpportunity', amount: 'todayOpportunityAmount' },
  THIS_WEEK: { count: 'thisWeekOpportunity', amount: 'thisWeekOpportunityAmount' },
  THIS_MONTH: { count: 'thisMonthOpportunity', amount: 'thisMonthOpportunityAmount' },
  THIS_YEAR: { count: 'thisYearOpportunity', amount: 'thisYearOpportunityAmount' },
}

const overviewConfig = reactive<{
  userField: HomeUserField
  timeField: Exclude<HomeTimeField, 'ACTUAL_END_TIME'>
  winOrderTimeField: Extract<HomeTimeField, 'EXPECTED_END_TIME' | 'ACTUAL_END_TIME'>
  priorPeriodEnable: boolean
}>({
  userField: 'OWNER',
  timeField: 'CREATE_TIME',
  winOrderTimeField: 'EXPECTED_END_TIME',
  priorPeriodEnable: true,
})

const overviewSettingTab = ref<'clue' | 'opportunity' | 'win'>('clue')
const departmentTree = ref<HomeDepartmentNode[]>([])
const activeDeptId = ref('SELF')
const searchType = ref<HomeStatisticRequest['searchType']>('SELF')
const selectedDeptIds = ref<string[]>([])
const statisticLoading = ref(false)
const leadStatistic = ref<HomeLeadStatistic | null>(null)
const opportunityStatistic = ref<HomeOpportunityStatistic | null>(null)
const underwayStatistic = ref<HomeOpportunityStatistic | null>(null)
const successStatistic = ref<HomeOpportunityStatistic | null>(null)

const hasLeadRead = computed(() => auth.hasPerm('menu:lead'))
const hasOpportunityRead = computed(() => auth.hasPerm('menu:opportunity'))

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

function overviewStorageKey() {
  return `micromatrix:home-overview:${auth.user?.id ?? 'anonymous'}`
}

function loadOverviewConfig() {
  try {
    const raw = localStorage.getItem(overviewStorageKey())
    if (!raw) return
    const saved = JSON.parse(raw) as Partial<typeof overviewConfig>
    if (saved.userField === 'OWNER' || saved.userField === 'CREATE_USER') {
      overviewConfig.userField = saved.userField
    }
    if (saved.timeField === 'CREATE_TIME' || saved.timeField === 'EXPECTED_END_TIME') {
      overviewConfig.timeField = saved.timeField
    }
    if (
      saved.winOrderTimeField === 'EXPECTED_END_TIME' ||
      saved.winOrderTimeField === 'ACTUAL_END_TIME'
    ) {
      overviewConfig.winOrderTimeField = saved.winOrderTimeField
    }
    if (typeof saved.priorPeriodEnable === 'boolean') {
      overviewConfig.priorPeriodEnable = saved.priorPeriodEnable
    }
  } catch {
    localStorage.removeItem(overviewStorageKey())
  }
}

async function persistOverviewConfig() {
  localStorage.setItem(overviewStorageKey(), JSON.stringify({ ...overviewConfig }))
  await loadStatistics()
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
    userField: overviewConfig.userField,
    timeField: overviewConfig.timeField,
    winOrderTimeField: overviewConfig.winOrderTimeField,
    priorPeriodEnable: overviewConfig.priorPeriodEnable,
  }
}

async function loadStatistics() {
  statisticLoading.value = true
  try {
    const request = statisticRequest()
    const [leadResponse, opportunityResponse, underwayResponse, successResponse] =
      await Promise.all([
        hasLeadRead.value ? homeApi.lead(request) : Promise.resolve(null),
        hasOpportunityRead.value ? homeApi.opportunity(request) : Promise.resolve(null),
        hasOpportunityRead.value ? homeApi.opportunityUnderway(request) : Promise.resolve(null),
        hasOpportunityRead.value ? homeApi.opportunitySuccess(request) : Promise.resolve(null),
      ])
    leadStatistic.value = leadResponse?.data ?? null
    opportunityStatistic.value = opportunityResponse?.data ?? null
    underwayStatistic.value = underwayResponse?.data ?? null
    successStatistic.value = successResponse?.data ?? null
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    statisticLoading.value = false
  }
}

function leadValue(period: HomeStatisticPeriod) {
  return leadStatistic.value?.[leadPeriodKeys[period]] ?? null
}

function opportunityValue(
  source: HomeOpportunityStatistic | null,
  period: HomeStatisticPeriod,
  amount = false,
) {
  if (!source) return null
  const key = amount ? opportunityPeriodKeys[period].amount : opportunityPeriodKeys[period].count
  return source[key]
}

function formatStatistic(value: HomeStatisticValue | null, currency = false) {
  if (!value) return '-'
  if (currency) return `¥${value.value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
  return value.value.toLocaleString('zh-CN')
}

function compareLabel(value: HomeStatisticValue | null) {
  if (!value || value.priorPeriodCompareRate === null) return '-'
  const rate = value.priorPeriodCompareRate
  if (rate === 0) return '0%'
  return `${rate > 0 ? '↑' : '↓'}${Math.abs(rate).toFixed(2)}%`
}

function compareClass(value: HomeStatisticValue | null) {
  const rate = value?.priorPeriodCompareRate
  if (rate === null || rate === undefined || rate === 0)
    return 'text-[var(--el-text-color-secondary)]'
  return rate > 0 ? 'text-[var(--el-color-danger)]' : 'text-[var(--el-color-success)]'
}

function openStatistic(
  module: 'lead' | 'opportunity',
  period: HomeStatisticPeriod,
  status?: HomeOpportunityFilterStatus,
) {
  if (module === 'lead') {
    if (!hasLeadRead.value || overviewConfig.userField !== 'OWNER') return
  } else if (!hasOpportunityRead.value) {
    return
  }

  const key = storeHomeFilter({
    module,
    period,
    searchType: searchType.value,
    deptIds: selectedDeptIds.value,
    ...(module === 'lead' ? { userField: overviewConfig.userField } : {}),
    ...(module === 'opportunity'
      ? {
          timeField:
            status === 'SUCCESS' ? overviewConfig.winOrderTimeField : overviewConfig.timeField,
          ...(status ? { status } : {}),
        }
      : {}),
  })
  void router.push({
    path: module === 'lead' ? '/leads' : '/opportunities',
    query: { homeFilter: key },
  })
}

// ===== 快捷入口 =====

type QuickAccessKey =
  | 'customer'
  | 'contact'
  | 'lead'
  | 'opportunity'
  | 'contract'
  | 'invoice'
  | 'followRecord'
  | 'followPlan'
  | 'order'

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
      key: 'opportunity',
      label: '新建商机',
      icon: Handshake,
      permissions: ['opportunity:create'],
      moduleEnabled: () => moduleConfig.isEnabled('opportunity'),
    },
    {
      key: 'contract',
      label: '新建合同',
      icon: FileSignature,
      permissions: ['contract:create'],
      moduleEnabled: () => moduleConfig.isEnabled('contract'),
    },
    {
      key: 'invoice',
      label: '新建发票',
      icon: ReceiptText,
      permissions: ['CONTRACT_INVOICE:ADD'],
      moduleEnabled: () => moduleConfig.isEnabled('contract'),
    },
    {
      key: 'followRecord',
      label: '新建跟进记录',
      icon: MessageSquareText,
      permissions: ['customer:update', 'lead:update'],
      moduleEnabled: () =>
        moduleConfig.isEnabled('customer') ||
        moduleConfig.isEnabled('lead') ||
        moduleConfig.isEnabled('opportunity'),
    },
    {
      key: 'followPlan',
      label: '新建跟进计划',
      icon: CalendarClock,
      permissions: ['customer:update', 'lead:update'],
      moduleEnabled: () =>
        moduleConfig.isEnabled('customer') ||
        moduleConfig.isEnabled('lead') ||
        moduleConfig.isEnabled('opportunity'),
    },
    {
      key: 'order',
      label: '新建订单',
      icon: ShoppingCart,
      permissions: ['ORDER:ADD'],
      moduleEnabled: () => moduleConfig.isEnabled('order'),
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
  if (key === 'opportunity') return routeCreate('/opportunities')
  if (key === 'contract') return routeCreate('/contracts')
  if (key === 'order') return routeCreate('/order/index')
  if (key === 'invoice') return openInvoiceDialog()
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

type FollowTargetType = 'lead' | 'customer' | 'opportunity'
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
    } else if (followTarget.type === 'lead') {
      const { data } = await leadApi.list({ page: 1, pageSize: 100, scope: 'mine' })
      followTargetOptions.value = data.items.map((item) => ({ id: item.id, name: item.name }))
    } else {
      const { data } = await opportunityApi.list({ page: 1, pageSize: 100 })
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

// ===== 发票快捷创建 =====

const invoiceDialogVisible = ref(false)
const invoiceLoading = ref(false)
const invoiceSaving = ref(false)
const invoiceContracts = ref<ContractVO[]>([])
const invoiceTitles = ref<Array<{ id: string; name: string }>>([])
const invoiceForm = reactive({
  contractId: '',
  titleId: '',
  amount: 0,
  type: '增值税普通发票',
})

async function openInvoiceDialog() {
  invoiceDialogVisible.value = true
  invoiceLoading.value = true
  try {
    const { data } = await contractApi.page({ current: 1, pageSize: 100 })
    invoiceContracts.value = data.list
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    invoiceLoading.value = false
  }
}

async function handleInvoiceContractChange() {
  const contract = invoiceContracts.value.find((item) => item.id === invoiceForm.contractId)
  invoiceForm.titleId = ''
  invoiceForm.amount = contract ? Math.max(0, contract.amount - contract.invoicedAmount) : 0
  invoiceTitles.value = []
  if (!contract) return
  try {
    const { data } = await businessTitleApi.options()
    invoiceTitles.value = data.map((item) => ({ id: item.id, name: item.name }))
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function saveInvoice() {
  if (!invoiceForm.contractId || invoiceForm.amount <= 0) {
    ElMessage.warning('请选择合同并填写正确的开票金额')
    return
  }
  invoiceSaving.value = true
  try {
    const contract = invoiceContracts.value.find((item) => item.id === invoiceForm.contractId)
    await contractInvoiceApi.create({
      name: `开票申请-${contract?.name ?? invoiceForm.contractId}`,
      contractId: invoiceForm.contractId,
      businessTitleId: invoiceForm.titleId || undefined,
      amount: invoiceForm.amount,
      invoiceType: invoiceForm.type || undefined,
      taxRate: 0,
      moduleFields: [],
    })
    ElMessage.success('发票已创建')
    invoiceDialogVisible.value = false
    invoiceForm.contractId = ''
    invoiceForm.titleId = ''
    invoiceForm.amount = 0
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    invoiceSaving.value = false
  }
}

const pageLoading = ref(true)

onMounted(async () => {
  loadOverviewConfig()
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
      <div class="flex items-center justify-between gap-4 mb-4">
        <div class="font-semibold text-base">数据概览</div>
        <div class="dashboard-overview-actions flex items-center gap-2">
          <el-tree-select
            v-model="activeDeptId"
            :data="departmentOptions"
            check-strictly
            filterable
            class="!w-60"
            @change="handleDepartmentChange"
          />
          <el-popover placement="bottom-end" trigger="click" :width="330">
            <template #reference>
              <el-button data-testid="home-overview-settings"
                ><Settings2 :size="16" aria-hidden="true"
              /></el-button>
            </template>
            <el-tabs v-model="overviewSettingTab" stretch>
              <el-tab-pane label="线索" name="clue">
                <div class="text-sm mb-2">统计维度</div>
                <el-select
                  v-model="overviewConfig.userField"
                  class="w-full"
                  @change="persistOverviewConfig"
                >
                  <el-option label="负责人" value="OWNER" />
                  <el-option label="创建人" value="CREATE_USER" />
                </el-select>
                <div class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
                  创建人维度仅展示统计值；与 Cordys 一致，不提供点击跳转。
                </div>
              </el-tab-pane>
              <el-tab-pane label="商机" name="opportunity">
                <div class="text-sm mb-2">统计时间字段</div>
                <el-select
                  v-model="overviewConfig.timeField"
                  class="w-full"
                  @change="persistOverviewConfig"
                >
                  <el-option label="创建时间" value="CREATE_TIME" />
                  <el-option label="预计结束时间" value="EXPECTED_END_TIME" />
                </el-select>
              </el-tab-pane>
              <el-tab-pane label="赢单" name="win">
                <div class="flex items-center justify-between mb-4">
                  <span class="text-sm">较上期</span>
                  <el-switch
                    v-model="overviewConfig.priorPeriodEnable"
                    @change="persistOverviewConfig"
                  />
                </div>
                <div class="text-sm mb-2">统计时间字段</div>
                <el-select
                  v-model="overviewConfig.winOrderTimeField"
                  class="w-full"
                  @change="persistOverviewConfig"
                >
                  <el-option label="预计结束时间" value="EXPECTED_END_TIME" />
                  <el-option label="实际结束时间" value="ACTUAL_END_TIME" />
                </el-select>
              </el-tab-pane>
            </el-tabs>
          </el-popover>
          <el-button
            data-testid="home-overview-refresh"
            :loading="statisticLoading"
            @click="loadStatistics"
          >
            <RefreshCw :size="16" aria-hidden="true" />
          </el-button>
        </div>
      </div>

      <div
        v-loading="statisticLoading"
        class="min-w-[1180px] overflow-hidden rounded-[4px] border border-[var(--el-border-color-lighter)]"
      >
        <div
          class="grid min-h-12 grid-cols-[150px_repeat(4,minmax(245px,1fr))] border-b border-[var(--el-border-color-lighter)] bg-[var(--el-fill-color-light)] last:border-b-0"
        >
          <div
            class="flex items-center gap-[9px] border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] font-semibold last:border-r-0"
          >
            类别
          </div>
          <div
            v-for="period in periods"
            :key="period.key"
            class="flex items-center border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] font-semibold last:border-r-0"
          >
            {{ period.label }}
          </div>
        </div>

        <div
          class="grid grid-cols-[150px_repeat(4,minmax(245px,1fr))] border-b border-[var(--el-border-color-lighter)] last:border-b-0"
        >
          <div
            class="flex items-center gap-[9px] border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] font-semibold last:border-r-0"
          >
            <div
              class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[4px] bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
            >
              <Target :size="18" />
            </div>
            <span>线索</span>
          </div>
          <div
            v-for="period in periods"
            :key="period.key"
            class="flex items-center gap-1 border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] last:border-r-0"
          >
            <div class="text-[13px] text-[var(--el-text-color-secondary)]">新建线索</div>
            <button
              type="button"
              class="border-0 bg-transparent p-0 text-left text-[18px] leading-7 font-semibold"
              :class="
                hasLeadRead && overviewConfig.userField === 'OWNER'
                  ? 'cursor-pointer text-[var(--el-color-primary)]'
                  : 'cursor-default text-[var(--el-text-color-placeholder)]'
              "
              @click="openStatistic('lead', period.key)"
            >
              {{ hasLeadRead ? formatStatistic(leadValue(period.key)) : '-' }}
            </button>
          </div>
        </div>

        <div
          class="grid grid-cols-[150px_repeat(4,minmax(245px,1fr))] border-b border-[var(--el-border-color-lighter)] last:border-b-0"
        >
          <div
            class="flex items-center gap-[9px] border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] font-semibold last:border-r-0"
          >
            <div
              class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[4px] bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
            >
              <Handshake :size="18" />
            </div>
            <span>商机</span>
          </div>
          <div
            v-for="period in periods"
            :key="period.key"
            class="grid grid-cols-2 items-center gap-4 border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] last:border-r-0"
          >
            <div>
              <div class="mb-1 text-[13px] text-[var(--el-text-color-secondary)]">商机数</div>
              <button
                type="button"
                class="border-0 bg-transparent p-0 text-left text-[18px] leading-7 font-semibold"
                :class="
                  hasOpportunityRead
                    ? 'cursor-pointer text-[var(--el-color-primary)]'
                    : 'cursor-default text-[var(--el-text-color-placeholder)]'
                "
                @click="openStatistic('opportunity', period.key)"
              >
                {{
                  hasOpportunityRead
                    ? formatStatistic(opportunityValue(opportunityStatistic, period.key))
                    : '-'
                }}
              </button>
              <button
                type="button"
                class="mt-1 block border-0 bg-transparent p-0 text-left text-xs"
                :class="
                  hasOpportunityRead
                    ? 'cursor-pointer text-[var(--el-color-primary)]'
                    : 'cursor-default text-[var(--el-text-color-placeholder)]'
                "
                @click="openStatistic('opportunity', period.key, 'AFOOT')"
              >
                进行中
                {{
                  hasOpportunityRead
                    ? formatStatistic(opportunityValue(underwayStatistic, period.key))
                    : '-'
                }}
              </button>
            </div>
            <div>
              <div class="mb-1 text-[13px] text-[var(--el-text-color-secondary)]">金额</div>
              <button
                type="button"
                class="border-0 bg-transparent p-0 text-left text-[18px] leading-7 font-semibold"
                :class="
                  hasOpportunityRead
                    ? 'cursor-pointer text-[var(--el-color-primary)]'
                    : 'cursor-default text-[var(--el-text-color-placeholder)]'
                "
                @click="openStatistic('opportunity', period.key)"
              >
                {{
                  hasOpportunityRead
                    ? formatStatistic(
                        opportunityValue(opportunityStatistic, period.key, true),
                        true,
                      )
                    : '-'
                }}
              </button>
              <button
                type="button"
                class="mt-1 block border-0 bg-transparent p-0 text-left text-xs"
                :class="
                  hasOpportunityRead
                    ? 'cursor-pointer text-[var(--el-color-primary)]'
                    : 'cursor-default text-[var(--el-text-color-placeholder)]'
                "
                @click="openStatistic('opportunity', period.key, 'AFOOT')"
              >
                进行中
                {{
                  hasOpportunityRead
                    ? formatStatistic(opportunityValue(underwayStatistic, period.key, true), true)
                    : '-'
                }}
              </button>
            </div>
          </div>
        </div>

        <div
          class="grid grid-cols-[150px_repeat(4,minmax(245px,1fr))] border-b border-[var(--el-border-color-lighter)] last:border-b-0"
        >
          <div
            class="flex items-center gap-[9px] border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] font-semibold last:border-r-0"
          >
            <div
              class="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[4px] bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
            >
              <CheckCheck :size="18" />
            </div>
            <span>赢单</span>
          </div>
          <div
            v-for="period in periods"
            :key="period.key"
            class="grid grid-cols-2 items-center gap-4 border-r border-[var(--el-border-color-lighter)] px-4 py-[14px] last:border-r-0"
          >
            <div>
              <div class="mb-1 text-[13px] text-[var(--el-text-color-secondary)]">赢单数</div>
              <button
                type="button"
                class="border-0 bg-transparent p-0 text-left text-[18px] leading-7 font-semibold"
                :class="
                  hasOpportunityRead
                    ? 'cursor-pointer text-[var(--el-color-primary)]'
                    : 'cursor-default text-[var(--el-text-color-placeholder)]'
                "
                @click="openStatistic('opportunity', period.key, 'SUCCESS')"
              >
                {{
                  hasOpportunityRead
                    ? formatStatistic(opportunityValue(successStatistic, period.key))
                    : '-'
                }}
              </button>
              <div
                v-if="overviewConfig.priorPeriodEnable"
                class="mt-1 text-xs"
                :class="compareClass(opportunityValue(successStatistic, period.key))"
              >
                较上期 {{ compareLabel(opportunityValue(successStatistic, period.key)) }}
              </div>
            </div>
            <div>
              <div class="mb-1 text-[13px] text-[var(--el-text-color-secondary)]">赢单金额</div>
              <button
                type="button"
                class="border-0 bg-transparent p-0 text-left text-[18px] leading-7 font-semibold"
                :class="
                  hasOpportunityRead
                    ? 'cursor-pointer text-[var(--el-color-primary)]'
                    : 'cursor-default text-[var(--el-text-color-placeholder)]'
                "
                @click="openStatistic('opportunity', period.key, 'SUCCESS')"
              >
                {{
                  hasOpportunityRead
                    ? formatStatistic(opportunityValue(successStatistic, period.key, true), true)
                    : '-'
                }}
              </button>
              <div
                v-if="overviewConfig.priorPeriodEnable"
                class="mt-1 text-xs"
                :class="compareClass(opportunityValue(successStatistic, period.key, true))"
              >
                较上期 {{ compareLabel(opportunityValue(successStatistic, period.key, true)) }}
              </div>
            </div>
          </div>
        </div>
      </div>
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
            <el-radio-button value="opportunity">商机</el-radio-button>
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

    <el-dialog v-model="invoiceDialogVisible" title="新建发票" width="560px">
      <el-form v-loading="invoiceLoading" label-width="92px">
        <el-form-item label="关联合同" required>
          <el-select
            v-model="invoiceForm.contractId"
            filterable
            class="w-full"
            @change="handleInvoiceContractChange"
          >
            <el-option
              v-for="contract in invoiceContracts"
              :key="contract.id"
              :label="`${contract.number} · ${contract.name}`"
              :value="contract.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="开票抬头">
          <el-select v-model="invoiceForm.titleId" clearable filterable class="w-full">
            <el-option
              v-for="title in invoiceTitles"
              :key="title.id"
              :label="title.name"
              :value="title.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="开票金额" required>
          <el-input-number
            v-model="invoiceForm.amount"
            :min="0.01"
            :precision="2"
            class="!w-full"
          />
        </el-form-item>
        <el-form-item label="发票类型">
          <el-select v-model="invoiceForm.type" class="w-full">
            <el-option label="增值税普通发票" value="增值税普通发票" />
            <el-option label="增值税专用发票" value="增值税专用发票" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="invoiceDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="invoiceSaving" @click="saveInvoice">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>
<style scoped>
.dashboard-overview-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
