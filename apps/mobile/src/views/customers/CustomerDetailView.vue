<script setup lang="ts">
import {
  type CustomerVO,
  type FieldVO,
  type FollowUpVO,
  type OwnerHistoryVO,
} from '@micromatrix/shared'
import { Pencil, Trash2 } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { removeCustomer } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import defaultAvatar from '../../../../web/public/images/avatar.png'
import homeBackground from '../../../../web/public/images/home-background.png'
import { customerExtraApi, resourcePoolApi } from '@/api/sales'
import { dictionaryApi, type DictionaryItemVO } from '@/api/system'
import { formatFieldValue } from '@/components/form-engine/field-display'
import { useFieldRefs } from '@/composables/useFieldRefs'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileLeadOperationSheet from '@/components/MobileLeadOperationSheet.vue'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import { fetchFields, getCustomer, pageFollowUps } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

type DetailTab = 'record' | 'change'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const activeTab = ref<DetailTab>('record')
const loading = ref(false)
const customer = ref<CustomerVO | null>(null)
const fields = ref<FieldVO[]>([])
const records = ref<FollowUpVO[]>([])
const ownerHistory = ref<OwnerHistoryVO[]>([])

const followShow = ref(false)
const transferShow = ref(false)
const transferSubmitting = ref(false)
const moveShow = ref(false)
const moveLoading = ref(false)
const moveSubmitting = ref(false)
const poolOptions = ref<{ id: string; name: string }[]>([])
const moveReasonEnabled = ref(false)
const moveReasons = ref<DictionaryItemVO[]>([])
const customerId = computed(() => String(route.query.id ?? ''))
const poolSource = computed(() => route.query.source === 'openSea')
const canWrite = computed(
  () => customer.value?.canCollaborateWrite === true && auth.hasPerm('customer:update'),
)
const canMainAction = computed(
  () =>
    customer.value?.canManageCustomer === true &&
    customer.value.inSea !== true &&
    !customer.value.collaborationType,
)
const canEdit = computed(
  () => auth.hasPerm('customer:update') && (canMainAction.value || canWrite.value),
)
const canDelete = computed(() => canMainAction.value && auth.hasPerm('customer:delete'))
const canTransfer = computed(() => canMainAction.value && auth.hasPerm('customer:transfer'))
const canMove = computed(() => canMainAction.value && auth.hasPerm('customer:recycle'))
const showFooter = computed(
  () => Boolean(customer.value?.phone) || canMove.value || canTransfer.value || canWrite.value,
)
const detailTabs: { name: DetailTab; title: string }[] = [
  { name: 'record', title: '跟进记录' },
  { name: 'change', title: '变更记录' },
]

