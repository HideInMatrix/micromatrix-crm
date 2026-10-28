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
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import leadEmptyImage from '@/assets/lead-empty.png'
import { extractErrorMessage } from '@/api/http'
import { metadataApi } from '@/api/metadata'
import { leadApi } from '@/api/sales'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileQuickSearchBar from '@/components/MobileQuickSearchBar.vue'
import MobileLeadListCard from '@/components/lead/MobileLeadListCard.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import type { MobileViewSelection } from '@/types/mobile-view'

const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const quickSearch = ref<ModuleQuickSearchConfig | null>(null)
const quickGroups = ref<QuickSearchQueryGroup[]>([])
const filters = ref<FilterCondition[]>([])
const items = ref<LeadVO[]>([])
const fields = ref<FieldVO[]>([])
const leadStages = ref<LeadStageConfig[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeSavedViewId = ref('')
const viewsReady = ref(false)
const viewPickerShow = ref(false)
const followShow = ref(false)
const followTarget = ref<LeadVO | null>(null)
let generation = 0
let loadingGeneration = -1

const canFollow = (lead: LeadVO) =>
  auth.hasPerm('lead:update') && lead.transitionType !== 'CUSTOMER'
const stageNames = computed(() =>
  Object.fromEntries(
    [...DEFAULT_LEAD_STAGES, ...leadStages.value].map((stage) => [stage.key, stage.name]),
  ),
)

async function loadMore() {
  if (!viewsReady.value || finished.value || loadingGeneration === generation) return
  const current = generation
  loadingGeneration = current
  loading.value = true
  try {
    const { data } = await leadApi.list({
      page: page.value,
      pageSize: 20,
      scope: 'mine',
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
  finished.value = false
  if (viewsReady.value) void loadMore()
}
async function handleRefresh() {
  reload()
  refreshing.value = false
}
function openDetail(lead: LeadVO) {
  void router.push({ path: '/leads/detail', query: { id: lead.id, name: lead.name } })
}
function callLead(lead: LeadVO) {
  const number = lead.phone?.replace(/[^\d+]/g, '') ?? ''
  if (!number) return showFailToast('暂无可联系的手机号')
  window.location.href = `tel:${number}`
}
function openFollow(lead: LeadVO) {
  if (!canFollow(lead)) return
  followTarget.value = lead
  followShow.value = true
}
function applyView(selection: MobileViewSelection) {
  activeSavedViewId.value = selection.type === 'saved' ? selection.id : ''
}
function handleViewReady(selection: MobileViewSelection) {
  applyView(selection)
  viewsReady.value = true
  reload()
}
function handleViewChange(selection: MobileViewSelection) {
  applyView(selection)
  viewPickerShow.value = false
  reload()
}
async function init() {
  try {
    const [{ data: config }] = await Promise.all([metadataApi.formConfig('lead'), fieldRefs.load()])
    fields.value = config.fields
    leadStages.value = config.formProp.leadStages ?? []
    quickSearch.value = config.formProp.quickSearch ?? null
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
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
      :stages="leadStages"
      @search="reload"
    />
    <div v-show="viewPickerShow" class="shrink-0 bg-white">
      <MobileViewBar module="lead" @ready="handleViewReady" @change="handleViewChange" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <van-pull-refresh v-model="refreshing" class="min-h-full" @refresh="handleRefresh">
        <van-list
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
            :fields="fields"
            :member-map="fieldRefs.memberMap.value"
            :dept-map="fieldRefs.deptMap.value"
            :stage-names="stageNames"
            :can-follow="canFollow(item)"
            @open="openDetail(item)"
            @call="callLead(item)"
            @follow="openFollow(item)"
          />
          <div
            v-if="finished && items.length === 0"
            class="flex min-h-[360px] flex-col items-center justify-center gap-[20px]"
          >
            <van-image :src="leadEmptyImage" fit="contain" width="186" height="144" alt="" />
            <span class="text-[14px] leading-[20px] text-[#9E9E9E]">暂无线索</span>
          </div>
        </van-list>
      </van-pull-refresh>
    </div>
    <MobileFollowUpSheet
      v-model="followShow"
      target-type="lead"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="reload"
    />
  </div>
</template>
