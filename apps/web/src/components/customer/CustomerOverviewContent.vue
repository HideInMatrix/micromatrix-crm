<script setup lang="ts">
import {
  CONTRACT_STATUS_LABELS,
  INVOICE_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  RECEIVABLE_PLAN_STATUS_LABELS,
  isCustomFieldKey,
  type Customer360ContractVO,
  type Customer360InvoiceVO,
  type Customer360OpportunityVO,
  type Customer360OrderVO,
  type Customer360ReceivablePlanVO,
  type Customer360ReceivableRecordVO,
  type Customer360Resource,
  type CustomerVO,
  type FieldVO,
  type FollowUpVO,
  type TeamMemberVO,
} from '@micromatrix/shared'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  getCustomer,
  getCustomer360Resource,
  removeCustomer,
  updateCustomer,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi, followUpApi } from '@/api/sales'
import ContractDetailDrawer from '@/components/ContractDetailDrawer.vue'
import FollowUpDrawer from '@/components/FollowUpDrawer.vue'
import FollowUpPlanPanel from '@/components/follow-plans/FollowUpPlanPanel.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import OwnerHistoryTimeline from '@/components/OwnerHistoryTimeline.vue'
import CustomerRelationsPanel from '@/components/CustomerRelationsPanel.vue'
import CustomerContactTable from '@/components/contacts/CustomerContactTable.vue'
import OpportunityDetailDrawer from '@/components/opportunities/OpportunityDetailDrawer.vue'
import DynamicForm from '@/components/form-engine/DynamicForm.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

type TabName =
  | 'followRecord'
  | 'followPlan'
  | 'contact'
  | 'headRecord'
  | 'relation'
  | 'opportunityInfo'
  | 'collaborator'
  | 'contract'
  | 'contractPayment'
  | 'contractPaymentRecord'
  | 'invoice'
  | 'order'

const props = defineProps<{
  customerId: string
}>()

const emit = defineEmits<{
  close: []
  changed: []
  deleted: []
}>()

const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const customer = ref<CustomerVO | null>(null)
const fields = ref<FieldVO[]>([])
const loading = ref(false)
const activeTab = ref<TabName>('contact')
const layout = ref<'horizontal' | 'vertical'>('horizontal')
const hiddenTabs = ref<TabName[]>([])

const editVisible = ref(false)
const editSaving = ref(false)
const editForm = ref<Record<string, unknown>>({})
const dynamicFormRef = ref<InstanceType<typeof DynamicForm>>()
const transferVisible = ref(false)
const followVisible = ref(false)
const teamDialogVisible = ref(false)
const teamTypeVisible = ref(false)
const teamPendingUserId = ref('')
const teamEditingMember = ref<TeamMemberVO | null>(null)
const teamCollaborationType = ref<'READ_ONLY' | 'COLLABORATION'>('COLLABORATION')

const followRecords = ref<FollowUpVO[]>([])
const followLoading = ref(false)
const teamRows = ref<TeamMemberVO[]>([])
const teamLoading = ref(false)

const resourcePage = reactive<Record<Customer360Resource, number>>({
  opportunities: 1,
  contracts: 1,
  receivablePlans: 1,
  receivableRecords: 1,
  invoices: 1,
  orders: 1,
})
const resourceTotal = reactive<Record<Customer360Resource, number>>({
  opportunities: 0,
  contracts: 0,
  receivablePlans: 0,
  receivableRecords: 0,
  invoices: 0,
  orders: 0,
})
const resourceLoading = reactive<Record<Customer360Resource, boolean>>({
  opportunities: false,
  contracts: false,
  receivablePlans: false,
  receivableRecords: false,
  invoices: false,
  orders: false,
})
const resourceLoaded = reactive<Record<Customer360Resource, boolean>>({
  opportunities: false,
  contracts: false,
  receivablePlans: false,
  receivableRecords: false,
  invoices: false,
  orders: false,
})

