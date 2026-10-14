<script setup lang="ts">
import { type CustomerVO, type FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref, watch } from 'vue'
import { UserRound, X } from 'lucide-vue-next'
import { getCustomer, poolDeleteCustomer } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi } from '@/api/sales'
import FollowRecordPanel from '@/components/follow-records/FollowRecordPanel.vue'
import FollowRecordFormDrawer from '@/components/follow-records/FollowRecordFormDrawer.vue'
import MemberSelectDialog from '@/components/MemberSelectDialog.vue'
import CustomerChangeHistoryTimeline from '@/components/customer/CustomerChangeHistoryTimeline.vue'
import CustomerContactsTab from '@/components/customer/CustomerContactsTab.vue'
import CustomerContactCreateDrawer from '@/components/customer/CustomerContactCreateDrawer.vue'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

type TabName = 'overview' | 'contact' | 'followRecord' | 'headRecord'

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
const activeTab = ref<TabName>('overview')

const transferVisible = ref(false)
const poolAssignVisible = ref(false)
const createFollowVisible = ref(false)
const createContactVisible = ref(false)
const contactRefreshKey = ref(0)
const followRefreshKey = ref(0)
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
const allTabs = computed<{ name: TabName; label: string; visible: boolean }[]>(() => [
  { name: 'overview', label: '概览', visible: true },
  {
    name: 'contact',
    label: '联系人',
    visible: !props.pool && customer.value?.inSea !== true && auth.hasPerm('contact:read'),
  },
  { name: 'followRecord', label: '跟进记录', visible: true },
  { name: 'headRecord', label: '变更记录', visible: true },
])
const visibleTabs = computed(() => allTabs.value.filter((tab) => tab.visible))

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

const isAdmissionsConfig = computed(() =>
  fields.value.some((field) => /(学员|学生|家长|招生)/.test(field.label)),
)
function createContact() {
  if (!canWrite.value || !auth.hasPerm('contact:create') || !customer.value) return
  activeTab.value = 'contact'
  createContactVisible.value = true
}

async function handleContactCreated() {
  contactRefreshKey.value += 1
  await loadBase()
  emit('changed')
}

function createFollowRecord() {
  if (!canWrite.value || !customer.value) return
  activeTab.value = 'followRecord'
  createFollowVisible.value = true
}

async function handleFollowChanged() {
  await loadBase()
  emit('changed')
}

async function handleFollowCreated() {
  // Tab 在 v-for 下渲染，模板 ref 可能不是单个实例；用响应式版本号触发列表刷新。
  followRefreshKey.value += 1
  await handleFollowChanged()
}

