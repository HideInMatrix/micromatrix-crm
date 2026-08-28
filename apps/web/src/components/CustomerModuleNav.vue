<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{
  active: 'customer' | 'contact' | 'sea'
}>()

const router = useRouter()
const auth = useAuthStore()

function navigate(name: string | number) {
  if (!['customer', 'contact', 'sea'].includes(String(name))) return
  if (name === props.active) return
  if (name === 'contact') {
    router.push('/contacts')
    return
  }
  if (name === 'sea') {
    router.push('/customers/open-sea')
    return
  }
  router.push('/customers')
}
</script>

<template>
  <el-tabs :model-value="active" @tab-change="navigate">
    <el-tab-pane label="客户" name="customer" />
    <el-tab-pane v-if="auth.hasPerm('contact:read')" label="联系人" name="contact" />
    <el-tab-pane v-if="auth.hasPerm('customerPool:read')" label="客户公海" name="sea" />
  </el-tabs>
</template>
