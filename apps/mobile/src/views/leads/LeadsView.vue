<script setup lang="ts">
import { ref } from 'vue'
import MobileLeadListPane from '@/components/lead/MobileLeadListPane.vue'
import MobileLeadPoolPane from '@/components/lead/MobileLeadPoolPane.vue'

type LeadModuleTab = 'lead' | 'pool'

const activeTab = ref<LeadModuleTab>('lead')
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <van-tabs v-model:active="activeTab" border class="shrink-0">
      <van-tab name="lead">
        <template #title>
          <div class="text-base" :class="activeTab === 'lead' ? 'text-[var(--primary-8)]' : ''">
            线索
          </div>
        </template>
      </van-tab>
      <van-tab name="pool">
        <template #title>
          <div class="text-base" :class="activeTab === 'pool' ? 'text-[var(--primary-8)]' : ''">
            线索池
          </div>
        </template>
      </van-tab>
    </van-tabs>

    <div class="min-h-0 flex-1 overflow-hidden">
      <MobileLeadListPane v-if="activeTab === 'lead'" />
      <MobileLeadPoolPane v-else />
    </div>
  </div>
</template>
