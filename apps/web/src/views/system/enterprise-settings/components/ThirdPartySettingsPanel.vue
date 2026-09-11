<script setup lang="ts">
import DingTalkIntegrationCard from './DingTalkIntegrationCard.vue'
import LarkIntegrationCard from './LarkIntegrationCard.vue'
import WeComIntegrationCard from './WeComIntegrationCard.vue'
</script>

<template>
  <div class="flex flex-col gap-4">
    <WeComIntegrationCard />
    <DingTalkIntegrationCard />
    <LarkIntegrationCard />
  </div>
</template>