async function loadBase() {
  loading.value = true
  try {
    const [{ data: detail }, { data: formConfig }] = await Promise.all([
      getCustomer(props.customerId, props.pool),
      metadataApi.formConfig('customer'),
    ])
    customer.value = detail
    fields.value = formConfig.fields
    if (!visibleTabs.value.some((tab) => tab.name === activeTab.value)) {
      activeTab.value = visibleTabs.value[0]?.name ?? 'overview'
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
    emit('close')
  } finally {
    loading.value = false
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

watch(
  () => props.customerId,
  async () => {
    activeTab.value = 'overview'
    createFollowVisible.value = false
    createContactVisible.value = false
    await loadBase()
  },
)

onMounted(async () => {
  await fieldRefs.load()
  await loadBase()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-white text-[#303133]">
    <header
      class="flex h-[58px] min-h-[58px] shrink-0 items-center justify-between bg-[#F7F8FA] px-5"
    >
      <h2 class="m-0 text-[18px] leading-[26px] font-medium text-black">
        {{ pool ? '公海客户详情' : isAdmissionsConfig ? '学员详情' : '客户详情' }}
      </h2>
      <button
        class="flex h-[18px] w-[18px] cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-[#999999] hover:text-[var(--el-color-primary)] focus-visible:outline-2 focus-visible:outline-[var(--el-color-primary)] focus-visible:outline-offset-2"
        type="button"
        aria-label="关闭客户详情"
        @click="emit('close')"
      >
        <X :size="18" :stroke-width="2" aria-hidden="true" />
      </button>
    </header>

    <div v-loading="loading" class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <template v-if="customer">
        <div
          class="m-5 flex min-h-[100px] shrink-0 items-center gap-3 rounded-[7px] bg-[#F7F8FA] px-[18px] py-[17px] max-sm:gap-[9px] max-sm:p-3"
        >
          <div
            class="grid h-[62px] w-[62px] shrink-0 place-items-center rounded-full bg-[var(--el-color-primary-light-9)] text-[var(--el-color-primary)]"
            aria-hidden="true"
          >
            <UserRound :size="42" :stroke-width="1.65" />
          </div>
          <strong
            class="min-w-0 flex-1 truncate text-[20px] leading-[28px] font-medium text-[#000000]"
          >
            {{ customer.name }}
          </strong>
          <el-button
            v-if="canMainAction && auth.hasPerm('customer:transfer')"
            class="!h-[36px] !shrink-0 !rounded-[4px] !border !border-[#DCDFE6] !bg-[#FFFFFF] !px-[9px] text-[13px] text-[#626B79] [--el-button-hover-bg-color:var(--el-color-primary-light-9)] [--el-button-hover-border-color:var(--el-color-primary)]"
            @click="transferVisible = true"
          >
            转移负责人
          </el-button>
        </div>

        <el-tabs v-model="activeTab" class="flex min-h-0 flex-1 flex-col">
          <el-tab-pane
            v-for="tab in visibleTabs"
            :key="tab.name"
            :name="tab.name"
            :label="tab.label"
          >
            <div
              v-if="tab.name === 'overview'"
              class="h-full min-h-0 overflow-x-hidden overflow-y-auto px-5 pt-[10px] pb-5 [scrollbar-gutter:stable]"
            >
              <section v-if="descriptionFields.length">
                <h3
                  class="m-0 mb-[13px] flex items-center gap-[6px] text-[14px] leading-5 font-medium text-[#333333]"
                >
                  <span
                    aria-hidden="true"
                    class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
                  />
                  客户信息
                </h3>
                <div class="grid grid-cols-3 items-start gap-x-5 gap-y-5 text-left">
                  <template v-for="field in descriptionFields" :key="field.id">
                    <section v-if="field.type === 'textarea'" class="col-span-3 min-w-0">
                      <h3
                        class="m-0 flex items-center gap-[6px] text-[14px] leading-5 font-medium text-[#333333]"
                      >
                        <span
                          aria-hidden="true"
                          class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
                        />
                        {{ field.label }}
                      </h3>
                      <div
                        class="mt-[13px] whitespace-pre-wrap break-words text-[14px] leading-5 font-normal text-[#333333]"
                      >
                        {{ displayField(field) }}
                      </div>
                    </section>
                    <div v-else class="min-w-0 text-left">
                      <div class="break-words text-[14px] leading-5 font-normal text-[#999999]">
                        {{ field.label }}
                      </div>
                      <div
                        class="mt-[13px] whitespace-pre-wrap break-words text-[14px] leading-5 text-[#333333]"
                      >
                        {{ displayField(field) }}
                      </div>
                    </div>
                  </template>
                </div>
              </section>
              <el-empty v-else description="暂无可展示的客户信息" :image-size="80" />
            </div>

            <div
              v-else
              class="h-full min-h-0 overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
              :class="
                tab.name === 'contact' || tab.name === 'followRecord' || tab.name === 'headRecord'
                  ? 'px-5 pt-[10px] pb-5'
                  : 'px-5 pt-[22px] pb-[30px] max-sm:px-[14px] max-sm:py-[18px]'
              "
            >
              <FollowRecordPanel
                v-if="tab.name === 'followRecord'"
                :refresh-key="followRefreshKey"
                target-type="customer"
                :target-id="customerId"
                :target-name="customer.name"
                :allow-create="canWrite"
                :allow-manage="canWrite"
                detail
                @changed="handleFollowChanged"
              />
              <CustomerContactsTab
                v-else-if="tab.name === 'contact'"
                :customer-id="customerId"
                :refresh-key="contactRefreshKey"
                :admissions="isAdmissionsConfig"
              />
              <CustomerChangeHistoryTimeline
                v-else-if="tab.name === 'headRecord'"
                :customer-id="customerId"
                :owner-id="customer.ownerId"
                :owner-name="customer.ownerName"
                :collected-at="customer.collectedAt"
              />
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <footer
      v-if="customer"
      class="flex shrink-0 items-center justify-end gap-[10px] border-t border-[#E9EDF2] bg-white px-5 py-[10px]"
    >
      <template v-if="pool">
        <el-button
          v-if="auth.hasPerm('customerPool:delete')"
          type="danger"
          plain
          @click="deletePoolCustomer"
        >
          删除
        </el-button>
        <el-button v-if="auth.hasPerm('customerPool:assign')" @click="poolAssignVisible = true">
          分配
        </el-button>
        <el-button
          v-if="auth.hasPerm('customerPool:pick')"
          type="primary"
          @click="claimPoolCustomer"
        >
          领取客户
        </el-button>
      </template>
      <template v-else>
        <el-button
          v-if="
            canWrite &&
            auth.hasPerm('contact:create') &&
            visibleTabs.some((tab) => tab.name === 'contact')
          "
          class="!ml-0 !h-[36px] !w-[88px] !shrink-0 !rounded-[4px] !p-0 [--el-font-size-base:14px] [--el-button-bg-color:#FFFFFF] [--el-button-border-color:#DCDFE6] [--el-button-text-color:#606266]"
          @click="createContact"
        >
          新增联系人
        </el-button>
        <el-button
          v-if="canWrite"
          type="primary"
          class="!ml-0 !h-[36px] !w-[88px] !shrink-0 !rounded-[4px] !p-0 [--el-font-size-base:14px] [--el-button-bg-color:var(--el-color-primary)] [--el-button-border-color:var(--el-color-primary)] [--el-button-text-color:#FFFFFF]"
          @click="createFollowRecord"
        >
          写跟进
        </el-button>
      </template>
    </footer>

    <CustomerContactCreateDrawer
      v-if="customer && !pool"
      v-model="createContactVisible"
      :customer-id="customerId"
      @saved="handleContactCreated"
    />

    <FollowRecordFormDrawer
      v-if="customer && !pool"
      v-model="createFollowVisible"
      target-type="customer"
      :target-id="customerId"
      :target-name="customer.name"
      append-to-body
      @saved="handleFollowCreated"
    />

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
  </div>
</template>

<style scoped>
/* 基础 Tabs：沿用 Element Plus 原生高度与字体变量。 */
:deep(.el-tabs__header) {
  --el-font-size-base: 16px;
  --el-text-color-primary: #666666;
  margin: 0;
  padding: 10px 20px;
  flex-shrink: 0;
}
:deep(.el-tabs__item) {
  font-weight: 600;
}
/* Element Plus 基础 Tabs 默认将首项左侧、末项右侧 padding 归零；局部恢复对称间距。 */
:deep(.el-tabs--top > .el-tabs__header .el-tabs__item:nth-child(2)),
:deep(.el-tabs--top > .el-tabs__header .el-tabs__item:last-child) {
  padding-inline: 20px;
}
:deep(.el-tabs__item.is-active) {
  background: #e8f3ff;
  color: var(--el-color-primary);
  border-radius: 8px 8px 0 0;
}
:deep(.el-tabs__content) {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
:deep(.el-tab-pane) {
  height: 100%;
  min-height: 0;
}
@media (max-width: 600px) {
  :deep(.el-tabs__header) {
    padding: 10px 14px;
  }
}
</style>
