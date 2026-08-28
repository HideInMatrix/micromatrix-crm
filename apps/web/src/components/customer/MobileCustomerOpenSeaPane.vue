<script setup lang="ts">
import type { CustomerVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import { listCustomers, poolBatchDeleteCustomers } from '@/api/customers'
import { extractErrorMessage } from '@/api/http'
import { customerExtraApi, resourcePoolApi, type ResourcePoolVO } from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'
import { useAuthStore } from '@/stores/auth'

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

const actionShow = ref(false)
const actionTarget = ref<CustomerVO | null>(null)
const assignShow = ref(false)

const memberColumns = computed(() =>
  fieldRefs.members.value.map((item) => ({ text: item.name, value: item.id })),
)

async function initPools() {
  try {
    const { data } = await resourcePoolApi.options('customer')
    pools.value = data
    if (!selectedPoolId.value || !data.some((item) => item.id === selectedPoolId.value)) {
      selectedPoolId.value = data[0]?.id ?? ''
    }
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function loadMore() {
  if (!selectedPoolId.value || loading.value || finished.value) return
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
      scope: 'sea',
      poolId: selectedPoolId.value,
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
  if (selectedPoolId.value) loadMore()
}

function selectPool(poolId: string) {
  if (selectedPoolId.value === poolId) return
  selectedPoolId.value = poolId
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
    showSuccessToast(`已领取「${customer.name}」`)
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
    showSuccessToast('客户已分配')
    assignShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function remove(customer: CustomerVO) {
  const confirmed = await showConfirmDialog({
    title: '删除公海客户',
    message: `确认删除「${customer.name}」？存在关联业务数据时会拒绝删除。`,
    confirmButtonText: '删除',
    confirmButtonColor: '#ee0a24',
  }).then(() => true).catch(() => false)
  if (!confirmed) return
  try {
    await poolBatchDeleteCustomers([customer.id])
    showSuccessToast('客户已删除')
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
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[#f7f8fa]">
    <div class="bg-white px-3 pt-2">
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="搜索客户名称 / 电话 / 邮箱"
        @search="reload"
        @clear="reload"
      />
      <div v-if="pools.length" class="flex gap-2 overflow-x-auto px-3 pb-3">
        <van-button
          v-for="pool in pools"
          :key="pool.id"
          size="small"
          round
          :type="selectedPoolId === pool.id ? 'primary' : 'default'"
          :plain="selectedPoolId !== pool.id"
          @click="selectPool(pool.id)"
        >
          {{ pool.name }}
        </van-button>
      </div>
    </div>

    <van-empty v-if="!pools.length" description="暂无可访问的客户公海" />
    <van-pull-refresh v-else v-model="refreshing" class="flex-1 overflow-auto" @refresh="reload">
      <van-list v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="loadMore">
        <van-cell-group v-for="item in items" :key="item.id" inset class="!mb-3">
          <van-cell
            :title="item.name"
            :label="item.industry ?? '行业未填写'"
            is-link
            @click="goDetail(item)"
          >
            <template #value><span class="text-xs">{{ item.phone || '-' }}</span></template>
          </van-cell>
          <van-cell>
            <template #title>
              <span class="text-xs text-gray-400">
                入池：{{ item.poolEnteredAt ? new Date(item.poolEnteredAt).toLocaleDateString() : '-' }}
              </span>
            </template>
            <template #value>
              <div class="flex gap-2 justify-end">
                <van-button
                  v-if="auth.hasPerm('customerPool:pick')"
                  size="small"
                  plain
                  type="primary"
                  @click="claim(item)"
                >领取</van-button>
                <van-button
                  v-if="auth.hasPerm('customerPool:pick') || auth.hasPerm('customerPool:assign') || auth.hasPerm('customerPool:delete')"
                  size="small"
                  plain
                  @click="openActions(item)"
                >更多</van-button>
              </div>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <van-action-sheet v-model:show="actionShow" title="客户公海操作">
      <div v-if="actionTarget" class="p-4 space-y-3">
        <van-button v-if="auth.hasPerm('customerPool:pick')" block @click="claim(actionTarget)">领取</van-button>
        <van-button v-if="auth.hasPerm('customerPool:assign')" block @click="openAssign(actionTarget)">分配</van-button>
        <van-button
          v-if="auth.hasPerm('customerPool:delete')"
          block
          type="danger"
          plain
          @click="remove(actionTarget)"
        >删除</van-button>
      </div>
    </van-action-sheet>

    <van-popup v-model:show="assignShow" position="bottom" round>
      <van-picker :columns="memberColumns" @confirm="assign" @cancel="assignShow = false" />
    </van-popup>
  </div>
</template>
