<script setup lang="ts">
import type {
  CustomerVO,
  FieldVO,
  FilterCondition,
  ModuleQuickSearchConfig,
  QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, type DropdownItemInstance } from 'vant'
import { listCustomers, poolBatchDeleteCustomers } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { customerExtraApi, resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import leadEmptyImage from '@/assets/lead-empty.png'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileCustomerListCard from '@/components/customer/MobileCustomerListCard.vue'
import MobileQuickSearchBar from '@/components/MobileQuickSearchBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import type { MobileViewSelection } from '@/types/mobile-view'

const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const pools = ref<ResourcePoolVO[]>([])
const selectedPoolId = ref('')
const fields = ref<FieldVO[]>([])
const quickSearch = ref<ModuleQuickSearchConfig | null>(null)
const filters = ref<FilterCondition[]>([])
const quickGroups = ref<QuickSearchQueryGroup[]>([])
const items = ref<CustomerVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeSavedViewId = ref('')
const poolsReady = ref(false)
const savedViewsReady = ref(false)
const viewsReady = computed(() => poolsReady.value && savedViewsReady.value)
const viewPickerShow = ref(false)
const poolDropdownItem = ref<DropdownItemInstance | null>(null)
const poolKeyword = ref('')
const assignShow = ref(false)
const assignTarget = ref<CustomerVO | null>(null)
let generation = 0
let loadingGeneration = -1

const memberColumns = computed(() =>
  fieldRefs.members.value.map((item) => ({ text: item.name, value: item.id })),
)
const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const poolDropdownOptions = computed(() =>
  pools.value.map((pool) => ({ text: pool.name, value: pool.id })),
)
const listFields = computed(() => {
  const hiddenIds = new Set(currentPool.value?.hiddenFieldIds ?? [])
  return fields.value.filter((field) => !hiddenIds.has(field.id))
})
async function init() {
  try {
    const [{ data: poolData }, { data: config }] = await Promise.all([
      resourcePoolApi.options('customer'),
      metadataApi.formConfig('customer'),
      fieldRefs.load(),
    ])
    pools.value = poolData
    fields.value = config.fields
    quickSearch.value = config.formProp.quickSearch ?? null
    if (!poolData.some((pool) => pool.id === selectedPoolId.value))
      selectedPoolId.value = poolData[0]?.id ?? ''
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    poolsReady.value = true
    if (viewsReady.value) reload()
  }
}
async function loadMore() {
  if (
    !viewsReady.value ||
    !selectedPoolId.value ||
    finished.value ||
    loadingGeneration === generation
  )
    return
  const current = generation
  loadingGeneration = current
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: page.value,
      pageSize: 20,
      scope: 'sea',
      poolId: selectedPoolId.value,
      keyword: poolKeyword.value.trim() || undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
      quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
      viewId: activeSavedViewId.value || undefined,
    })
    if (current !== generation) return
    items.value.push(...data.items)
    finished.value = items.value.length >= data.total || data.items.length === 0
    page.value += 1
  } catch (error) {
    if (current !== generation) return
    showFailToast(extractErrorMessage(error))
    finished.value = true
  } finally {
    if (current === generation) {
      loading.value = false
      loadingGeneration = -1
    }
  }
}
function reload() {
  generation += 1
  loadingGeneration = -1
  loading.value = false
  items.value = []
  page.value = 1
  finished.value = !selectedPoolId.value
  if (viewsReady.value && selectedPoolId.value) void loadMore()
}
function handleRefresh() {
  reload()
  refreshing.value = false
}
function setPool(id: string) {
  if (!pools.value.some((pool) => pool.id === id) || id === selectedPoolId.value) return
  selectedPoolId.value = id
  reload()
}
function applyView(selection: MobileViewSelection) {
  activeSavedViewId.value =
    quickSearch.value?.showSavedViews === false
      ? ''
      : selection.type === 'saved'
        ? selection.id
        : ''
}
function handleViewReady(selection: MobileViewSelection) {
  applyView(selection)
  savedViewsReady.value = true
  if (poolsReady.value) reload()
}
function handleViewChange(selection: MobileViewSelection) {
  applyView(selection)
  viewPickerShow.value = false
  reload()
}
function goDetail(customer: CustomerVO) {
  void router.push({
    path: '/customers/detail',
    query: { id: customer.id, name: customer.name, source: 'openSea' },
  })
}
async function claim(customer: CustomerVO) {
  if (!auth.hasPerm('customerPool:pick')) return
  try {
    await customerExtraApi.claim(customer.id, customer.poolId ?? selectedPoolId.value)
    showSuccessFeedback(`已领取「${customer.name}」`)
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}
async function openAssign(customer: CustomerVO) {
  if (!auth.hasPerm('customerPool:assign')) return
  assignTarget.value = customer
  try {
    if (!fieldRefs.members.value.length) await fieldRefs.load()
    assignShow.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}
async function assign({ selectedValues }: { selectedValues: string[] }) {
  const userId = selectedValues[0]
  if (!userId || !assignTarget.value || !auth.hasPerm('customerPool:assign')) return
  try {
    await customerExtraApi.assign(assignTarget.value.id, userId, true)
    showSuccessFeedback('客户已分配')
    assignShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}
async function remove(customer: CustomerVO) {
  if (!auth.hasPerm('customerPool:delete')) return
  const confirmed = await showActionConfirm({
    title: '删除公海客户',
    message: `确认删除「${customer.name}」？存在关联业务数据时会拒绝删除。`,
    confirmButtonText: '删除',
  })
  if (!confirmed) return
  try {
    await poolBatchDeleteCustomers([customer.id])
    showSuccessFeedback('客户已删除')
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}
function openViews() {
  viewPickerShow.value = !viewPickerShow.value
}
function openPools() {
  poolDropdownItem.value?.toggle(true)
}
defineExpose({ reload, openViews, openPools })
onMounted(init)
onActivated(() => {
  if (viewsReady.value) reload()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-[#F5F5F5]">
    <MobileQuickSearchBar
      v-model:filters="filters"
      v-model:quick-groups="quickGroups"
      v-model:keyword="poolKeyword"
      :fields="fields"
      :config="quickSearch"
      @search="reload"
    >
      <template #search-prefix>
        <van-dropdown-menu
          class="pool-selector-dropdown h-[32px] w-full"
          :z-index="1002"
          active-color="var(--van-primary-color)"
          style="
            --van-dropdown-menu-height: 32px;
            --van-dropdown-menu-background: transparent;
            --van-dropdown-menu-shadow: none;
            --van-dropdown-menu-title-font-size: 12px;
            --van-dropdown-menu-title-text-color: #333333;
            --van-dropdown-menu-title-active-text-color: var(--van-primary-color);
            --van-dropdown-menu-title-padding: 0;
            --van-dropdown-menu-title-line-height: 16px;
            --van-dropdown-menu-content-max-height: 55vh;
          "
        >
          <van-dropdown-item
            ref="poolDropdownItem"
            teleport="body"
            class="pool-selector-dropdown-item"
            :model-value="selectedPoolId"
            :title="currentPool?.name ?? '选择客户公海'"
            title-class="!min-w-0 truncate"
            :options="poolDropdownOptions"
            :disabled="!pools.length"
            @change="setPool"
          />
        </van-dropdown-menu>
      </template>
    </MobileQuickSearchBar>
    <div v-show="viewPickerShow" class="shrink-0 bg-white">
      <MobileViewBar module="customer_pool" @ready="handleViewReady" @change="handleViewChange" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <van-pull-refresh v-model="refreshing" class="min-h-full" @refresh="handleRefresh">
        <van-list
          v-if="viewsReady && selectedPoolId"
          v-model:loading="loading"
          :finished="finished"
          :finished-text="items.length ? '没有更多客户了' : ''"
          class="flex flex-col gap-[12px] px-[12px] pt-[12px] pb-[16px]"
          @load="loadMore"
        >
          <MobileCustomerListCard
            v-for="item in items"
            :key="item.id"
            :customer="item"
            :fields="listFields"
            :member-map="fieldRefs.memberMap.value"
            :dept-map="fieldRefs.deptMap.value"
            mode="pool"
            :can-assign="auth.hasPerm('customerPool:assign')"
            :can-claim="auth.hasPerm('customerPool:pick')"
            :can-delete="auth.hasPerm('customerPool:delete')"
            @open="goDetail"
            @assign="openAssign"
            @claim="claim"
            @delete="remove"
          />
          <div
            v-if="finished && !items.length"
            class="flex min-h-[360px] flex-col items-center justify-center gap-[20px]"
          >
            <van-image :src="leadEmptyImage" fit="contain" width="186" height="144" alt="" />
            <span class="text-[14px] leading-[20px] text-[#9E9E9E]">暂无客户</span>
          </div>
        </van-list>
        <van-loading v-else-if="!viewsReady" class="!flex !justify-center !py-10" />
        <van-empty v-else image-size="90" description="暂无可访问的客户公海" class="!py-[80px]" />
      </van-pull-refresh>
    </div>
    <van-popup v-model:show="assignShow" position="bottom" round>
      <van-picker
        title="分配负责人"
        :columns="memberColumns"
        @confirm="assign"
        @cancel="assignShow = false"
      />
    </van-popup>
  </div>
</template>
