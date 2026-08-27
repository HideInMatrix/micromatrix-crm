<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CustomerOverviewContent from '@/components/customer/CustomerOverviewContent.vue'

const route = useRoute()
const router = useRouter()
const customerId = computed(() => String(route.params.id ?? ''))

function backToCustomers() {
  router.push('/customers')
}
</script>

<template>
  <div class="h-[calc(100vh-104px)] min-h-[620px] overflow-hidden">
    <CustomerOverviewContent
      v-if="customerId"
      :customer-id="customerId"
      @close="backToCustomers"
      @deleted="backToCustomers"
    />
  </div>
</template>
