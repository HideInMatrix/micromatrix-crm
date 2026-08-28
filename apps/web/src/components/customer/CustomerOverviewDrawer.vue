<script setup lang="ts">
import CustomerOverviewContent from './CustomerOverviewContent.vue'

defineProps<{
  customerId: string | null
  pool?: boolean
  poolId?: string
  hiddenFieldIds?: string[]
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{
  changed: []
  deleted: []
}>()
</script>

<template>
  <el-drawer
    v-model="visible"
    size="100%"
    :with-header="false"
    destroy-on-close
    class="customer-overview-drawer"
  >
    <CustomerOverviewContent
      v-if="customerId"
      :customer-id="customerId"
      :pool="pool"
      :pool-id="poolId"
      :hidden-field-ids="hiddenFieldIds"
      @close="visible = false"
      @changed="emit('changed')"
      @deleted="emit('deleted')"
    />
  </el-drawer>
</template>

<style scoped>
:deep(.customer-overview-drawer .el-drawer__body) {
  padding: 0;
  overflow: hidden;
}
</style>