const descriptionFields = computed(() =>
  fields.value
    .filter(
      (field) =>
        !field.hidden &&
        field.mobile !== false &&
        field.key !== 'name' &&
        field.type !== 'sub_product' &&
        field.type !== 'alert',
    )
    .sort((a, b) => a.sort - b.sort),
)
const sortedRecords = computed(() =>
  [...records.value].sort(
    (a, b) =>
      new Date(b.followedAt ?? b.createdAt).getTime() -
      new Date(a.followedAt ?? a.createdAt).getTime(),
  ),
)
const sortedHistory = computed(() =>
  [...ownerHistory.value].sort(
    (a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime(),
  ),
)

function displayField(field: FieldVO) {
  if (!customer.value) return '-'
  return formatFieldValue(field, customer.value as unknown as Record<string, unknown>, {
    memberMap: fieldRefs.memberMap.value,
    deptMap: fieldRefs.deptMap.value,
  })
}

function formatDate(value: string | null) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--'
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function historyOwner(row: OwnerHistoryVO) {
  return row.ownerName ?? row.ownerId ?? '原负责人'
}

function nextOwner(row: OwnerHistoryVO) {
  const successor = ownerHistory.value.find(
    (item) => item.id !== row.id && item.collectedAt === row.endedAt,
  )
  if (successor) return historyOwner(successor)
  if (customer.value?.collectedAt === row.endedAt && customer.value.ownerId) {
    return (
      customer.value.ownerName ??
      fieldRefs.memberMap.value.get(customer.value.ownerId) ??
      '新负责人'
    )
  }
  return '未分配'
}

function callCustomer() {
  const phone = customer.value?.phone?.replace(/[^\d+]/g, '')
  if (!phone) return showFailToast('暂无可联系的手机号')
  window.location.href = `tel:${phone}`
}

async function load() {
  if (!customerId.value) {
    router.replace('/customers')
    return
  }
  loading.value = true
  try {
    const [detailRes, fieldRes] = await Promise.all([
      getCustomer(customerId.value, poolSource.value),
      fetchFields('customer'),
      fieldRefs.load(),
    ])
    customer.value = detailRes.data
    fields.value = fieldRes.data

    const [followRes, historyRes] = await Promise.all([
      poolSource.value
        ? Promise.resolve({ data: { items: [] as FollowUpVO[] } })
        : pageFollowUps('customer', customerId.value),
      customerExtraApi.ownerHistory(customerId.value),
    ])
    records.value = followRes.data.items
    ownerHistory.value = historyRes.data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace('/customers')
  } finally {
    loading.value = false
  }
}

async function reloadRecords() {
  try {
    const { data } = await pageFollowUps('customer', customerId.value)
    records.value = data.items
    activeTab.value = 'record'
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function goEdit() {
  if (canEdit.value) void router.push(`/customers/${customerId.value}/edit`)
}

async function transferOwner(value: { ownerId?: string }) {
  if (!canTransfer.value || !value.ownerId || transferSubmitting.value) return
  transferSubmitting.value = true
  try {
    await customerExtraApi.assign(customerId.value, value.ownerId)
    showSuccessFeedback('客户已转移')
    transferShow.value = false
    await load()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    transferSubmitting.value = false
  }
}

async function openMove() {
  if (!canMove.value) return
  moveShow.value = true
  moveLoading.value = true
  try {
    const [poolRes, reasonRes] = await Promise.all([
      resourcePoolApi.options('customer'),
      dictionaryApi.config('CUSTOMER_POOL_RS'),
    ])
    if (!moveShow.value) return
    poolOptions.value = poolRes.data
    moveReasonEnabled.value = reasonRes.data.enable
    moveReasons.value = reasonRes.data.dictList.filter((item) => item.id !== 'system')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    moveLoading.value = false
  }
}

async function confirmMove(value: { poolId?: string; reasonId?: string }) {
  if (!canMove.value || moveLoading.value || moveSubmitting.value) return
  if (!value.poolId || !poolOptions.value.some((pool) => pool.id === value.poolId)) {
    showFailToast('请选择有效的客户公海')
    return
  }
  if (moveReasonEnabled.value && !value.reasonId) {
    showFailToast('请选择移入客户公海原因')
    return
  }
  moveSubmitting.value = true
  try {
    await customerExtraApi.toSea(customerId.value, value.poolId, value.reasonId)
    moveShow.value = false
    showSuccessFeedback('已移入客户公海')
    await router.replace('/customers')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    moveSubmitting.value = false
  }
}

async function handleDelete() {
  if (!canDelete.value) return
  const confirmed = await showActionConfirm({
    title: '删除客户',
    message: `确认删除「${customer.value?.name ?? ''}」？`,
    confirmButtonText: '删除',
  })
  if (!confirmed) return
  try {
    await removeCustomer(customerId.value)
    showSuccessFeedback('客户已删除')
    router.replace('/customers')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

onMounted(async () => {
  await load()
  if (!customer.value) return
  if (route.query.action === 'transfer' && canTransfer.value) {
    transferShow.value = true
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[#F3F5F8]">
    <van-loading v-if="loading" class="!flex !justify-center !py-16" />
    <template v-else-if="customer">
      <div
        class="min-h-0 flex-1 overflow-y-auto bg-[#F4F6F9] bg-top bg-no-repeat p-[12px]"
        :style="{ backgroundImage: 'url(' + homeBackground + ')', backgroundSize: '100% auto' }"
      >
        <section class="rounded-[8px] bg-white/80 p-[12px]" aria-label="客户信息">
          <div class="flex items-center gap-[10px]">
            <van-image
              :src="defaultAvatar"
              round
              fit="cover"
              width="48"
              height="48"
              class="shrink-0"
            />
            <div class="min-w-0 flex-1">
              <h1 class="m-0 truncate text-[18px] leading-[24px] font-semibold text-[#000000]">
                {{ customer.name || '未命名客户' }}
              </h1>
            </div>
            <div v-if="canEdit || canDelete" class="flex shrink-0 items-center gap-[18px]">
              <van-button
                v-if="canEdit"
                class="!h-auto !shrink-0 !border-0 !bg-transparent !p-0 !text-[var(--van-primary-color)]"
                @click="goEdit"
              >
                <span class="flex flex-col items-center gap-[3px] text-[12px]">
                  <Pencil :size="18" aria-hidden="true" />编辑
                </span>
              </van-button>
              <van-button
                v-if="canDelete"
                class="!h-auto !shrink-0 !border-0 !bg-transparent !p-0 !text-[#888888]"
                @click="handleDelete"
              >
                <span class="flex flex-col items-center gap-[3px] text-[12px]">
                  <Trash2 :size="18" aria-hidden="true" />删除
                </span>
              </van-button>
            </div>
          </div>

          <div
            v-if="descriptionFields.length"
            class="mt-[20px] grid grid-cols-2 gap-x-[12px] gap-y-[15px]"
          >
            <div
              v-for="field in descriptionFields"
              :key="field.id"
              class="min-w-0"
              :class="
                ['textarea', 'multiselect', 'attachment'].includes(field.type) ? 'col-span-2' : ''
              "
            >
              <div class="text-[14px] leading-[20px] text-[#999999]">{{ field.label }}</div>
              <div class="mt-[3px] break-words text-[14px] leading-[20px] text-[#333333]">
                {{ displayField(field) }}
              </div>
            </div>
          </div>
        </section>

        <section
          class="mt-[12px] min-h-[180px] rounded-[8px] bg-white p-[12px]"
          aria-label="客户记录"
        >
          <div class="flex h-[24px] items-center gap-[20px] overflow-x-auto whitespace-nowrap">
            <van-button
              v-for="tab in detailTabs"
              :key="tab.name"
              class="relative !h-[24px] !flex-none !rounded-none !border-0 !bg-transparent !p-0 !leading-[24px]"
              :class="
                activeTab === tab.name
                  ? '!text-[16px] !font-semibold !text-[var(--van-primary-color)]'
                  : '!text-[14px] !font-normal !text-[#666666]'
              "
              @click="activeTab = tab.name"
            >
              {{ tab.title }}
              <span
                v-if="activeTab === tab.name"
                class="absolute inset-x-0 bottom-0 h-[2px] rounded-[2px] bg-[var(--van-primary-color)]"
              />
            </van-button>
          </div>

          <template v-if="activeTab === 'record'">
            <van-empty
              v-if="sortedRecords.length === 0"
              image-size="68"
              description="暂无跟进记录"
            />
            <ol v-else class="m-0 ml-[8px] mt-[12px] list-none p-0 pl-[16px]">
              <li
                v-for="(record, index) in sortedRecords"
                :key="record.id"
                class="relative pb-[24px] last:pb-0"
              >
                <span
                  v-if="index < sortedRecords.length - 1"
                  class="pointer-events-none absolute -bottom-[9px] -left-[17px] w-[2px] bg-[#CCCCCC]"
                  :class="index === 0 ? 'top-[8px]' : 'top-[9px]'"
                  aria-hidden="true"
                />
                <span
                  v-if="index === 0"
                  class="absolute top-0 -left-[24px] h-[16px] w-[16px] rounded-full bg-[color-mix(in_srgb,var(--van-primary-color)_12%,white)]"
                  aria-hidden="true"
                />
                <span
                  v-else
                  class="absolute top-[5px] -left-[20px] h-[8px] w-[8px] rounded-full bg-[#999999]"
                  aria-hidden="true"
                />
                <time
                  class="block text-[12px] leading-[17px] text-[#999999]"
                  :datetime="record.followedAt ?? record.createdAt"
                  >{{ formatDate(record.followedAt ?? record.createdAt) }}</time
                >
                <p
                  class="mt-[5px] mb-0 whitespace-pre-wrap break-words text-[14px] leading-[20px] text-[#333333]"
                >
                  {{ record.content || record.type || '跟进记录' }}
                </p>
                <span
                  class="mt-[5px] block w-fit rounded-[4px] bg-[#F5F7FA] px-[5px] py-[2px] text-[10px] leading-[14px] text-[#999999]"
                  >{{ record.ownerName ? '操作人：' + record.ownerName : '操作人：-' }}</span
                >
              </li>
            </ol>
          </template>

          <template v-else-if="activeTab === 'change'">
            <van-empty
              v-if="sortedHistory.length === 0"
              image-size="68"
              description="暂无变更记录"
            />
            <ol v-else class="m-0 ml-[8px] mt-[12px] list-none p-0 pl-[16px]">
              <li
                v-for="(item, index) in sortedHistory"
                :key="item.id"
                class="relative pb-[24px] last:pb-0"
              >
                <span
                  v-if="index < sortedHistory.length - 1"
                  class="pointer-events-none absolute -bottom-[9px] -left-[17px] w-[2px] bg-[#CCCCCC]"
                  :class="index === 0 ? 'top-[8px]' : 'top-[9px]'"
                  aria-hidden="true"
                />
                <span
                  v-if="index === 0"
                  class="absolute top-0 -left-[24px] h-[16px] w-[16px] rounded-full bg-[color-mix(in_srgb,var(--van-primary-color)_12%,white)]"
                  aria-hidden="true"
                />
                <span
                  v-else
                  class="absolute top-[5px] -left-[20px] h-[8px] w-[8px] rounded-full bg-[#999999]"
                  aria-hidden="true"
                />
                <time
                  class="block text-[12px] leading-[17px] text-[#999999]"
                  :datetime="item.endedAt"
                >
                  {{ formatDate(item.endedAt) }}
                </time>
                <p class="mt-[5px] mb-0 break-words text-[14px] leading-[20px] text-[#333333]">
                  负责人由 {{ historyOwner(item) }} 变更为 {{ nextOwner(item) }}
                  <span v-if="item.reasonName">（{{ item.reasonName }}）</span>
                </p>
                <p
                  v-if="item.collectedAt || item.departmentName"
                  class="mt-[5px] mb-0 text-[12px] leading-[17px] text-[#999999]"
                >
                  <span v-if="item.departmentName">归属部门：{{ item.departmentName }}</span>
                  <span v-if="item.collectedAt" class="ml-[8px]"
                    >归属开始：{{ formatDate(item.collectedAt) }}</span
                  >
                </p>
                <span
                  class="mt-[5px] block w-fit rounded-[4px] bg-[#F5F7FA] px-[5px] py-[2px] text-[10px] leading-[14px] text-[#999999]"
                  >操作人：{{ item.operatorName ?? '系统' }}</span
                >
              </li>
            </ol>
          </template>
        </section>
      </div>

      <div
        v-if="showFooter"
        class="flex shrink-0 flex-nowrap items-center justify-end gap-[8px] bg-white px-[12px] pt-[10px] pb-[calc(12px+env(safe-area-inset-bottom))]"
      >
        <van-button
          v-if="customer.phone"
          class="!h-auto !w-auto !flex-none !shrink-0 !whitespace-nowrap !rounded-[14px] !border-[var(--van-primary-color)] !bg-white !px-[12px] !py-[6px] !text-[12px] !leading-[14px] !text-[var(--van-primary-color)]"
          @click="callCustomer"
          >电话联系</van-button
        >
        <van-button
          v-if="canMove"
          class="!h-auto !w-auto !flex-none !shrink-0 !whitespace-nowrap !rounded-[14px] !border-[var(--van-primary-color)] !bg-white !px-[12px] !py-[6px] !text-[12px] !leading-[14px] !text-[var(--van-primary-color)]"
          @click="openMove"
          >移入客户公海</van-button
        >
        <van-button
          v-if="canTransfer"
          class="!h-auto !w-auto !flex-none !shrink-0 !whitespace-nowrap !rounded-[14px] !border-[var(--van-primary-color)] !bg-white !px-[12px] !py-[6px] !text-[12px] !leading-[14px] !text-[var(--van-primary-color)]"
          @click="transferShow = true"
          >转移</van-button
        >
        <van-button
          v-if="canWrite"
          class="!h-auto !w-auto !flex-none !shrink-0 !whitespace-nowrap !rounded-[14px] !border-[var(--van-primary-color)] !bg-[var(--van-primary-color)] !px-[12px] !py-[6px] !text-[12px] !leading-[14px] !text-white"
          @click="followShow = true"
          >写跟进</van-button
        >
      </div>
    </template>

    <MobileFollowUpSheet
      v-model="followShow"
      target-type="customer"
      :target-id="customerId"
      :target-name="customer?.name"
      @followed="reloadRecords"
    />
    <MobileLeadOperationSheet
      v-model="transferShow"
      resource="customer"
      mode="transfer"
      :target-name="customer?.name"
      :members="fieldRefs.members.value"
      :submitting="transferSubmitting"
      @confirm="transferOwner"
    />
    <MobileLeadOperationSheet
      v-model="moveShow"
      resource="customer"
      mode="move"
      :target-name="customer?.name"
      :pools="poolOptions"
      :reason-enabled="moveReasonEnabled"
      :reasons="moveReasons"
      :loading="moveLoading"
      :submitting="moveSubmitting"
      @confirm="confirmMove"
    />
  </div>
</template>
