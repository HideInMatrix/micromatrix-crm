<script setup lang="ts">
import { useRouter } from 'vue-router'
import MobileFollowUpPlanList from '@/components/MobileFollowUpPlanList.vue'

const router = useRouter()
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--mobile-page-background)]">
    <van-nav-bar title="跟进计划" left-arrow @click-left="router.back()" />
    <div class="min-h-0 flex-1">
      <MobileFollowUpPlanList />
    </div>
  </div>
</template>
