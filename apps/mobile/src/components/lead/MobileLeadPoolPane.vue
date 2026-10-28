<script setup lang="ts">
import {
  DEFAULT_LEAD_STAGES,
  type FieldVO,
  type FilterCondition,
  type LeadStageConfig,
  type ModuleQuickSearchConfig,
  type QuickSearchQueryGroup,
  type LeadVO,
} from '@micromatrix/shared'
import { computed, onActivated, onMounted, ref } from 'vue'
import type { DropdownItemInstance } from 'vant'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import leadEmptyImage from '@/assets/lead-empty.png'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi, type ResourcePoolVO } from '@/api/sales'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileLeadListCard from '@/components/lead/MobileLeadListCard.vue'
import MobileQuickSearchBar from '@/components/MobileQuickSearchBar.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import { showSuccessFeedback } from '@/utils/feedback'
import type { MobileViewSelection } from '@/types/mobile-view'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const router = useRouter()

const quickSearch = ref<ModuleQuickSearchConfig | null>(null)
const quickGroups = ref<QuickSearchQueryGroup[]>([])
const filters = ref<FilterCondition[]>([])
const leadStages = ref<LeadStageConfig[]>([])
const viewPickerShow = ref(false)
const poolDropdownItem = ref<DropdownItemInstance | null>(null)
const poolKeyword = ref('')
const assignShow = ref(false)
const assignTarget = ref<LeadVO | null>(null)
const pools = ref<ResourcePoolVO[]>([])
const selectedPoolId = ref('')
const fields = ref<FieldVO[]>([])
const items = ref<LeadVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeSavedViewId = ref('')
const poolsReady = ref(false)
const savedViewsReady = ref(false)
const viewsReady = computed(() => poolsReady.value && savedViewsReady.value)
let generation = 0
let loadingGeneration = -1

const stageNames = computed(() =>
  Object.fromEntries(
    [...DEFAULT_LEAD_STAGES, ...leadStages.value].map((stage) => [stage.key, stage.name]),
  ),
)
const memberColumns = computed(() =>
  fieldRefs.members.value.map((member) => ({ text: member.name, value: member.id })),
)
const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const poolDropdownOptions = computed(() =>
  pools.value.map((pool) => ({ text: pool.name, value: pool.id })),
)
// 公海额外遵守线索池的隐藏字段配置；移动端及列表显隐规则由卡片统一处理。
const listFields = computed(() => {
  const hiddenIds = new Set(currentPool.value?.hiddenFieldIds ?? [])
  return fields.value.filter((field) => !hiddenIds.has(field.id))
})

async function init() {
  try {
    const [{ data: poolData }, { data: config }] = await Promise.all([
      leadApi.poolOptions(),
      metadataApi.formConfig('lead'),
      fieldRefs.load(),
    ])
    pools.value = poolData
    fields.value = config.fields
    leadStages.value = config.formProp.leadStages ?? []
    quickSearch.value = config.formProp.quickSearch ?? null
    if (!poolData.some((pool) => pool.id === selectedPoolId.value))
      selectedPoolId.value = poolData[0]?.id ?? ''
    if (!selectedPoolId.value) finished.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    poolsReady.value = true
    // 数据源与视图配置异步加载，任意顺序完成后均保证首屏触发查询。
    if (savedViewsReady.value) reload()
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
    const { data } = await leadApi.list({
      page: page.value,
      pageSize: 20,
      scope: 'pool',
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
  page.value = 1
  items.value = []
  finished.value = !selectedPoolId.value
  if (viewsReady.value && selectedPoolId.value) void loadMore()
}
function handleRefresh() {
  reload()
  refreshing.value = false
}

function setPool(poolId: string) {
  if (!pools.value.some((pool) => pool.id === poolId) || selectedPoolId.value === poolId) return
  selectedPoolId.value = poolId
  reload()
}

function openDetail(lead: LeadVO) {
  router.push({
    path: '/leads/pool-detail',
    query: { id: lead.id, name: lead.name },
  })
}

function applyViewSelection(selection: MobileViewSelection) {
  activeSavedViewId.value = selection.type === 'saved' ? selection.id : ''
}

function handleViewReady(selection: MobileViewSelection) {
  applyViewSelection(selection)
  savedViewsReady.value = true
  reload()
}

function handleViewChange(selection: MobileViewSelection) {
  applyViewSelection(selection)
  viewPickerShow.value = false
  reload()
}

async function claim(lead: LeadVO) {
  try {
    const poolId = lead.poolId ?? selectedPoolId.value
    if (!poolId) return
    await leadApi.claim(lead.id, poolId)
    showSuccessFeedback('已领取「' + lead.name + '」')
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
function openAssign(lead: LeadVO) {
  assignTarget.value = lead
  assignShow.value = true
}
async function assign({ selectedValues }: { selectedValues: string[] }) {
  const memberId = selectedValues[0]
  if (!memberId || !assignTarget.value) return
  try {
    await leadApi.poolAssign(assignTarget.value.id, memberId)
    showSuccessFeedback('线索已分配')
    assignShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
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
      :stages="leadStages"
      @search="reload"
    >
      <template #search-prefix>
        <van-dropdown-menu
          class="h-[32px] w-full"
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
            :model-value="selectedPoolId"
            :title="currentPool?.name ?? '选择线索池'"
            title-class="!min-w-0 truncate"
            :options="poolDropdownOptions"
            :disabled="!pools.length"
            @change="setPool"
          />
        </van-dropdown-menu>
      </template>
    </MobileQuickSearchBar>
    <div v-show="viewPickerShow" class="shrink-0 bg-white">
      <MobileViewBar module="lead_pool" @ready="handleViewReady" @change="handleViewChange" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <van-pull-refresh v-model="refreshing" class="min-h-full" @refresh="handleRefresh">
        <van-list
          v-if="viewsReady && selectedPoolId"
          v-model:loading="loading"
          :finished="finished"
          :finished-text="items.length ? '没有更多线索了' : ''"
          class="flex flex-col gap-[12px] px-[12px] pt-[12px] pb-[16px]"
          @load="loadMore"
        >
          <MobileLeadListCard
            v-for="item in items"
            :key="item.id"
            :lead="item"
            :fields="listFields"
            :member-map="fieldRefs.memberMap.value"
            :dept-map="fieldRefs.deptMap.value"
            :stage-names="stageNames"
            mode="pool"
            :can-assign="auth.hasPerm('leadPool:assign')"
            :can-claim="auth.hasPerm('leadPool:pick')"
            @open="openDetail(item)"
            @assign="openAssign(item)"
            @claim="claim(item)"
          />
          <div
            v-if="finished && items.length === 0"
            class="flex min-h-[360px] flex-col items-center justify-center gap-[20px]"
          >
            <van-image :src="leadEmptyImage" fit="contain" width="186" height="144" alt="" />
            <span class="text-[14px] leading-[20px] text-[#9E9E9E]">暂无线索</span>
          </div>
        </van-list>
        <van-loading v-else-if="!viewsReady" class="!flex !justify-center !py-10" />
        <van-empty
          v-else
          image-size="90"
          description="暂无线索池，请在更多操作中选择"
          class="!py-[80px]"
        />
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
