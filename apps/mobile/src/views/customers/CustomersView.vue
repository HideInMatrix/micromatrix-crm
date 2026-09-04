<script setup lang="ts">
import { computed, ref } from 'vue'
import MobileCustomerListPane from '@/components/customer/MobileCustomerListPane.vue'
import MobileContactListPane from '@/components/customer/MobileContactListPane.vue'
import MobileCustomerOpenSeaPane from '@/components/customer/MobileCustomerOpenSeaPane.vue'
import { useAuthStore } from '@/stores/auth'

type CustomerModuleTab = 'customer' | 'contact' | 'openSea'

const auth = useAuthStore()
const activeTab = ref<CustomerModuleTab>('customer')

const tabs = computed<{ name: CustomerModuleTab; title: string }[]>(() => [
  { name: 'customer', title: '客户' },
  ...(auth.hasPerm('contact:read') ? [{ name: 'contact' as const, title: '联系人' }] : []),
  { name: 'openSea', title: '客户公海' },
])
</script>

<template>
  <div class="crm-mobile-tab-page flex flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <van-tabs v-model:active="activeTab" border class="customer-module-tabs flex-1 min-h-0">
      <van-tab v-for="tab in tabs" :key="tab.name" :name="tab.name" :title="tab.title">
        <MobileCustomerListPane v-if="tab.name === 'customer'" />
        <MobileContactListPane v-else-if="tab.name === 'contact'" />
        <MobileCustomerOpenSeaPane v-else />
      </van-tab>
    </van-tabs>
  </div>
</template>

<style scoped>
.customer-module-tabs :deep(.van-tabs__content) {
  height: calc(100% - var(--van-tabs-line-height));
  overflow: hidden;
}

.customer-module-tabs :deep(.van-tab__panel) {
  height: 100%;
}
</style>
