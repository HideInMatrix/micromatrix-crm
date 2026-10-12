<script setup lang="ts">
import { Info } from 'lucide-vue-next'
</script>

<template>
  <div class="crm-info-alert" role="note">
    <Info :size="11" :stroke-width="2" class="shrink-0" aria-hidden="true" />
    <span class="min-w-0 flex-1 whitespace-pre-wrap break-words"><slot /></span>
  </div>
</template>

<style scoped>
.crm-info-alert {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid rgba(21, 128, 255, 0.2);
  border-radius: 4px;
  background: #ecf5ff;
  color: #1580ff;
  font-size: 12px;
  line-height: 18px;
}
</style>
