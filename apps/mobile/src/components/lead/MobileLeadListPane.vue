<script setup lang="ts">
import type { FieldVO, LeadVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { fetchFields } from '@/api/mobile'
import { leadApi } from '@/api/sales'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileViewBar from '@/components/MobileViewBar.vue'
import MobileLeadListCard from '@/components/lead/MobileLeadListCard.vue'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import type { MobileViewSelection } from '@/types/mobile-view'

const router = useRouter()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const keyword = ref('')
const items = ref<LeadVO[]>([])
const fields = ref<FieldVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeSavedViewId = ref('')
const viewsReady = ref(false)
const followShow = ref(false)
const followTarget = ref<LeadVO | null>(null)

const listFields = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden),
)

async function loadMore() {
  if (!viewsReady.value) return
  loading.value = true
  try {
    const { data } = await leadApi.list({
      page: page.value,
      pageSize: 20,
      scope: 'mine',
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
  finished.value = false
  void loadMore()
}

async function handleRefresh() {
  page.value = 1
  items.value = []
  finished.value = false
  try {
    await loadMore()
  } finally {
    refreshing.value = false
  }
}

function openCreate() {
  router.push('/leads/create')
}

function openEdit(lead: LeadVO) {
  router.push('/leads/' + lead.id + '/edit')
}

function openDetail(lead: LeadVO) {
  router.push({
    path: '/leads/detail',
    query: { id: lead.id, name: lead.name },
  })
}

function openFollow(lead: LeadVO) {
  followTarget.value = lead
  followShow.value = true
}

function openConvert(lead: LeadVO) {
  router.push('/leads/' + lead.id + '/convert')
}

function applyViewSelection(selection: MobileViewSelection) {
  activeSavedViewId.value = selection.type === 'saved' ? selection.id : ''
}

function handleViewReady(selection: MobileViewSelection) {
  applyViewSelection(selection)
  viewsReady.value = true
}

function handleViewChange(selection: MobileViewSelection) {
  applyViewSelection(selection)
  reload()
}

async function remove(lead: LeadVO) {
  const confirmed = await showActionConfirm({
    title: '删除线索',
    message: '确认删除「' + lead.name + '」？',
    confirmButtonText: '删除',
  })
  if (!confirmed) return
  try {
    await leadApi.remove(lead.id)
    showSuccessFeedback('线索已删除')
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function loadMetadata() {
  try {
    const [{ data }] = await Promise.all([fetchFields('lead'), fieldRefs.load()])
    fields.value = data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

defineExpose({ reload })

onMounted(loadMetadata)
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div
      class="flex items-center gap-3 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 py-2"
    >
      <van-button
        v-if="auth.hasPerm('lead:create')"
        plain
        icon="plus"
        type="primary"
        size="small"
        @click="openCreate"
      />
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入线索名称或手机号"
        class="min-w-0 flex-1 !p-0"
        @search="reload"
        @clear="reload"
      />
    </div>

    <MobileViewBar
      module="lead"
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
                v-if="auth.hasPerm('lead:update')"
                icon="edit"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="openEdit(item)"
              >编辑</van-button>
              <van-button
                v-if="auth.hasPerm('lead:update')"
                icon="edit"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="openFollow(item)"
              >写跟进</van-button>
              <van-button
                v-if="
                  auth.hasPerm('lead:update') &&
                  !['CUSTOMER', 'OPPORTUNITY'].includes(item.transitionType ?? '')
                "
                icon="exchange"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="openConvert(item)"
              >转换</van-button>
              <van-button
                v-if="auth.hasPerm('lead:delete')"
                icon="delete-o"
                size="small"
                type="danger"
                plain
                class="!border-0"
                @click.stop="remove(item)"
              >删除</van-button>
            </template>
          </MobileLeadListCard>
        </van-list>
      </van-pull-refresh>
      <van-loading v-else class="!flex !justify-center !py-10" />
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

