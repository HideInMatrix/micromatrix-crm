<script setup lang="ts">
import { ref, watch } from 'vue'
import { Plus } from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'
import MobileHallTabs from '@/components/MobileHallTabs.vue'
import MobileLeadListPane from '@/components/lead/MobileLeadListPane.vue'
import MobileLeadPoolPane from '@/components/lead/MobileLeadPoolPane.vue'
import { useAuthStore } from '@/stores/auth'

type LeadModuleTab = 'lead' | 'pool'
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const activeTab = ref<LeadModuleTab>('lead')

watch(
  () => route.query.tab,
  (tab) => {
    activeTab.value = tab === 'pool' ? 'pool' : 'lead'
  },
  { immediate: true },
)
function createLead() {
  if (!auth.hasPerm('lead:create')) return
  void router.push('/leads/create')
}
function switchTab(tab: LeadModuleTab) {
  activeTab.value = tab
  void router.replace({ path: '/leads', query: tab === 'pool' ? { tab: 'pool' } : {} })
}
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#F5F5F5]">
    <MobileHallTabs
      :active="activeTab"
      :tabs="[
        { id: 'lead', title: '我的线索' },
        { id: 'pool', title: '线索公海' },
      ]"
      @change="(tabId) => switchTab(tabId === 'pool' ? 'pool' : 'lead')"
    />
    <div class="min-h-0 flex-1 overflow-hidden">
      <MobileLeadListPane v-if="activeTab === 'lead'" />
      <MobileLeadPoolPane v-else />
    </div>
    <!-- 蓝湖「线索大厅 / 线索大厅-公海」：52px 圆形新建入口，距右 12px、距底栏 30px。 -->
    <van-button
      v-if="auth.hasPerm('lead:create')"
      type="primary"
      round
      aria-label="新建线索"
      class="absolute right-[12px] bottom-[30px] z-[3] w-[52px] shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
      style="
        --van-button-default-height: 52px;
        --van-button-normal-padding: 0px;
        --van-button-border-width: 0px;
      "
      @click="createLead"
    >
      <span class="flex flex-col items-center justify-center gap-[2px]">
        <Plus :size="16" :stroke-width="2" aria-hidden="true" />
        <span class="text-[12px] leading-[17px]">新建</span>
      </span>
    </van-button>
  </div>
</template>
