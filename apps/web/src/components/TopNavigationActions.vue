<script setup lang="ts">
import { TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import { CalendarClock } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import NotificationBell from './NotificationBell.vue'

const router = useRouter()
const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()

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
    <template v-for="action in actions" :key="action.key">
      <span
        v-if="action.key === 'notify'"
        class="inline-flex"
        data-top-navigation-key="notify"
      >
        <NotificationBell />
      </span>

      <el-tooltip v-else-if="action.key === 'event'" content="跟进计划" placement="bottom">
        <button
          type="button"
          class="h-8 w-8 flex-center border-0 rounded-[var(--border-radius-small)] bg-transparent p-2 leading-none text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[var(--el-fill-color-light)]"
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
