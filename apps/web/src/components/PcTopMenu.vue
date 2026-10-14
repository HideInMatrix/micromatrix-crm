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

const activeIndex = computed(() => items.value.findIndex((item) => item.path === activePath.value))
</script>

<template>
  <nav
    v-if="items.length"
    class="crm-pc-top-menu flex items-center"
    data-testid="pc-top-menu"
    :aria-label="`${currentGroup}模块导航`"
  >
    <span
      v-if="activeIndex >= 0"
      class="crm-pc-top-menu__indicator"
      :style="{ transform: `translateX(${activeIndex * 104}px)` }"
      aria-hidden="true"
    />
    <RouterLink
      v-for="item in items"
      :key="item.path"
      :to="item.path"
      class="crm-pc-top-menu__item no-underline cursor-pointer transition-colors"
      :class="{ 'is-active': item.path === activePath }"
      :aria-current="item.path === activePath ? 'page' : undefined"
      :data-top-menu-path="item.path"
    >
      {{ item.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.crm-pc-top-menu {
  position: relative;
  background: #f5f7fb;
  border-radius: 4px;
  isolation: isolate;
}

.crm-pc-top-menu__indicator {
  position: absolute;
  top: 0;
  left: 0;
  width: 104px;
  height: 40px;
  border-radius: 4px;
  background: var(--el-color-primary-light-9);
  transition: transform 260ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.crm-pc-top-menu__item {
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: 0 0 104px;
  align-items: center;
  justify-content: center;
  width: 104px;
  height: 40px;
  color: #666666;
  font-size: 16px;
  font-weight: 400;
  border-radius: 4px;
  background: transparent;
}

.crm-pc-top-menu__item:hover {
  color: var(--el-color-primary);
}

.crm-pc-top-menu__item.is-active {
  color: var(--el-color-primary);
}

@media (prefers-reduced-motion: reduce) {
  .crm-pc-top-menu__indicator {
    transition: none;
  }
}
</style>
