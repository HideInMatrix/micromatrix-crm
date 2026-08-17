<script setup lang="ts">
import type { LeadVO } from '@micromatrix/shared'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { closeToast, showFailToast, showLoadingToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { getLead, transformLead } from '@/mobile/api'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const lead = ref<LeadVO | null>(null)
const loading = ref(false)
const withOpportunity = ref(false)
const oppName = ref('')
const showConvertedSuccess = ref(false)
const successCustomerId = ref('')
const successOpportunityId = ref<string | null>(null)

const canCreateCustomer = computed(() => auth.hasPerm('customer:create'))
const canCreateOpportunity = computed(
  () => canCreateCustomer.value && auth.hasPerm('opportunity:create'),
)

const cards = computed(() => [
  { key: 'contact', label: '联系人', active: true, disabled: true },
  { key: 'customer', label: '客户', active: true, disabled: true },
  {
    key: 'opportunity',
    label: '商机',
    active: withOpportunity.value,
    disabled: !canCreateOpportunity.value,
  },
])

function toggleCard(key: string, disabled: boolean) {
  if (disabled || key !== 'opportunity') return
  withOpportunity.value = !withOpportunity.value
  if (withOpportunity.value && !oppName.value && lead.value) {
    oppName.value = `${lead.value.name}-商机`
  }
}

async function load() {
  try {
    const { data } = await getLead(String(route.params.id))
    lead.value = data
    oppName.value = `${data.name}-商机`
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
  if (withOpportunity.value && !oppName.value.trim()) {
    showFailToast('请输入商机名称')
    return
  }
  loading.value = true
  showLoadingToast({ message: '转换中...', forbidClick: true, duration: 0 })
  try {
    const { data } = await transformLead({
      clueId: lead.value.id,
      oppCreated: withOpportunity.value,
      oppName: withOpportunity.value ? oppName.value.trim() : undefined,
    })
    successCustomerId.value = data.customerId
    successOpportunityId.value = data.opportunityId
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
  if (successOpportunityId.value) {
    router.replace({
      path: '/opportunities/detail',
      query: { id: successOpportunityId.value, name: oppName.value },
    })
  } else {
    router.replace({
      path: '/customers/detail',
      query: { id: successCustomerId.value, name: lead.value?.name ?? '' },
    })
  }
}

onMounted(load)
</script>

<template>
  <div class="min-h-full bg-white pb-[88px]">
    <van-nav-bar title="转换为" left-arrow fixed placeholder @click-left="router.back()" />

    <div class="px-4">
      <div class="my-[14px] text-base font-semibold">线索转换为</div>
      <div class="flex gap-3">
        <button
          v-for="card in cards"
          :key="card.key"
          type="button"
          class="relative flex h-[74px] flex-1 items-center justify-center overflow-hidden rounded-md border bg-white text-sm"
          :class="[
            card.active
              ? 'border-[var(--van-primary-color)] text-[var(--van-primary-color)]'
              : 'border-[#dcdee0]',
            card.disabled && card.key === 'opportunity' ? 'opacity-40' : '',
          ]"
          @click="toggleCard(card.key, card.disabled)"
        >
          <span
            v-if="card.active"
            class="absolute left-0 top-0 flex h-5 w-5 items-start justify-start bg-[var(--van-primary-color)] pl-[2px] text-xs text-white"
          >
            ✓
          </span>
          {{ card.label }}
        </button>
      </div>

      <van-form v-if="withOpportunity" class="mt-4">
        <van-field
          v-model="oppName"
          label="商机名称"
          name="oppName"
          required
          maxlength="255"
          placeholder="请输入"
          :rules="[{ required: true, message: '请输入商机名称' }]"
        />
      </van-form>

      <div class="mt-6 rounded-md bg-[#f7f8fa] px-5 py-4">
        <div class="mb-1 font-medium">备注</div>
        <div class="text-xs leading-6 text-gray-500">
          <div>转换后会创建客户和联系人，并保留原线索。</div>
          <div v-if="withOpportunity">同时创建商机，并自动关联本次生成的联系人。</div>
          <div v-else>跟进记录会复制到客户，原线索跟进记录不会删除。</div>
          <div>联系人姓名为空时不会生成联系人。</div>
        </div>
      </div>
    </div>

    <div class="fixed bottom-0 left-0 right-0 z-20 flex gap-4 border-t border-[#ebedf0] bg-white p-4">
      <van-button block :disabled="loading" @click="router.back()">取消</van-button>
      <van-button
        block
        type="primary"
        :loading="loading"
        :disabled="!canCreateCustomer || (withOpportunity && !canCreateOpportunity)"
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
        <van-button type="primary" block @click="goDetail">
          {{ successOpportunityId ? '查看商机详情' : '查看客户详情' }}
        </van-button>
      </div>
    </van-dialog>
  </div>
</template>