const opportunities = ref<Customer360OpportunityVO[]>([])
const contracts = ref<Customer360ContractVO[]>([])
const receivablePlans = ref<Customer360ReceivablePlanVO[]>([])
const receivableRecords = ref<Customer360ReceivableRecordVO[]>([])
const invoices = ref<Customer360InvoiceVO[]>([])
const orders = ref<Customer360OrderVO[]>([])

const opportunityDetailVisible = ref(false)
const opportunityDetailId = ref<string | null>(null)
const contractDetailVisible = ref(false)
const contractDetailId = ref<string | null>(null)

const canMainAction = computed(
  () =>
    customer.value?.canManageCustomer === true &&
    customer.value.inSea !== true &&
    !customer.value.collaborationType,
)
const canWrite = computed(
  () => customer.value?.canCollaborateWrite === true && auth.hasPerm('customer:update'),
)
const canEditRelations = computed(
  () =>
    auth.hasPerm('customer:update') &&
    (customer.value?.canManageCustomer === true || customer.value?.collaborationType === 'COLLABORATION'),
)

const allTabs = computed<{ name: TabName; label: string; visible: boolean }[]>(() => [
  { name: 'followRecord', label: '跟进记录', visible: true },
  { name: 'followPlan', label: '跟进计划', visible: true },
  {
    name: 'contact',
    label: '联系人',
    visible: customer.value?.inSea !== true && auth.hasPerm('contact:read'),
  },
  { name: 'headRecord', label: '负责人记录', visible: true },
  { name: 'relation', label: '客户关系', visible: customer.value?.inSea !== true },
  {
    name: 'opportunityInfo',
    label: '商机',
    visible: customer.value?.inSea !== true && auth.hasPerm('menu:opportunity'),
  },
  {
    name: 'collaborator',
    label: '协作人',
    visible: customer.value?.inSea !== true && !customer.value?.collaborationType,
  },
  {
    name: 'contract',
    label: '合同',
    visible: customer.value?.inSea !== true && auth.hasPerm('menu:contract'),
  },
  {
    name: 'contractPayment',
    label: '回款计划',
    visible: customer.value?.inSea !== true && auth.hasPerm('menu:contract'),
  },
  {
    name: 'contractPaymentRecord',
    label: '回款记录',
    visible: customer.value?.inSea !== true && auth.hasPerm('menu:contract'),
  },
  {
    name: 'invoice',
    label: '发票',
    visible: customer.value?.inSea !== true && auth.hasPerm('menu:contract'),
  },
  {
    name: 'order',
    label: '订单',
    visible: customer.value?.inSea !== true && auth.hasPerm('menu:order'),
  },
])

const visibleTabs = computed(() =>
  allTabs.value.filter((tab) => tab.visible && !hiddenTabs.value.includes(tab.name)),
)

const descriptionFields = computed(() => fields.value.filter((field) => !field.hidden))

function displayField(field: FieldVO) {
  if (!customer.value) return '-'
  return formatFieldValue(
    field,
    customer.value as unknown as Record<string, unknown>,
    {
      memberMap: fieldRefs.memberMap.value,
      deptMap: fieldRefs.deptMap.value,
    },
  )
}

