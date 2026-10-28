<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import MobileHallTabs from '@/components/MobileHallTabs.vue'
import MobileCustomerListPane from '@/components/customer/MobileCustomerListPane.vue'
import MobileCustomerOpenSeaPane from '@/components/customer/MobileCustomerOpenSeaPane.vue'
import { useAuthStore } from '@/stores/auth'

type CustomerModuleTab = 'customer' | 'openSea'
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const activeTab = ref<CustomerModuleTab>('customer')
const tabs = computed(() => [
  { id: 'customer' as const, title: '我的客户' },
  ...(auth.hasPerm('customerPool:read') ? [{ id: 'openSea' as const, title: '客户公海' }] : []),
])
watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value =
      tab === 'openSea' && auth.hasPerm('customerPool:read') ? 'openSea' : 'customer'
  },
  { immediate: true },
)
function createCustomer() {
  if (!auth.hasPerm('customer:create')) return
  void router.push('/customers/create')
}
function switchTab(tab: CustomerModuleTab) {
  if (activeTab.value === tab) return
  activeTab.value = tab
  void router.replace({ path: '/customers', query: tab === 'openSea' ? { tab: 'openSea' } : {} })
}
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#F5F5F5]">
    <MobileHallTabs
      :active="activeTab"
      :tabs="tabs"
      @change="(tabId) => switchTab(tabId === 'openSea' ? 'openSea' : 'customer')"
    />
    <div class="min-h-0 flex-1 overflow-hidden">
      <MobileCustomerListPane v-if="activeTab === 'customer'" />
      <MobileCustomerOpenSeaPane v-else />
    </div>
    <van-button
      v-if="auth.hasPerm('customer:create')"
      type="primary"
      round
      aria-label="新建客户"
      class="absolute right-[12px] bottom-[30px] z-[3] w-[52px] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
      style="
        --van-button-default-height: 52px;
        --van-button-normal-padding: 0px;
        --van-button-border-width: 0px;
      "
      @click="createCustomer"
    >
      <span class="flex flex-col items-center justify-center gap-[2px]">
        <Plus :size="16" :stroke-width="2" aria-hidden="true" />
        <span class="text-[12px] leading-[17px]">新建</span>
      </span>
    </van-button>
  </div>
</template>
