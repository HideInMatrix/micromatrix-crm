<script setup lang="ts">
import { isCustomFieldKey, type CustomerVO, type FieldVO } from '@micromatrix/shared'
import { showFailToast, showSuccessToast } from 'vant'
import { ref } from 'vue'
import { createCustomer, fetchFields, listCustomers } from '@/mobile/api'
import { extractErrorMessage } from '@/api/http'
import FollowUpSheet from '@/mobile/components/FollowUpSheet.vue'
import MobileDynamicForm from '@/mobile/components/MobileDynamicForm.vue'

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
</script>

<template>
  <div class="min-h-full">
    <van-nav-bar title="客户" fixed placeholder>
      <template #right>
        <span class="text-sm text-[var(--van-primary-color,#1989fa)]" @click="openCreate">新建</span>
      </template>
    </van-nav-bar>

    <van-search
      v-model="keyword"
      placeholder="搜索名称 / 电话 / 邮箱"
      @search="reload"
      @clear="reload"
    />

    <van-pull-refresh v-model="refreshing" @refresh="reload">
      <van-list v-model:loading="loading" :finished="finished" finished-text="没有更多了" @load="loadMore">
        <van-cell-group v-for="item in items" :key="item.id" inset class="!mb-3">
          <van-cell :title="item.name" :label="item.industry ?? '行业未填写'">
            <template #value>
              <span class="text-xs">{{ item.ownerName ?? '-' }}</span>
            </template>
          </van-cell>
          <van-cell>
            <template #title>
              <span v-if="item.phone" class="text-xs text-gray-400">{{ item.phone }}</span>
              <span v-else class="text-xs text-gray-400">无电话</span>
            </template>
            <template #value>
              <div class="flex gap-2 justify-end">
                <a v-if="item.phone" :href="`tel:${item.phone}`">
                  <van-button size="small" plain>拨打</van-button>
                </a>
                <van-button size="small" plain type="primary" @click="openFollow(item)">
                  跟进
                </van-button>
              </div>
            </template>
          </van-cell>
        </van-cell-group>
      </van-list>
    </van-pull-refresh>

    <FollowUpSheet
      v-model="followShow"
      target-type="customer"
      :target-id="followTarget?.id ?? null"
      :target-name="followTarget?.name"
      @followed="reload"
    />

    <van-popup v-model:show="createShow" position="bottom" round :style="{ height: '85%' }">
      <div class="p-4">
        <div class="text-center font-medium mb-3">新建客户</div>
        <MobileDynamicForm v-model="formModel" :fields="fields" />
        <div class="px-4 mt-4">
          <van-button type="primary" block :loading="saving" @click="handleCreate">保存</van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>
