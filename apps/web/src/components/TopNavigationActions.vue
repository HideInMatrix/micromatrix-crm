<script setup lang="ts">
import { TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import { CalendarClock, RefreshCw } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import NotificationBell from './NotificationBell.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()

function requestHomeRefresh() {
  window.dispatchEvent(new Event('crm:home-refresh'))
}

const actions = computed(() =>
  TOP_NAVIGATION_DEFINITIONS.filter((definition) => {
    if (definition.status !== 'available') return false
    if (!moduleConfig.isTopNavigationEnabled(definition.key)) return false
    return !definition.requiredPermission || auth.hasPerm(definition.requiredPermission)
  }).sort(
    (a, b) => moduleConfig.topNavigationOrderOf(a.key) - moduleConfig.topNavigationOrderOf(b.key),
  ),
)
</script>

<template>
  <div class="flex items-center gap-2" data-testid="top-navigation-actions">
    <el-tooltip v-if="route.path === '/dashboard'" content="刷新首页" placement="bottom">
      <button
        type="button"
        class="h-[38px] w-[38px] flex-center rounded-full border-0 bg-[#F5F7FA] p-0 text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[#E9EDF5]"
        data-testid="home-overview-refresh"
        aria-label="刷新首页"
        @click="requestHomeRefresh"
      >
        <RefreshCw :size="18" :stroke-width="1.8" aria-hidden="true" />
      </button>
    </el-tooltip>
    <template v-for="action in actions" :key="action.key">
      <span v-if="action.key === 'notify'" class="inline-flex" data-top-navigation-key="notify">
        <NotificationBell />
      </span>

      <el-tooltip v-else-if="action.key === 'event'" content="跟进计划" placement="bottom">
        <button
          type="button"
          class="h-[38px] w-[38px] flex-center rounded-full border-0 bg-[#F5F7FA] p-0 leading-none text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[#E9EDF5]"
          data-top-navigation-key="event"
          aria-label="跟进计划"
          @click="router.push('/follow-plans')"
        >
          <CalendarClock :size="16" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </el-tooltip>
    </template>
  </div>
</template>
