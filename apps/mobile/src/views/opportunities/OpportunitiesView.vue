<script setup lang="ts">
import { isCustomFieldKey, type FieldVO, type OpportunityVO } from '@micromatrix/shared'
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { showSuccessFeedback } from '@/utils/feedback'
import { opportunityApi } from '@/api/sales'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import { useAuthStore } from '@/stores/auth'

type OpportunityView = 'ALL' | 'SELF' | 'DEPARTMENT' | 'OPPORTUNITY_SUCCESS'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const keyword = ref('')
const activeView = ref<OpportunityView>('ALL')
const items = ref<OpportunityVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const createShow = ref(false)
const fields = ref<FieldVO[]>([])
const formModel = ref<Record<string, unknown>>({})
const saving = ref(false)

const filters: Array<{ text: string; value: OpportunityView }> = [
  { text: '全部', value: 'ALL' },
  { text: '我的商机', value: 'SELF' },
  { text: '部门商机', value: 'DEPARTMENT' },
  { text: '已赢单', value: 'OPPORTUNITY_SUCCESS' },
]

async function loadMore() {
  loading.value = true
  try {
    const { data } = await opportunityApi.list({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
      viewId: activeView.value,
    })
    if (refreshing.value) {
      items.value = []
      refreshing.value = false
    }
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
  loadMore()
}

function changeView(value: OpportunityView) {
  if (activeView.value === value) return
  activeView.value = value
  reload()
}

function goDetail(item: OpportunityVO) {
  router.push({ path: '/opportunities/detail', query: { id: item.id, name: item.name } })
}

async function openCreate() {
  try {
    if (!fields.value.length) {
      const { data } = await opportunityApi.moduleForm()
      fields.value = data.fields
    }
    formModel.value = {}
    createShow.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function handleCreate() {
  const name = String(formModel.value.name ?? '').trim()
  if (!name) {
    showFailToast('请填写商机名称')
    return
  }
  const payload: Record<string, unknown> = { customData: {} }
  for (const [key, value] of Object.entries(formModel.value)) {
    if (value === undefined || value === '') continue
    if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
    else payload[key] = value
  }
  saving.value = true
  try {
    await opportunityApi.create(payload)
    showSuccessFeedback('商机已创建')
    createShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  if (route.query.create === '1') void openCreate()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <div
      class="flex items-center gap-3 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 py-2"
    >
      <van-button
        v-if="auth.hasPerm('opportunity:create')"
        plain
        icon="plus"
        type="primary"
        size="small"
        @click="openCreate"
      />
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入商机名称"
        class="min-w-0 flex-1 !p-0"
        @search="reload"
        @clear="reload"
      />
    </div>
    <div
      class="flex min-h-12 gap-2 overflow-x-auto whitespace-nowrap border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-1 py-2"
    >
      <van-button
        v-for="filter in filters"
        :key="filter.value"
        round
        size="small"
        class="!border-none !px-4 !py-1 !text-sm"
        :class="
          activeView === filter.value
            ? '!bg-[var(--primary-7)] !text-[var(--primary-8)]'
            : '!bg-[var(--text-n9)] !text-[var(--text-n1)]'
        "
        @click="changeView(filter.value)"
      >
        {{ filter.text }}
      </van-button>
    </div>
    <van-pull-refresh v-model="refreshing" class="min-h-0 flex-1 overflow-auto" @refresh="reload">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="已经到底部啦~"
        class="flex flex-col gap-4 p-4"
        @load="loadMore"
      >
        <div
          v-for="item in items"
          :key="item.id"
          class="flex flex-col gap-2 rounded-[6px] bg-[var(--text-n10)] px-5 py-4"
          @click="goDetail(item)"
        >
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-n1)]">
              {{ item.name }}
            </div>
            <van-tag v-if="item.stageName" type="primary" plain>{{ item.stageName }}</van-tag>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex min-w-0 items-start gap-2">
              <span class="shrink-0 text-[var(--text-n4)]">客户</span>
              <span class="break-all text-[var(--text-n1)]">{{ item.customerName || '-' }}</span>
            </div>
            <div class="flex min-w-0 items-start gap-2">
              <span class="shrink-0 text-[var(--text-n4)]">负责人</span>
              <span class="break-all text-[var(--text-n1)]">{{ item.ownerName || '-' }}</span>
            </div>
            <div class="flex basis-full items-start gap-2">
              <span class="shrink-0 text-[var(--text-n4)]">预计金额</span>
              <span class="break-all text-[var(--text-n1)]">
                {{ item.amount == null ? '-' : `¥${Number(item.amount).toLocaleString()}` }}
              </span>
            </div>
          </div>
        </div>
      </van-list>
    </van-pull-refresh>

    <van-popup v-model:show="createShow" position="bottom" round class="h-[88%]">
      <div class="flex h-full flex-col bg-[var(--text-n10)]">
        <div
          class="flex min-h-12 items-center justify-center border-b-[0.5px] border-[var(--text-n8)] px-4 text-base font-medium text-[var(--text-n1)]"
        >
          新建商机
        </div>
        <div class="min-h-0 flex-1 overflow-auto py-4">
          <MobileDynamicForm v-model="formModel" :fields="fields" />
        </div>
        <div
          class="flex gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
        >
          <van-button block @click="createShow = false">取消</van-button>
          <van-button type="primary" block :loading="saving" @click="handleCreate">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
