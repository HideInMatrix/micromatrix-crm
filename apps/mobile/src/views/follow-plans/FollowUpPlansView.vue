<script setup lang="ts">
import MobileFollowUpPlanList from '@/components/MobileFollowUpPlanList.vue'
</script>

<template>
  <div class="crm-mobile-page min-h-full bg-[var(--mobile-page-background)]">
    <van-nav-bar title="跟进计划" fixed placeholder />
    <MobileFollowUpPlanList />
  </div>
</template>
