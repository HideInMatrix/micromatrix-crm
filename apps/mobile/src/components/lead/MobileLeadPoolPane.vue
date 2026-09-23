<script setup lang="ts">
import type { FieldVO, LeadVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { fetchFields } from '@/api/mobile'
import { leadApi, type ResourcePoolVO } from '@/api/sales'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileLeadListCard from '@/components/lead/MobileLeadListCard.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import { showSuccessFeedback } from '@/utils/feedback'
import type { MobileViewSelection } from '@/types/mobile-view'

const auth = useAuthStore()
const fieldRefs = useFieldRefs()
const router = useRouter()

const keyword = ref('')
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

const currentPool = computed(
  () => pools.value.find((pool) => pool.id === selectedPoolId.value) ?? null,
)
const listFields = computed(() => {
  const hiddenIds = new Set(currentPool.value?.hiddenFieldIds ?? [])
  const visible = fields.value.filter(
    (field) =>
      field.showInList &&
      !field.hidden &&
      (field.key === 'name' || !hiddenIds.has(field.id)),
  )
  const nameField = fields.value.find((field) => field.key === 'name' && !field.hidden)
  if (nameField && !visible.some((field) => field.key === 'name')) visible.unshift(nameField)
  return visible
})

async function init() {
  try {
    const [{ data: poolData }, { data: fieldData }] = await Promise.all([
      leadApi.poolOptions(),
      fetchFields('lead'),
      fieldRefs.load(),
    ])
    pools.value = poolData
    fields.value = fieldData
    selectedPoolId.value = poolData[0]?.id ?? ''
    if (!selectedPoolId.value) finished.value = true
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
    const { data } = await leadApi.list({
      page: page.value,
      pageSize: 20,
      scope: 'pool',
      poolId: selectedPoolId.value,
      keyword: keyword.value.trim() || undefined,
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
  finished.value = !selectedPoolId.value
  if (viewsReady.value && selectedPoolId.value) void loadMore()
}

async function handleRefresh() {
  page.value = 1
  items.value = []
  finished.value = !selectedPoolId.value
  try {
    if (selectedPoolId.value) await loadMore()
  } finally {
    refreshing.value = false
  }
}

function setPool(poolId: string) {
  if (selectedPoolId.value === poolId) return
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
}

function handleViewChange(selection: MobileViewSelection) {
  applyViewSelection(selection)
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

onMounted(init)
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div
      class="flex items-center gap-3 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 py-2"
    >
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入线索名称或手机号"
        class="min-w-0 flex-1 !p-0"
        @search="reload"
        @clear="reload"
      />
    </div>

    <div
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
        @click="setPool(pool.id)"
      >{{ pool.name }}</van-button>
    </div>

    <MobileViewBar
      v-if="poolsReady"
      module="lead_pool"
      @ready="handleViewReady"
      @change="handleViewChange"
    />

    <div class="min-h-0 flex-1 overflow-auto">
      <van-pull-refresh
        v-if="viewsReady"
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
          <MobileLeadListCard
            v-for="item in items"
            :key="item.id"
            :lead="item"
            :fields="listFields"
            :member-map="fieldRefs.memberMap.value"
            :dept-map="fieldRefs.deptMap.value"
            @click="openDetail(item)"
          >
            <template #actions>
              <van-button
                v-if="auth.hasPerm('leadPool:pick')"
                icon="friends-o"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="claim(item)"
              >领取</van-button>
            </template>
          </MobileLeadListCard>
        </van-list>
      </van-pull-refresh>
      <van-loading v-else class="!flex !justify-center !py-10" />
    </div>
  </div>
</template>
