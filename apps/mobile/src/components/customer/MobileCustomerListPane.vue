<script setup lang="ts">
import type { CustomerVO, FieldVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { listCustomers, removeCustomer } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileCustomerListCard from '@/components/customer/MobileCustomerListCard.vue'
import { showActionConfirm } from '@/utils/dialog'
import { showSuccessFeedback } from '@/utils/feedback'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { fetchFields } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const fieldRefs = useFieldRefs()

const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
const items = ref<CustomerVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const activeView = ref<'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION'>('ALL')
const viewButtons = [
  { value: 'ALL' as const, label: '全部' },
  { value: 'SELF' as const, label: '我的客户' },
  { value: 'DEPARTMENT' as const, label: '部门客户' },
  { value: 'COLLABORATION' as const, label: '协作客户' },
]

const followShow = ref(false)
const followTarget = ref<CustomerVO | null>(null)
const fields = ref<FieldVO[]>([])
const listFields = computed(() =>
  fields.value.filter((field) => field.showInList && !field.hidden),
)

async function loadMore() {
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
      view: activeView.value,
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
  loadMore()
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

function setView(value: typeof activeView.value) {
  if (activeView.value === value) return
  activeView.value = value
  reload()
}

function goDetail(customer: CustomerVO) {
  router.push({ path: '/customers/detail', query: { id: customer.id, name: customer.name } })
}

function goEdit(customer: CustomerVO) {
  router.push(`/customers/${customer.id}/edit`)
}

function goTransfer(customer: CustomerVO) {
  router.push({
    path: '/customers/detail',
    query: { id: customer.id, name: customer.name, action: 'transfer' },
  })
}

function openFollow(customer: CustomerVO) {
  followTarget.value = customer
  followShow.value = true
}

async function handleDelete(customer: CustomerVO) {
  const confirmed = await showActionConfirm({
    title: '删除客户',
    message: `确认删除「${customer.name}」？`,
    confirmButtonText: '删除',
  })
  if (!confirmed) return

  try {
    await removeCustomer(customer.id)
    showSuccessFeedback('客户已删除')
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

function openCreate() {
  router.push('/customers/create')
}

async function loadMetadata() {
  try {
    const [{ data }] = await Promise.all([fetchFields('customer'), fieldRefs.load()])
    fields.value = data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

defineExpose({ reload })

onMounted(async () => {
  await loadMetadata()
  if (keyword.value) reload()
})
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div
      class="flex items-center gap-3 border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 py-2"
    >
      <van-button
        v-if="auth.hasPerm('customer:create')"
        plain
        icon="plus"
        type="primary"
        size="small"
        @click="openCreate"
      />
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="请输入客户名称"
        class="min-w-0 flex-1 !p-0"
        @search="reload"
        @clear="reload"
      />
    </div>
    <div
      class="flex min-h-12 gap-2 overflow-x-auto whitespace-nowrap border-b-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-1 py-2"
    >
      <van-button
        v-for="button in viewButtons"
        :key="button.value"
        round
        size="small"
        class="!border-none !px-4 !py-1 !text-sm"
        :class="
          activeView === button.value
            ? '!bg-[var(--primary-7)] !text-[var(--primary-8)]'
            : '!bg-[var(--text-n9)] !text-[var(--text-n1)]'
        "
        @click="setView(button.value)"
      >
        {{ button.label }}
      </van-button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
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
                v-if="auth.hasPerm('customer:update')"
                icon="edit"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="goEdit(item)"
              >
                编辑
              </van-button>
              <van-button
                v-if="auth.hasPerm('customer:transfer')"
                icon="exchange"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="goTransfer(item)"
              >
                转移
              </van-button>
              <van-button
                v-if="auth.hasPerm('customer:update')"
                icon="edit"
                size="small"
                type="primary"
                plain
                class="!border-0"
                @click.stop="openFollow(item)"
              >
                写跟进
              </van-button>
              <van-button
                v-if="auth.hasPerm('customer:delete')"
                icon="delete-o"
                size="small"
                type="danger"
                plain
                class="!border-0"
                @click.stop="handleDelete(item)"
              >
                删除
              </van-button>
            </template>
          </MobileCustomerListCard>
        </van-list>
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
