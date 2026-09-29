<script setup lang="ts">
import type { LeadVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { closeToast, showFailToast, showLoadingToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { getLead, transformLead } from '@/api/mobile'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const lead = ref<LeadVO | null>(null)
const loading = ref(false)
const showConvertedSuccess = ref(false)
const successCustomerId = ref('')

const canCreateCustomer = computed(() => auth.hasPerm('customer:create'))

const cards = [
  { key: 'contact', label: '联系人', active: true, disabled: true },
  { key: 'customer', label: '客户', active: true, disabled: true },
]

async function load() {
  try {
    const { data } = await getLead(String(route.params.id))
    lead.value = data
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    router.replace('/leads')
  }
}

async function confirmConvert() {
  if (!lead.value) return
  if (!canCreateCustomer.value) {
    showFailToast('无新建客户权限')
    return
  }
  loading.value = true
  showLoadingToast({ message: '转换中...', forbidClick: true, duration: 0 })
  try {
    const { data } = await transformLead({
      clueId: lead.value.id,
    })
    successCustomerId.value = data.customerId
    showConvertedSuccess.value = true
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    closeToast()
    loading.value = false
  }
}

function back() {
  showConvertedSuccess.value = false
  router.replace('/leads')
}

function goDetail() {
  showConvertedSuccess.value = false
  router.replace({
    path: '/customers/detail',
    query: { id: successCustomerId.value, name: lead.value?.name ?? '' },
  })
}

onMounted(load)
</script>

<template>
  <div class="h-full overflow-auto bg-[var(--mobile-page-background)] pb-[88px]">
    <div class="px-4 pb-4">
      <div class="my-[14px] text-base font-semibold">线索转换为</div>
      <div class="flex gap-3">
        <van-button
          v-for="card in cards"
          :key="card.key"
          plain
          class="relative !h-[74px] !flex-1 overflow-hidden !rounded-md !bg-white !text-sm"
          :class="[
            card.active
              ? 'border-[var(--van-primary-color)] text-[var(--van-primary-color)]'
              : 'border-[var(--text-n7)]',
          ]"
        >
          <span
            v-if="card.active"
            class="absolute left-0 top-0 flex h-5 w-5 items-start justify-start bg-[var(--van-primary-color)] pl-[2px] text-xs text-white"
          >
            ✓
          </span>
          {{ card.label }}
        </van-button>
      </div>

      <div class="mt-6 rounded-[var(--border-radius-medium)] bg-white px-5 py-4">
        <div class="mb-1 font-medium">备注</div>
        <div class="text-xs leading-6 text-gray-500">
          <div>转换后会创建客户和联系人，并保留原线索。</div>
          <div>跟进记录会复制到客户，原线索跟进记录不会删除。</div>
          <div>联系人姓名为空时不会生成联系人。</div>
        </div>
      </div>
    </div>

    <div
      class="fixed right-0 bottom-0 left-0 z-20 flex gap-3 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
    >
      <van-button block :disabled="loading" @click="router.back()">取消</van-button>
      <van-button
        block
        type="primary"
        :loading="loading"
        :disabled="!canCreateCustomer"
        @click="confirmConvert"
      >
        转换
      </van-button>
    </div>

    <van-dialog
      v-model:show="showConvertedSuccess"
      title="转换成功"
      :show-confirm-button="false"
      close-on-click-overlay
    >
      <div class="px-6 pt-3 text-sm text-gray-600">
        <van-count-down time="5000" format="ss" @finish="back">
          <template #default="timeData">
            <span class="text-[var(--van-primary-color)]">{{ timeData.seconds }}</span>
          </template>
        </van-count-down>
        <span class="ml-1">秒后返回线索列表</span>
      </div>
      <div class="flex gap-4 p-6">
        <van-button block @click="back">返回线索列表</van-button>
        <van-button type="primary" block @click="goDetail">查看客户详情</van-button>
      </div>
    </van-dialog>
  </div>
</template>
