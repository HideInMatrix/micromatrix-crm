<script setup lang="ts">
import type {
  CustomerVO,
  FieldVO,
  FilterCondition,
  ModuleQuickSearchConfig,
  QuickSearchQueryGroup,
} from '@micromatrix/shared'
import { computed, onActivated, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { getCustomerTabs, listCustomers } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import leadEmptyImage from '@/assets/lead-empty.png'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileCustomerListCard from '@/components/customer/MobileCustomerListCard.vue'
import MobileQuickSearchBar from '@/components/MobileQuickSearchBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import type { MobileViewSelection } from '@/types/mobile-view'

type CustomerSystemView = 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'
const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const quickSearch = ref<ModuleQuickSearchConfig | null>(null)
const filters = ref<FilterCondition[]>([])
const quickGroups = ref<QuickSearchQueryGroup[]>([])
const fields = ref<FieldVO[]>([])
const items = ref<CustomerVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeView = ref<CustomerSystemView | ''>('SELF')
const activeSavedViewId = ref('')
const systemViews = ref<{ id: CustomerSystemView; label: string }[]>([])
const systemViewsReady = ref(false)
const savedViewsReady = ref(false)
const viewsReady = computed(() => systemViewsReady.value && savedViewsReady.value)
const viewPickerShow = ref(false)
const followShow = ref(false)
const followTarget = ref<CustomerVO | null>(null)
let generation = 0
let loadingGeneration = -1

function canFollow(customer: CustomerVO): boolean {
  return (
    auth.hasPerm('customer:update') && !customer.inSea && customer.collaborationType !== 'READ_ONLY'
  )
}
async function loadMore() {
  if (!viewsReady.value || finished.value || loadingGeneration === generation) return
  const current = generation
  loadingGeneration = current
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: page.value,
      pageSize: 20,
      view: activeView.value || undefined,
      viewId: activeSavedViewId.value || undefined,
      keyword: typeof route.query.keyword === 'string' ? route.query.keyword : undefined,
      filters: filters.value.length ? JSON.stringify(filters.value) : undefined,
      quickGroups: quickGroups.value.length ? quickGroups.value : undefined,
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
  finished.value = false
  if (viewsReady.value) void loadMore()
}
function handleRefresh() {
  reload()
  refreshing.value = false
}
function goDetail(customer: CustomerVO) {
  void router.push({ path: '/customers/detail', query: { id: customer.id, name: customer.name } })
}
function callCustomer(customer: CustomerVO) {
  const phone = customer.phone?.replace(/[^\d+]/g, '') ?? ''
  if (!phone) return showFailToast('暂无可联系的手机号')
  window.location.href = `tel:${phone}`
}
function openFollow(customer: CustomerVO) {
  if (!canFollow(customer)) return
  followTarget.value = customer
  followShow.value = true
}
async function loadSystemViews() {
  try {
    const { data } = await getCustomerTabs()
    const next: { id: CustomerSystemView; label: string }[] = []
    if (data.all) next.push({ id: 'ALL', label: '全部客户' })
    next.push({ id: 'SELF', label: '我的客户' })
    if (data.dept) next.push({ id: 'DEPARTMENT', label: '部门客户' })
    next.push({ id: 'COLLABORATION', label: '协作客户' })
    systemViews.value = next
    if (quickSearch.value?.showSavedViews === false) activeView.value = ''
    else if (!next.some((item) => item.id === activeView.value))
      activeView.value = next[0]?.id ?? 'SELF'
  } catch (error) {
    systemViews.value = [
      { id: 'SELF', label: '我的客户' },
      { id: 'COLLABORATION', label: '协作客户' },
    ]
    activeView.value = quickSearch.value?.showSavedViews === false ? '' : 'SELF'
    showFailToast(extractErrorMessage(error))
  } finally {
    systemViewsReady.value = true
    if (savedViewsReady.value) reload()
  }
}
function applyView(selection: MobileViewSelection) {
  if (quickSearch.value?.showSavedViews === false) {
    activeSavedViewId.value = ''
    activeView.value = ''
    return
  }
  if (selection.type === 'saved') {
    activeSavedViewId.value = selection.id
    activeView.value = ''
  } else if (selection.type === 'system') {
    activeSavedViewId.value = ''
    activeView.value = selection.id as CustomerSystemView
  } else {
    activeSavedViewId.value = ''
    activeView.value = 'SELF'
  }
}
function handleViewReady(selection: MobileViewSelection) {
  applyView(selection)
  savedViewsReady.value = true
  if (systemViewsReady.value) reload()
}
function handleViewChange(selection: MobileViewSelection) {
  applyView(selection)
  viewPickerShow.value = false
  reload()
}
async function init() {
  try {
    const [{ data: config }] = await Promise.all([
      metadataApi.formConfig('customer'),
      fieldRefs.load(),
    ])
    fields.value = config.fields
    quickSearch.value = config.formProp.quickSearch ?? null
    if (quickSearch.value?.showSavedViews === false) activeView.value = ''
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
  await loadSystemViews()
}
function openViews() {
  viewPickerShow.value = !viewPickerShow.value
}
defineExpose({ reload, openViews })
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
      :fields="fields"
      :config="quickSearch"
      @search="reload"
    />
    <div v-show="viewPickerShow" class="shrink-0 bg-white">
      <MobileViewBar
        v-if="systemViewsReady"
        module="customer"
        :system-views="systemViews"
        :system-view="activeView"
        @ready="handleViewReady"
        @change="handleViewChange"
      />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <van-pull-refresh v-model="refreshing" class="min-h-full" @refresh="handleRefresh">
        <van-list
          v-if="viewsReady"
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
            :fields="fields"
            :member-map="fieldRefs.memberMap.value"
            :dept-map="fieldRefs.deptMap.value"
            :can-follow="canFollow(item)"
            @open="goDetail"
            @call="callCustomer"
            @follow="openFollow"
          />
          <div
            v-if="finished && !items.length"
            class="flex min-h-[360px] flex-col items-center justify-center gap-[20px]"
          >
            <van-image :src="leadEmptyImage" fit="contain" width="186" height="144" alt="" />
            <span class="text-[14px] leading-[20px] text-[#9E9E9E]">暂无客户</span>
          </div>
        </van-list>
        <van-loading v-else class="!flex !justify-center !py-10" />
      </van-pull-refresh>
    </div>
    <MobileFollowUpSheet
      v-model="followShow"
      target-type="customer"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="reload"
    />
  </div>
</template>
