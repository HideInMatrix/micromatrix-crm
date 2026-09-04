<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const currentGroup = computed(() => route.meta.topMenuGroup)
const activePath = computed(() => route.meta.topMenuActivePath ?? route.path)

const items = computed(() => {
  if (!currentGroup.value) return []
  return router
    .getRoutes()
    .filter(
      (record) =>
        record.meta.topMenuGroup === currentGroup.value &&
        typeof record.meta.topMenuLabel === 'string' &&
        record.meta.topMenuLabel,
    )
    .filter((record) => !record.meta.perm || auth.hasPerm(record.meta.perm))
    .sort((a, b) => (a.meta.topMenuOrder ?? 0) - (b.meta.topMenuOrder ?? 0))
    .map((record) => ({
      path: record.path,
      label: record.meta.topMenuLabel as string,
    }))
})
</script>

<template>
  <nav
    v-if="items.length"
    class="crm-pc-top-menu flex items-center gap-1"
    data-testid="pc-top-menu"
    :aria-label="`${currentGroup}模块导航`"
  >
    <RouterLink
      v-for="item in items"
      :key="item.path"
      :to="item.path"
      class="h-8 flex items-center rounded-[var(--border-radius-small)] px-4 text-sm text-[var(--el-text-color-regular)] no-underline cursor-pointer transition-colors hover:bg-[var(--el-fill-color-light)]"
      :class="{
        '!bg-[var(--el-color-primary-light-9)] !text-[var(--el-color-primary)]':
          item.path === activePath,
      }"
      :aria-current="item.path === activePath ? 'page' : undefined"
      :data-top-menu-path="item.path"
    >
      {{ item.label }}
    </RouterLink>
  </nav>
</template>
