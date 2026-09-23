<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import MobileCustomerListPane from '@/components/customer/MobileCustomerListPane.vue'
import MobileContactListPane from '@/components/customer/MobileContactListPane.vue'
import MobileCustomerOpenSeaPane from '@/components/customer/MobileCustomerOpenSeaPane.vue'
import { useAuthStore } from '@/stores/auth'

type CustomerModuleTab = 'customer' | 'contact' | 'openSea'

const auth = useAuthStore()
const route = useRoute()
const activeTab = ref<CustomerModuleTab>('customer')

const tabs = computed<{ name: CustomerModuleTab; title: string }[]>(() => [
  { name: 'customer', title: '客户' },
  ...(auth.hasPerm('contact:read') ? [{ name: 'contact' as const, title: '联系人' }] : []),
  { name: 'openSea', title: '公海' },
])

watch(
  () => route.query.tab,
  (tab) => {
    if (tab === 'customer' || tab === 'contact' || tab === 'openSea') activeTab.value = tab
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <van-tabs
      v-model:active="activeTab"
      border
      class="shrink-0"
    >
      <van-tab v-for="tab in tabs" :key="tab.name" :name="tab.name">
        <template #title>
          <div class="text-base" :class="activeTab === tab.name ? 'text-[var(--primary-8)]' : ''">
            {{ tab.title }}
          </div>
        </template>
      </van-tab>
    </van-tabs>

    <div class="min-h-0 flex-1 overflow-hidden">
      <MobileCustomerListPane v-if="activeTab === 'customer'" />
      <MobileContactListPane v-else-if="activeTab === 'contact'" />
      <MobileCustomerOpenSeaPane v-else />
    </div>
  </div>
</template>
