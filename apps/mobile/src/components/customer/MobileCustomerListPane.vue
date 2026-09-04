<script setup lang="ts">
import { isCustomFieldKey, type CustomerVO, type FieldVO } from '@micromatrix/shared'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast, showSuccessToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import MobileFollowUpSheet from '@/components/MobileFollowUpSheet.vue'
import MobileDynamicForm from '@/components/MobileDynamicForm.vue'
import { createCustomer, fetchFields, listCustomers } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()

const keyword = ref('')
const items = ref<CustomerVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)

const followShow = ref(false)
const followTarget = ref<CustomerVO | null>(null)
const createShow = ref(false)
const fields = ref<FieldVO[]>([])
const formModel = ref<Record<string, unknown>>({})
const saving = ref(false)

async function loadMore() {
  loading.value = true
  try {
    const { data } = await listCustomers({
      page: page.value,
      pageSize: 20,
      keyword: keyword.value.trim() || undefined,
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

function goDetail(customer: CustomerVO) {
  router.push({ path: '/customers/detail', query: { id: customer.id, name: customer.name } })
}

function openFollow(customer: CustomerVO) {
  followTarget.value = customer
  followShow.value = true
}

async function openCreate() {
  if (fields.value.length === 0) {
    const { data } = await fetchFields('customer')
    fields.value = data
  }
  formModel.value = {}
  createShow.value = true
}

async function handleCreate() {
  if (!formModel.value.name || String(formModel.value.name).trim() === '') {
    showFailToast('请填写客户名称')
    return
  }
  saving.value = true
  try {
    const payload: Record<string, unknown> = { customData: {} }
    for (const [key, value] of Object.entries(formModel.value)) {
      if (value === undefined || value === '') continue
      if (isCustomFieldKey(key)) (payload.customData as Record<string, unknown>)[key] = value
      else payload[key] = value
    }
    await createCustomer(payload)
    showSuccessToast('客户已创建')
    createShow.value = false
    reload()
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

defineExpose({ reload })
</script>

<template>
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <div class="bg-white px-3 pt-2">
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="搜索名称 / 电话 / 邮箱"
        @search="reload"
        @clear="reload"
      />
      <div v-if="auth.hasPerm('customer:create')" class="px-3 pb-2">
        <van-button type="primary" plain block size="small" @click="openCreate"
          >新建客户</van-button
        >
      </div>
    </div>

    <van-pull-refresh v-model="refreshing" class="flex-1 overflow-auto" @refresh="reload">
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="没有更多了"
        @load="loadMore"
      >
        <van-cell-group v-for="item in items" :key="item.id" inset class="crm-mobile-list-card">
          <van-cell
            :title="item.name"
            :label="item.industry ?? '行业未填写'"
            is-link
            @click="goDetail(item)"
          >
            <template #value
              ><span class="text-xs">{{ item.ownerName ?? '-' }}</span></template
            >
          </van-cell>
          <van-cell>
            <template #title>
              <span class="text-xs text-gray-400">{{ item.phone || '无电话' }}</span>
            </template>
            <template #value>
              <div class="flex gap-2 justify-end">
                <a v-if="item.phone" :href="`tel:${item.phone}`">
                  <van-button size="small" plain>拨打</van-button>
                </a>
                <van-button
                  v-if="auth.hasPerm('customer:update')"
                  size="small"
                  plain
                  type="primary"
                  @click="openFollow(item)"
                  >跟进</van-button
                >
              </div>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <MobileFollowUpSheet
      v-model="followShow"
      target-type="customer"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="reload"
    />

    <van-popup v-model:show="createShow" position="bottom" round :style="{ height: '85%' }">
      <div class="h-full flex flex-col">
        <div class="p-4 text-center font-medium">新建客户</div>
        <div class="flex-1 overflow-auto">
          <MobileDynamicForm v-model="formModel" :fields="fields" />
        </div>
        <div class="p-4">
          <van-button type="primary" block :loading="saving" @click="handleCreate">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
