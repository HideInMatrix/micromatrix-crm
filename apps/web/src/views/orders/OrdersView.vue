<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import OrderTable from '@/components/order/OrderTable.vue'

const route = useRoute()
const fromContractId = computed(() => {
  const value = route.query.fromContract
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
})
</script>

<template>
  <el-card shadow="never">
    <OrderTable :from-contract-id="fromContractId" />
  </el-card>
</template>