function formatAmount(value: number | null | undefined) {
  if (value === null || value === undefined) return '-'
  return `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildEditModel() {
  const row = customer.value
  if (!row) return {}
  const model: Record<string, unknown> = {}
  for (const field of fields.value) {
    if (field.type === 'formula') continue
    model[field.key] = isCustomFieldKey(field.key)
      ? row.customData[field.key]
      : (row as unknown as Record<string, unknown>)[field.key]
  }
  return model
}

function modelToPayload(model: Record<string, unknown>) {
  const payload: Record<string, unknown> = {}
  const customData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(model)) {
    if (value === undefined || value === '') continue
    if (isCustomFieldKey(key)) customData[key] = value
    else payload[key] = value
  }
  payload.customData = customData
  return payload
}

async function loadBase() {
  loading.value = true
  try {
    const [{ data: detail }, { data: fieldList }] = await Promise.all([
      getCustomer(props.customerId),
      metadataApi.fields('customer'),
    ])
    customer.value = detail
    fields.value = fieldList
    if (!visibleTabs.value.some((tab) => tab.name === activeTab.value)) {
      activeTab.value = visibleTabs.value[0]?.name ?? 'followRecord'
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    emit('close')
  } finally {
    loading.value = false
  }
}

async function loadFollows() {
  followLoading.value = true
  try {
    const { data } = await followUpApi.list('customer', props.customerId)
    followRecords.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    followLoading.value = false
  }
}

async function loadTeam() {
  teamLoading.value = true
  try {
    const { data } = await customerExtraApi.teamList(props.customerId)
    teamRows.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    teamLoading.value = false
  }
}

function rowsRef(resource: Customer360Resource) {
  switch (resource) {
    case 'opportunities': return opportunities
    case 'contracts': return contracts
    case 'receivablePlans': return receivablePlans
    case 'receivableRecords': return receivableRecords
    case 'invoices': return invoices
    case 'orders': return orders
  }
}

async function loadResource(resource: Customer360Resource, force = false) {
  if (resourceLoaded[resource] && !force) return
  resourceLoading[resource] = true
  try {
    const { data } = await getCustomer360Resource(props.customerId, resource, {
      page: resourcePage[resource],
      pageSize: 10,
    })
    ;(rowsRef(resource).value as unknown[]) = data.items as unknown[]
    resourceTotal[resource] = data.total
    resourceLoaded[resource] = true
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    resourceLoading[resource] = false
  }
}

function tabResource(tab: TabName): Customer360Resource | null {
  switch (tab) {
    case 'opportunityInfo': return 'opportunities'
    case 'contract': return 'contracts'
    case 'contractPayment': return 'receivablePlans'
    case 'contractPaymentRecord': return 'receivableRecords'
    case 'invoice': return 'invoices'
    case 'order': return 'orders'
    default: return null
  }
}

async function handleResourcePage(resource: Customer360Resource, page: number) {
  resourcePage[resource] = page
  resourceLoaded[resource] = false
  await loadResource(resource, true)
}

function openEdit() {
  editForm.value = buildEditModel()
  editVisible.value = true
}

async function saveEdit() {
  if (!(await dynamicFormRef.value?.validate())) return
  editSaving.value = true
  try {
    await updateCustomer(props.customerId, modelToPayload(editForm.value))
    ElMessage.success('客户已更新')
    editVisible.value = false
    await loadBase()
    emit('changed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    editSaving.value = false
  }
}

async function transferOwner(userId: string) {
  try {
    await customerExtraApi.assign(props.customerId, userId)
    transferVisible.value = false
    ElMessage.success('客户已转移')
    await loadBase()
    emit('changed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function moveToSea() {
  if (!customer.value) return
  const confirmed = await ElMessageBox.confirm(`将「${customer.value.name}」移入客户公海？`, '移入客户公海', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await customerExtraApi.toSea(props.customerId)
    ElMessage.success('已移入客户公海')
    emit('changed')
    emit('close')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function deleteCustomer() {
  if (!customer.value) return
  const confirmed = await ElMessageBox.confirm(`确定删除客户「${customer.value.name}」吗？`, '删除客户', {
    type: 'warning',
    confirmButtonText: '删除',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await removeCustomer(props.customerId)
    ElMessage.success('客户已删除')
    emit('deleted')
    emit('close')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function prepareAddTeamMember(userId: string) {
  teamDialogVisible.value = false
  teamEditingMember.value = null
  teamPendingUserId.value = userId
  teamCollaborationType.value = 'COLLABORATION'
  teamTypeVisible.value = true
}

function editTeamMember(member: TeamMemberVO) {
  teamEditingMember.value = member
  teamPendingUserId.value = member.userId
  teamCollaborationType.value = member.collaborationType
  teamTypeVisible.value = true
}

async function saveTeamMember() {
  if (!teamPendingUserId.value) return
  try {
    if (teamEditingMember.value) {
      await customerExtraApi.teamUpdate(
        props.customerId,
        teamEditingMember.value.id,
        teamCollaborationType.value,
      )
      ElMessage.success('协作设置已更新')
    } else {
      await customerExtraApi.teamAdd(
        props.customerId,
        teamPendingUserId.value,
        undefined,
        teamCollaborationType.value,
      )
      ElMessage.success('协作人已添加')
    }
    teamTypeVisible.value = false
    await loadTeam()
    emit('changed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function removeTeamMember(member: TeamMemberVO) {
  const confirmed = await ElMessageBox.confirm(`移除协作人「${member.userName}」？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await customerExtraApi.teamRemove(props.customerId, member.id)
    ElMessage.success('已移除协作人')
    await loadTeam()
    emit('changed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function openOpportunity(id: string) {
  opportunityDetailId.value = id
  opportunityDetailVisible.value = true
}

function openContract(id: string) {
  contractDetailId.value = id
  contractDetailVisible.value = true
}

function saveTabSetting() {
  localStorage.setItem('crm-customer-overview-hidden-tabs', JSON.stringify(hiddenTabs.value))
  if (!visibleTabs.value.some((tab) => tab.name === activeTab.value)) {
    activeTab.value = visibleTabs.value[0]?.name ?? 'followRecord'
  }
}

function setLayout(value: 'horizontal' | 'vertical') {
  layout.value = value
  localStorage.setItem('crm-customer-overview-layout', value)
}

watch(activeTab, async (tab) => {
  if (tab === 'followRecord') await loadFollows()
  if (tab === 'collaborator') await loadTeam()
  const resource = tabResource(tab)
  if (resource) await loadResource(resource)
})

watch(
  () => props.customerId,
  async () => {
    Object.keys(resourceLoaded).forEach((key) => {
      resourceLoaded[key as Customer360Resource] = false
      resourcePage[key as Customer360Resource] = 1
    })
    await loadBase()
    if (activeTab.value === 'followRecord') await loadFollows()
    else if (activeTab.value === 'collaborator') await loadTeam()
    else {
      const resource = tabResource(activeTab.value)
      if (resource) await loadResource(resource)
    }
  },
)

onMounted(async () => {
  const savedLayout = localStorage.getItem('crm-customer-overview-layout')
  if (savedLayout === 'vertical' || savedLayout === 'horizontal') layout.value = savedLayout
  try {
    hiddenTabs.value = JSON.parse(localStorage.getItem('crm-customer-overview-hidden-tabs') ?? '[]')
  } catch {
    hiddenTabs.value = []
  }
  await fieldRefs.load()
  await loadBase()
  if (activeTab.value === 'followRecord') await loadFollows()
  else if (activeTab.value === 'collaborator') await loadTeam()
  else {
    const resource = tabResource(activeTab.value)
    if (resource) await loadResource(resource)
  }
})
</script>

<template>
  <div class="h-full min-h-0 flex flex-col bg-[#f5f7fa]">
    <header class="h-16 shrink-0 flex items-center justify-between gap-4 bg-white px-5 border-b border-[var(--el-border-color-lighter)]">
      <div class="min-w-0 flex items-center gap-3">
        <el-button text class="!px-1" @click="emit('close')">←</el-button>
        <div class="min-w-0 text-base font-semibold truncate">{{ customer?.name ?? '客户详情' }}</div>
      </div>
      <div v-if="customer && canMainAction" class="flex items-center gap-2 shrink-0">
        <el-button v-if="auth.hasPerm('customer:update')" @click="openEdit">编辑</el-button>
        <el-button v-if="auth.hasPerm('customer:transfer')" @click="transferVisible = true">转移</el-button>
        <el-button v-if="auth.hasPerm('customer:recycle')" @click="moveToSea">移入公海</el-button>
        <el-button v-if="auth.hasPerm('customer:delete')" type="danger" plain @click="deleteCustomer">删除</el-button>
      </div>
    </header>

    <div v-loading="loading" class="flex-1 min-h-0 p-4 overflow-hidden">
      <div
        v-if="customer"
        class="h-full min-h-0 gap-4"
        :class="layout === 'horizontal' ? 'flex' : 'overflow-auto'"
      >
        <el-card
          shadow="never"
          class="customer-info-card"
          :class="layout === 'horizontal' ? 'w-[320px] shrink-0 h-full' : 'mb-4'"
        >
          <template #header>
            <div class="font-medium">客户信息</div>
          </template>
          <div :class="layout === 'horizontal' ? 'h-[calc(100%-8px)] overflow-auto' : ''">
            <el-descriptions
              :column="layout === 'horizontal' ? 1 : 3"
              :border="false"
              label-width="92px"
            >
              <el-descriptions-item
                v-for="field in descriptionFields"
                :key="field.id"
                :label="field.label"
              >
                <span class="break-all">{{ displayField(field) }}</span>
              </el-descriptions-item>
            </el-descriptions>
          </div>
        </el-card>

        <el-card
          shadow="never"
          class="customer-tabs-card min-w-0"
          :class="layout === 'horizontal' ? 'flex-1 h-full' : 'h-[680px]'"
          body-class="h-[calc(100%-57px)] min-h-0 !p-0 flex flex-col"
        >
          <template #header>
            <div class="flex items-center justify-between gap-4">
              <span class="font-medium">客户 360</span>
              <div class="flex items-center gap-2">
                <el-radio-group :model-value="layout" size="small" @change="setLayout($event as 'horizontal' | 'vertical')">
                  <el-radio-button value="horizontal">左右</el-radio-button>
                  <el-radio-button value="vertical">上下</el-radio-button>
                </el-radio-group>
                <el-popover placement="bottom-end" :width="240" trigger="click">
                  <template #reference>
                    <el-button size="small">Tab 设置</el-button>
                  </template>
                  <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">取消勾选可隐藏右侧业务 Tab</div>
                  <el-checkbox-group
                    :model-value="allTabs.filter((item) => item.visible && !hiddenTabs.includes(item.name)).map((item) => item.name)"
                    class="flex flex-col"
                    @change="(checked) => { hiddenTabs = allTabs.filter((item) => item.visible && !(checked as string[]).includes(item.name)).map((item) => item.name); saveTabSetting() }"
                  >
                    <el-checkbox v-for="tab in allTabs.filter((item) => item.visible)" :key="tab.name" :value="tab.name">
                      {{ tab.label }}
                    </el-checkbox>
                  </el-checkbox-group>
                </el-popover>
              </div>
            </div>
          </template>

          <el-tabs v-model="activeTab" class="customer-overview-tabs h-full min-h-0 px-4">
            <el-tab-pane v-for="tab in visibleTabs" :key="tab.name" :label="tab.label" :name="tab.name">
              <div class="h-full overflow-auto pb-4">
                <template v-if="tab.name === 'followRecord'">
                  <div class="flex justify-end mb-3">
                    <el-button v-if="canWrite" type="primary" size="small" @click="followVisible = true">写跟进</el-button>
                  </div>
                  <div v-loading="followLoading">
                    <el-empty v-if="followRecords.length === 0" description="暂无跟进记录" />
                    <el-timeline v-else>
                      <el-timeline-item
                        v-for="record in followRecords"
                        :key="record.id"
                        :timestamp="`${new Date(record.createdAt).toLocaleString()} · ${record.ownerName}`"
                        placement="top"
                      >
                        <el-tag size="small" class="mr-2">{{ record.type }}</el-tag>
                        {{ record.content }}
                      </el-timeline-item>
                    </el-timeline>
                  </div>
                </template>

                <FollowUpPlanPanel
                  v-else-if="tab.name === 'followPlan'"
                  target-type="customer"
                  :target-id="customerId"
                  :target-name="customer.name"
                  :can-write="canWrite"
                />

                <CustomerContactTable
                  v-else-if="tab.name === 'contact'"
                  :source-id="customerId"
                  :readonly="!canWrite"
                />

                <OwnerHistoryTimeline
                  v-else-if="tab.name === 'headRecord'"
                  module="customer"
                  :resource-id="customerId"
                />

                <CustomerRelationsPanel
                  v-else-if="tab.name === 'relation'"
                  :customer-id="customerId"
                  :readonly="!canEditRelations"
                />

                <template v-else-if="tab.name === 'opportunityInfo'">
                  <el-table v-loading="resourceLoading.opportunities" :data="opportunities" stripe class="w-full">
                    <el-table-column prop="name" label="商机名称" min-width="220" show-overflow-tooltip />
                    <el-table-column prop="stageName" label="阶段" min-width="120" />
                    <el-table-column label="预计金额" min-width="140" align="right">
                      <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
                    </el-table-column>
                    <el-table-column prop="ownerName" label="负责人" min-width="120" />
                    <el-table-column label="创建时间" min-width="160">
                      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
                    </el-table-column>
                    <el-table-column label="操作" width="80" fixed="right">
                      <template #default="{ row }"><el-button link type="primary" @click="openOpportunity(row.id)">详情</el-button></template>
                    </el-table-column>
                  </el-table>
                  <div class="flex justify-end mt-3">
                    <el-pagination
                      layout="total, prev, pager, next"
                      :total="resourceTotal.opportunities"
                      :page-size="10"
                      :current-page="resourcePage.opportunities"
                      @current-change="handleResourcePage('opportunities', $event)"
                    />
                  </div>
                </template>

                <template v-else-if="tab.name === 'collaborator'">
                  <div class="flex justify-end mb-3">
                    <el-button v-if="auth.hasPerm('customer:update')" type="primary" size="small" @click="teamDialogVisible = true">
                      添加协作人
                    </el-button>
                  </div>
                  <el-table v-loading="teamLoading" :data="teamRows" stripe class="w-full">
                    <el-table-column prop="userName" label="协作人" min-width="180" />
                    <el-table-column prop="role" label="角色" min-width="140" />
                    <el-table-column label="协作类型" min-width="140">
                      <template #default="{ row }">{{ row.collaborationType === 'READ_ONLY' ? '只读协作' : '协作' }}</template>
                    </el-table-column>
                    <el-table-column label="加入时间" min-width="180">
                      <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
                    </el-table-column>
                    <el-table-column v-if="auth.hasPerm('customer:update')" label="操作" width="140" fixed="right">
                      <template #default="{ row }">
                        <el-button link type="primary" @click="editTeamMember(row as TeamMemberVO)">编辑</el-button>
                        <el-button link type="danger" @click="removeTeamMember(row as TeamMemberVO)">移除</el-button>
                      </template>
                    </el-table-column>
                  </el-table>
                </template>

                <template v-else-if="tab.name === 'contract'">
                  <el-table v-loading="resourceLoading.contracts" :data="contracts" stripe class="w-full">
                    <el-table-column prop="code" label="合同编号" min-width="150" />
                    <el-table-column prop="name" label="合同名称" min-width="220" show-overflow-tooltip />
                    <el-table-column label="状态" min-width="100">
                      <template #default="{ row }">{{ CONTRACT_STATUS_LABELS[row.status as keyof typeof CONTRACT_STATUS_LABELS] ?? row.status }}</template>
                    </el-table-column>
                    <el-table-column label="合同金额" min-width="130" align="right">
                      <template #default="{ row }">{{ formatAmount(row.amount) }}</template>
                    </el-table-column>
                    <el-table-column label="已回款" min-width="130" align="right">
                      <template #default="{ row }">{{ formatAmount(row.paidAmount) }}</template>
                    </el-table-column>
                    <el-table-column prop="ownerName" label="负责人" min-width="120" />
                    <el-table-column label="操作" width="80" fixed="right">
                      <template #default="{ row }"><el-button link type="primary" @click="openContract(row.id)">详情</el-button></template>
                    </el-table-column>
                  </el-table>
                  <div class="flex justify-end mt-3">
                    <el-pagination layout="total, prev, pager, next" :total="resourceTotal.contracts" :page-size="10" :current-page="resourcePage.contracts" @current-change="handleResourcePage('contracts', $event)" />
                  </div>
                </template>

                <template v-else-if="tab.name === 'contractPayment'">
                  <el-table v-loading="resourceLoading.receivablePlans" :data="receivablePlans" stripe class="w-full">
                    <el-table-column prop="contractName" label="合同" min-width="220" show-overflow-tooltip />
                    <el-table-column label="期次" min-width="90"><template #default="{ row }">第 {{ row.period }} 期</template></el-table-column>
                    <el-table-column label="计划金额" min-width="130" align="right"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
                    <el-table-column label="已回款" min-width="130" align="right"><template #default="{ row }">{{ formatAmount(row.paidAmount) }}</template></el-table-column>
                    <el-table-column label="状态" min-width="110"><template #default="{ row }">{{ RECEIVABLE_PLAN_STATUS_LABELS[row.status as keyof typeof RECEIVABLE_PLAN_STATUS_LABELS] }}</template></el-table-column>
                    <el-table-column prop="dueDate" label="计划日期" min-width="120" />
                  </el-table>
                  <div class="flex justify-end mt-3"><el-pagination layout="total, prev, pager, next" :total="resourceTotal.receivablePlans" :page-size="10" :current-page="resourcePage.receivablePlans" @current-change="handleResourcePage('receivablePlans', $event)" /></div>
                </template>

                <template v-else-if="tab.name === 'contractPaymentRecord'">
                  <el-table v-loading="resourceLoading.receivableRecords" :data="receivableRecords" stripe class="w-full">
                    <el-table-column prop="contractName" label="合同" min-width="220" show-overflow-tooltip />
                    <el-table-column label="期次" min-width="90"><template #default="{ row }">{{ row.planPeriod ? `第 ${row.planPeriod} 期` : '-' }}</template></el-table-column>
                    <el-table-column label="回款金额" min-width="130" align="right"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
                    <el-table-column prop="receivedAt" label="回款日期" min-width="120" />
                    <el-table-column prop="method" label="方式" min-width="120" />
                    <el-table-column prop="ownerName" label="登记人" min-width="120" />
                  </el-table>
                  <div class="flex justify-end mt-3"><el-pagination layout="total, prev, pager, next" :total="resourceTotal.receivableRecords" :page-size="10" :current-page="resourcePage.receivableRecords" @current-change="handleResourcePage('receivableRecords', $event)" /></div>
                </template>

                <template v-else-if="tab.name === 'invoice'">
                  <el-table v-loading="resourceLoading.invoices" :data="invoices" stripe class="w-full">
                    <el-table-column prop="contractName" label="合同" min-width="220" show-overflow-tooltip />
                    <el-table-column prop="titleName" label="发票抬头" min-width="180" show-overflow-tooltip />
                    <el-table-column prop="type" label="发票类型" min-width="150" />
                    <el-table-column label="金额" min-width="130" align="right"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
                    <el-table-column label="状态" min-width="100"><template #default="{ row }">{{ INVOICE_STATUS_LABELS[row.status as keyof typeof INVOICE_STATUS_LABELS] }}</template></el-table-column>
                    <el-table-column prop="invoiceNo" label="发票号码" min-width="160" />
                    <el-table-column prop="issuedAt" label="开票日期" min-width="120" />
                  </el-table>
                  <div class="flex justify-end mt-3"><el-pagination layout="total, prev, pager, next" :total="resourceTotal.invoices" :page-size="10" :current-page="resourcePage.invoices" @current-change="handleResourcePage('invoices', $event)" /></div>
                </template>

                <template v-else-if="tab.name === 'order'">
                  <el-table v-loading="resourceLoading.orders" :data="orders" stripe class="w-full">
                    <el-table-column prop="code" label="订单编号" min-width="150" />
                    <el-table-column prop="name" label="订单名称" min-width="200" show-overflow-tooltip />
                    <el-table-column prop="contractName" label="合同" min-width="200" show-overflow-tooltip />
                    <el-table-column label="金额" min-width="130" align="right"><template #default="{ row }">{{ formatAmount(row.amount) }}</template></el-table-column>
                    <el-table-column label="状态" min-width="110"><template #default="{ row }">{{ ORDER_STATUS_LABELS[row.status as keyof typeof ORDER_STATUS_LABELS] }}</template></el-table-column>
                    <el-table-column prop="ownerName" label="负责人" min-width="120" />
                    <el-table-column label="创建时间" min-width="160"><template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template></el-table-column>
                  </el-table>
                  <div class="flex justify-end mt-3"><el-pagination layout="total, prev, pager, next" :total="resourceTotal.orders" :page-size="10" :current-page="resourcePage.orders" @current-change="handleResourcePage('orders', $event)" /></div>
                </template>
              </div>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </div>
    </div>

    <el-dialog v-model="editVisible" title="编辑客户" width="680px" destroy-on-close>
      <DynamicForm
        ref="dynamicFormRef"
        v-model="editForm"
        :fields="fields"
        :members="fieldRefs.members.value"
        :dept-tree="fieldRefs.deptTree.value"
      />
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" :loading="editSaving" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <MemberSelectDialog
      v-model="transferVisible"
      title="转移客户"
      :members="fieldRefs.members.value"
      @confirm="transferOwner"
    />
    <MemberSelectDialog
      v-model="teamDialogVisible"
      title="添加协作人"
      :members="fieldRefs.members.value"
      @confirm="prepareAddTeamMember"
    />
    <el-dialog
      v-model="teamTypeVisible"
      :title="teamEditingMember ? '编辑协作设置' : '添加协作人'"
      width="420px"
    >
      <el-form label-width="90px">
        <el-form-item label="协作人">
          {{ fieldRefs.memberMap.value.get(teamPendingUserId) ?? teamEditingMember?.userName ?? '-' }}
        </el-form-item>
        <el-form-item label="协作类型">
          <el-radio-group v-model="teamCollaborationType">
            <el-radio value="COLLABORATION">协作</el-radio>
            <el-radio value="READ_ONLY">只读</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="teamTypeVisible = false">取消</el-button>
        <el-button type="primary" @click="saveTeamMember">保存</el-button>
      </template>
    </el-dialog>
    <FollowUpDrawer
      v-model="followVisible"
      target-type="customer"
      :target-id="customerId"
      :target-name="customer?.name"
      @followed="loadFollows"
    />
    <OpportunityDetailDrawer v-model="opportunityDetailVisible" :opportunity-id="opportunityDetailId" />
    <ContractDetailDrawer
      v-model="contractDetailVisible"
      :contract-id="contractDetailId"
      @changed="() => { resourceLoaded.contracts = false; resourceLoaded.receivablePlans = false; resourceLoaded.receivableRecords = false; resourceLoaded.invoices = false; loadResource(tabResource(activeTab) ?? 'contracts', true) }"
    />
  </div>
</template>

<style scoped>
.customer-info-card,
.customer-tabs-card {
  overflow: hidden;
}

.customer-overview-tabs :deep(.el-tabs__content),
.customer-overview-tabs :deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}

.customer-overview-tabs :deep(.el-tabs__content) {
  overflow: hidden;
}
</style>
