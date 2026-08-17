<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const props = defineProps<{
  active: 'customer' | 'contact' | 'sea'
}>()

const route = useRoute()
const router = useRouter()

function navigate(name: 'customer' | 'contact' | 'sea') {
  if (name === props.active) return
  if (name === 'contact') {
    router.push('/contacts')
    return
  }
  router.push({ path: '/customers', query: name === 'sea' ? { ...route.query, tab: 'sea' } : {} })
}
</script>

<template>
  <div class="flex items-center gap-1 border-b border-[var(--el-border-color-lighter)] mb-4">
    <button
      v-for="item in [
        { key: 'customer', label: '客户' },
        { key: 'contact', label: '联系人' },
        { key: 'sea', label: '客户公海' },
      ]"
      :key="item.key"
      type="button"
      class="px-4 py-3 border-0 bg-transparent cursor-pointer text-sm"
      :class="item.key === active ? 'text-[var(--el-color-primary)] font-semibold border-b-2 border-[var(--el-color-primary)]' : 'text-[var(--el-text-color-regular)]'"
      @click="navigate(item.key as 'customer' | 'contact' | 'sea')"
    >
      {{ item.label }}
    </button>
  </div>
</template>
