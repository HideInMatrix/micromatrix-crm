<script setup lang="ts">
import type { CustomerVO, FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { listCustomers, poolBatchDeleteCustomers } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { customerExtraApi, resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileCustomerListCard from '@/components/customer/MobileCustomerListCard.vue'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { fetchFields } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'
import type { MobileViewSelection } from '@/types/mobile-view'

const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const pools = ref<ResourcePoolVO[]>([])
const selectedPoolId = ref('')
const keyword = ref('')
const items = ref<CustomerVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const fields = ref<FieldVO[]>([])
const activeSavedViewId = ref('')
const poolsReady = ref(false)
const savedViewsReady = ref(false)
const viewsReady = computed(() => poolsReady.value && savedViewsReady.value)

const actionShow = ref(false)
const actionTarget = ref<CustomerVO | null>(null)
const assignShow = ref(false)

const memberColumns = computed(() =>
  fieldRefs.members.value.map((item) => ({ text: item.name, value: item.id })),
)
const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const listFields = computed(() => {
  const hiddenIds = new Set(currentPool.value?.hiddenFieldIds ?? [])
  const visible = fields.value.filter(
    (field) => field.showInList && !field.hidden && (field.key === 'name' || !hiddenIds.has(field.id)),
  )
  const nameField = fields.value.find((field) => field.key === 'name' && !field.hidden)
  if (nameField && !visible.some((field) => field.key === 'name')) visible.unshift(nameField)
  return visible
})

async function initPools() {
  try {
    const [{ data: poolData }, { data: fieldData }] = await Promise.all([
      resourcePoolApi.options('customer'),
      fetchFields('customer'),
      fieldRefs.load(),
    ])
    pools.value = poolData
    fields.value = fieldData
    if (!selectedPoolId.value || !poolData.some((item) => item.id === selectedPoolId.value)) {
      selectedPoolId.value = poolData[0]?.id ?? ''
    }
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    poolsReady.value = true
  }
}

async function loadMore() {
  if (!viewsReady.value || !selectedPoolId.value || finished.value) return
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
      scope: 'sea',
      poolId: selectedPoolId.value,
      viewId: activeSavedViewId.value || undefined,
    })
    items.value.push(...data.items)
    finished.value = items.value.length >= data.total
    page.value += 1
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    finished.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  items.value = []
  finished.value = false
  if (viewsReady.value && selectedPoolId.value) loadMore()
}

async function handleRefresh() {
  page.value = 1
  items.value = []
  finished.value = false
  try {
    if (selectedPoolId.value) await loadMore()
  } finally {
    refreshing.value = false
  }
}

function selectPool(poolId: string) {
  if (selectedPoolId.value === poolId) return
  selectedPoolId.value = poolId
  reload()
}

function applyViewSelection(selection: MobileViewSelection) {
  activeSavedViewId.value = selection.type === 'saved' ? selection.id : ''
}

function handleViewReady(selection: MobileViewSelection) {
  applyViewSelection(selection)
  savedViewsReady.value = true
}

function handleViewChange(selection: MobileViewSelection) {
  applyViewSelection(selection)
  reload()
}

function goDetail(customer: CustomerVO) {
  router.push({
    path: '/customers/detail',
    query: { id: customer.id, name: customer.name, source: 'openSea' },
  })
}

function openActions(customer: CustomerVO) {
  actionTarget.value = customer
  actionShow.value = true
}

async function claim(customer: CustomerVO) {
  try {
    await customerExtraApi.claim(customer.id, customer.poolId ?? selectedPoolId.value)
    showSuccessFeedback(`已领取「${customer.name}」`)
    actionShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function openAssign(customer: CustomerVO) {
  actionTarget.value = customer
  try {
    if (fieldRefs.members.value.length === 0) await fieldRefs.load()
    actionShow.value = false
    assignShow.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function assign({ selectedValues }: { selectedValues: string[] }) {
  const userId = selectedValues[0]
  if (!userId || !actionTarget.value) return
  try {
    await customerExtraApi.assign(actionTarget.value.id, userId, true)
    showSuccessFeedback('客户已分配')
    assignShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function remove(customer: CustomerVO) {
  const confirmed = await showActionConfirm({
    title: '删除公海客户',
    message: `确认删除「${customer.name}」？存在关联业务数据时会拒绝删除。`,
    confirmButtonText: '删除',
  })
  if (!confirmed) return
  try {
    await poolBatchDeleteCustomers([customer.id])
    showSuccessFeedback('客户已删除')
    actionShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

onMounted(initPools)
defineExpose({ reload, initPools })
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div class="bg-[var(--text-n10)] p-[8px_16px]">
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入客户名称"
        class="!p-0"
        @search="reload"
        @clear="reload"
      />
    </div>
    <div
      v-if="pools.length"
      class="flex min-h-12 gap-2 overflow-x-auto whitespace-nowrap border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-1 py-2"
    >
      <van-button
        v-for="pool in pools"
        :key="pool.id"
        round
        size="small"
        class="!border-none !px-4 !py-1 !text-sm"
        :class="
          selectedPoolId === pool.id
            ? '!bg-[var(--primary-7)] !text-[var(--primary-8)]'
            : '!bg-[var(--text-n9)] !text-[var(--text-n1)]'
        "
        @click="selectPool(pool.id)"
      >
        {{ pool.name }}
      </van-button>
    </div>

    <MobileViewBar
      v-if="poolsReady"
      module="customer_pool"
      @ready="handleViewReady"
      @change="handleViewChange"
    />

    <van-empty v-if="poolsReady && !pools.length" description="暂无可访问的客户公海" />
    <div v-else-if="viewsReady" class="min-h-0 flex-1 overflow-auto">
      <van-pull-refresh
        v-model="refreshing"
        class="min-h-full"
        @refresh="handleRefresh"
      >
        <van-list
          v-model:loading="loading"
          :finished="finished"
          finished-text="已经到底部啦~"
          class="flex flex-col gap-4 p-4"
          @load="loadMore"
        >
          <MobileCustomerListCard
            v-for="item in items"
            :key="item.id"
            :customer="item"
            :fields="listFields"
            :member-map="fieldRefs.memberMap.value"
            :dept-map="fieldRefs.deptMap.value"
            @open="goDetail"
          >
            <template #actions>
              <van-button
                v-if="auth.hasPerm('customerPool:pick')"
                icon="friends-o"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="claim(item)"
              >领取</van-button>
              <van-button
                v-if="auth.hasPerm('customerPool:assign') || auth.hasPerm('customerPool:delete')"
                icon="ellipsis"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="openActions(item)"
              >更多</van-button>
            </template>
          </MobileCustomerListCard>
        </van-list>
      </van-pull-refresh>
    </div>
    <van-loading v-else class="!flex !justify-center !py-10" />

    <van-action-sheet v-model:show="actionShow" title="客户公海操作">
      <div v-if="actionTarget" class="p-4 space-y-3">
        <van-button v-if="auth.hasPerm('customerPool:pick')" block @click="claim(actionTarget)"
          >领取</van-button
        >
        <van-button
          v-if="auth.hasPerm('customerPool:assign')"
          block
          @click="openAssign(actionTarget)"
          >分配</van-button
        >
        <van-button
          v-if="auth.hasPerm('customerPool:delete')"
          block
          type="danger"
          plain
          @click="remove(actionTarget)"
          >删除</van-button
        >
      </div>
    </van-action-sheet>

    <van-popup v-model:show="assignShow" position="bottom" round>
      <van-picker :columns="memberColumns" @confirm="assign" @cancel="assignShow = false" />
    </van-popup>
  </div>
</template>
