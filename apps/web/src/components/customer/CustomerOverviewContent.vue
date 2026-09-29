<script setup lang="ts">
import {
  isCustomFieldKey,
  type CustomerVO,
  type FieldVO,
  type TeamMemberVO,
} from '@micromatrix/shared'
import { computed, onMounted, ref, watch } from 'vue'
import {
  getCustomer,
  poolDeleteCustomer,
  removeCustomer,
  updateCustomer,
} from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi } from '@/api/sales'
import FollowUpPlanPanel from '@/components/follow-plans/FollowUpPlanPanel.vue'
import FollowRecordPanel from '@/components/follow-records/FollowRecordPanel.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import OwnerHistoryTimeline from '@/components/OwnerHistoryTimeline.vue'
import CustomerRelationsPanel from '@/components/CustomerRelationsPanel.vue'
import CustomerContactTable from '@/components/contacts/CustomerContactTable.vue'
import CustomerMoveToPoolDialog from '@/components/customer/CustomerMoveToPoolDialog.vue'
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
  | 'collaborator'

const props = defineProps<{
  customerId: string
  pool?: boolean
  poolId?: string
  hiddenFieldIds?: string[]
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
const poolAssignVisible = ref(false)
const moveToPoolVisible = ref(false)
const teamDialogVisible = ref(false)
const teamTypeVisible = ref(false)
const teamPendingUserId = ref('')
const teamEditingMember = ref<TeamMemberVO | null>(null)
const teamCollaborationType = ref<'READ_ONLY' | 'COLLABORATION'>('COLLABORATION')

const teamRows = ref<TeamMemberVO[]>([])
const teamLoading = ref(false)

const canMainAction = computed(
  () =>
    !props.pool &&
    customer.value?.canManageCustomer === true &&
    customer.value.inSea !== true &&
    !customer.value.collaborationType,
)
const canWrite = computed(
  () =>
    !props.pool && customer.value?.canCollaborateWrite === true && auth.hasPerm('customer:update'),
)
const canEditRelations = computed(
  () => auth.hasPerm('customer:update') && customer.value?.canManageCustomer === true,
)

const allTabs = computed<{ name: TabName; label: string; visible: boolean }[]>(() => [
  { name: 'followRecord', label: '跟进记录', visible: true },
  { name: 'followPlan', label: '跟进计划', visible: !props.pool },
  {
    name: 'contact',
    label: '联系人',
    visible: !props.pool && customer.value?.inSea !== true && auth.hasPerm('contact:read'),
  },
  { name: 'headRecord', label: '负责人记录', visible: true },
  { name: 'relation', label: '客户关系', visible: !props.pool && customer.value?.inSea !== true },
  {
    name: 'collaborator',
    label: '协作人',
    visible: !props.pool && customer.value?.inSea !== true && !customer.value?.collaborationType,
  },
])

const visibleTabs = computed(() => {
  const visible = allTabs.value.filter((tab) => tab.visible)
  return props.pool ? visible : visible.filter((tab) => !hiddenTabs.value.includes(tab.name))
})

const descriptionFields = computed(() => {
  const hidden = new Set(props.hiddenFieldIds ?? [])
  return fields.value.filter(
    (field) => !field.hidden && (field.key === 'name' || !hidden.has(field.id)),
  )
})

function displayField(field: FieldVO) {
  if (!customer.value) return '-'
  return formatFieldValue(field, customer.value as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
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
      getCustomer(props.customerId, props.pool),
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

function moveToSea() {
  if (!customer.value) return
  moveToPoolVisible.value = true
}

async function claimPoolCustomer() {
  if (!customer.value || !props.poolId) return
  const confirmed = await ElMessageBox.confirm(
    `领取客户「${customer.value.name}」后，该客户将进入你的客户列表。`,
    '领取客户',
    { confirmButtonText: '领取', cancelButtonText: '取消' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await customerExtraApi.claim(props.customerId, props.poolId)
    ElMessage.success('客户领取成功')
    emit('deleted')
    emit('close')
    window.open(
      `${window.location.origin}/customers?id=${encodeURIComponent(props.customerId)}`,
      '_blank',
    )
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function assignPoolCustomer(userId: string) {
  try {
    await customerExtraApi.assign(props.customerId, userId, true)
    ElMessage.success('客户分配成功')
    poolAssignVisible.value = false
    emit('deleted')
    emit('close')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function deletePoolCustomer() {
  if (!customer.value) return
  const confirmed = await ElMessageBox.confirm(
    `确定删除公海客户「${customer.value.name}」吗？`,
    '删除客户',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
  ).catch(() => false)
  if (!confirmed) return
  try {
    await poolDeleteCustomer(props.customerId)
    ElMessage.success('客户已删除')
    emit('deleted')
    emit('close')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function deleteCustomer() {
  if (!customer.value) return
  const confirmed = await ElMessageBox.confirm(
    `确定删除客户「${customer.value.name}」吗？`,
    '删除客户',
    {
      type: 'warning',
      confirmButtonText: '删除',
    },
  ).catch(() => false)
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
  if (tab === 'collaborator') await loadTeam()
})

watch(
  () => props.customerId,
  async () => {
    await loadBase()
    if (activeTab.value === 'collaborator') await loadTeam()
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
  if (activeTab.value === 'collaborator') await loadTeam()
})
</script>

<template>
  <div class="h-full min-h-0 flex flex-col bg-[var(--el-bg-color-page)]">
    <header
      class="h-14 shrink-0 flex items-center justify-between gap-4 bg-[var(--el-bg-color)] px-5 border-b border-[var(--el-border-color-lighter)]"
    >
      <div class="min-w-0 flex items-center gap-3">
        <el-button text class="!px-1" @click="emit('close')">←</el-button>
        <div class="min-w-0 text-base font-semibold truncate">
          {{ customer?.name ?? '客户详情' }}
        </div>
      </div>
      <div v-if="customer && canMainAction" class="flex items-center gap-2 shrink-0">
        <el-button v-if="auth.hasPerm('customer:update')" @click="openEdit">编辑</el-button>
        <el-button v-if="auth.hasPerm('customer:transfer')" @click="transferVisible = true"
          >转移</el-button
        >
        <el-button v-if="auth.hasPerm('customer:recycle')" @click="moveToSea">移入公海</el-button>
        <el-button
          v-if="auth.hasPerm('customer:delete')"
          type="danger"
          plain
          @click="deleteCustomer"
          >删除</el-button
        >
      </div>
      <div v-else-if="customer && pool" class="flex items-center gap-2 shrink-0">
        <el-button
          v-if="auth.hasPerm('customerPool:pick')"
          type="primary"
          plain
          @click="claimPoolCustomer"
        >
          领取
        </el-button>
        <el-button v-if="auth.hasPerm('customerPool:assign')" @click="poolAssignVisible = true">
          分配
        </el-button>
        <el-button
          v-if="auth.hasPerm('customerPool:delete')"
          type="danger"
          plain
          @click="deletePoolCustomer"
        >
          删除
        </el-button>
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
              <span class="font-medium">{{ pool ? '公海客户详情' : '客户 360' }}</span>
              <div class="flex items-center gap-2">
                <el-radio-group
                  :model-value="layout"
                  size="small"
                  @change="setLayout($event as 'horizontal' | 'vertical')"
                >
                  <el-radio-button value="horizontal">左右</el-radio-button>
                  <el-radio-button value="vertical">上下</el-radio-button>
                </el-radio-group>
                <el-popover v-if="!pool" placement="bottom-end" :width="240" trigger="click">
                  <template #reference>
                    <el-button size="small">Tab 设置</el-button>
                  </template>
                  <div class="text-xs text-[var(--el-text-color-secondary)] mb-2">
                    取消勾选可隐藏右侧业务 Tab
                  </div>
                  <el-checkbox-group
                    :model-value="
                      allTabs
                        .filter((item) => item.visible && !hiddenTabs.includes(item.name))
                        .map((item) => item.name)
                    "
                    class="flex flex-col"
                    @change="
                      (checked) => {
                        hiddenTabs = allTabs
                          .filter(
                            (item) => item.visible && !(checked as string[]).includes(item.name),
                          )
                          .map((item) => item.name)
                        saveTabSetting()
                      }
                    "
                  >
                    <el-checkbox
                      v-for="tab in allTabs.filter((item) => item.visible)"
                      :key="tab.name"
                      :value="tab.name"
                    >
                      {{ tab.label }}
                    </el-checkbox>
                  </el-checkbox-group>
                </el-popover>
              </div>
            </div>
          </template>

          <el-tabs v-model="activeTab" class="customer-overview-tabs h-full min-h-0 px-4">
            <el-tab-pane
              v-for="tab in visibleTabs"
              :key="tab.name"
              :label="tab.label"
              :name="tab.name"
            >
              <div class="h-full overflow-auto pb-4">
                <template v-if="tab.name === 'followRecord'">
                  <FollowRecordPanel
                    target-type="customer"
                    :target-id="customerId"
                    :target-name="customer.name"
                    :allow-create="canWrite"
                    :allow-manage="canWrite"
                  />
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

                <template v-else-if="tab.name === 'collaborator'">
                  <div class="flex justify-end mb-3">
                    <el-button
                      v-if="auth.hasPerm('customer:update')"
                      type="primary"
                      size="small"
                      @click="teamDialogVisible = true"
                    >
                      添加协作人
                    </el-button>
                  </div>
                  <el-table v-loading="teamLoading" :data="teamRows" stripe class="w-full">
                    <el-table-column prop="userName" label="协作人" min-width="180" />
                    <el-table-column prop="role" label="角色" min-width="140" />
                    <el-table-column label="协作类型" min-width="140">
                      <template #default="{ row }">{{
                        row.collaborationType === 'READ_ONLY' ? '只读协作' : '协作'
                      }}</template>
                    </el-table-column>
                    <el-table-column label="加入时间" min-width="180">
                      <template #default="{ row }">{{
                        new Date(row.createdAt).toLocaleString()
                      }}</template>
                    </el-table-column>
                    <el-table-column
                      v-if="auth.hasPerm('customer:update')"
                      label="操作"
                      width="140"
                      fixed="right"
                    >
                      <template #default="{ row }">
                        <el-button link type="primary" @click="editTeamMember(row as TeamMemberVO)"
                          >编辑</el-button
                        >
                        <el-button link type="danger" @click="removeTeamMember(row as TeamMemberVO)"
                          >移除</el-button
                        >
                      </template>
                    </el-table-column>
                  </el-table>
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
      v-model="poolAssignVisible"
      title="分配公海客户"
      :members="fieldRefs.members.value"
      @confirm="assignPoolCustomer"
    />
    <CustomerMoveToPoolDialog
      v-model="moveToPoolVisible"
      :customer-ids="[customerId]"
      :customer-name="customer?.name"
      @moved="
        () => {
          emit('changed')
          emit('close')
        }
      "
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
          {{
            fieldRefs.memberMap.value.get(teamPendingUserId) ?? teamEditingMember?.userName ?? '-'
          }}
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
