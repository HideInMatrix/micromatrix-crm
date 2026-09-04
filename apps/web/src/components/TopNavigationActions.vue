<script setup lang="ts">
import { TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import { CalendarClock, CircleHelp, Info, ListTodo } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { approvalApi } from '@/api/approvals'
import { useAuthStore } from '@/stores/auth'
import { useModuleConfigStore } from '@/stores/module-config'
import NotificationBell from './NotificationBell.vue'

const router = useRouter()
const auth = useAuthStore()
const moduleConfig = useModuleConfigStore()
const pendingApprovalCount = ref(0)

const actions = computed(() =>
  TOP_NAVIGATION_DEFINITIONS.filter((definition) => {
    if (definition.status !== 'available') return false
    if (!moduleConfig.isTopNavigationEnabled(definition.key)) return false
    return !definition.requiredPermission || auth.hasPerm(definition.requiredPermission)
  }).sort(
    (a, b) => moduleConfig.topNavigationOrderOf(a.key) - moduleConfig.topNavigationOrderOf(b.key),
  ),
)

async function loadPendingApprovalCount() {
  if (!auth.hasPerm('menu:approval')) return
  const { data } = await approvalApi.myPending({ page: 1, pageSize: 1 })
  pendingApprovalCount.value = data.total
}

function openHelp() {
  window.open('/api/docs', '_blank', 'noopener,noreferrer')
}

onMounted(() => {
  loadPendingApprovalCount().catch(() => undefined)
})
</script>

<template>
  <div class="flex items-center gap-2" data-testid="top-navigation-actions">
    <template v-for="action in actions" :key="action.key">
      <el-tooltip v-if="action.key === 'task'" content="审批待办" placement="bottom">
        <el-badge
          :value="pendingApprovalCount"
          :hidden="pendingApprovalCount === 0"
          :max="99"
          class="cursor-pointer"
          data-top-navigation-key="task"
          @click="router.push('/approvals')"
        >
          <button
            type="button"
            class="h-8 w-8 flex-center border-0 rounded-[var(--border-radius-small)] bg-transparent p-2 text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[var(--el-fill-color-light)]"
            aria-label="审批待办"
          >
            <ListTodo :size="16" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </el-badge>
      </el-tooltip>

      <span
        v-else-if="action.key === 'notify'"
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

      <el-popover
        v-else-if="action.key === 'about'"
        placement="bottom-end"
        width="280"
        trigger="click"
      >
        <template #reference>
          <button
            type="button"
            class="h-8 w-8 flex-center border-0 rounded-[var(--border-radius-small)] bg-transparent p-2 leading-none text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[var(--el-fill-color-light)]"
            data-top-navigation-key="about"
            aria-label="关于"
          >
            <Info :size="16" :stroke-width="1.8" aria-hidden="true" />
          </button>
        </template>
        <div class="font-medium">微矩阵 CRM</div>
        <div class="mt-2 text-xs leading-5 text-[var(--el-text-color-secondary)]">
          NestJS + Prisma + Vue 的多租户 CRM。当前顶部导航顺序由租户模块配置统一管理。
        </div>
      </el-popover>

      <el-tooltip v-else-if="action.key === 'help'" content="API 文档" placement="bottom">
        <button
          type="button"
          class="h-8 w-8 flex-center border-0 rounded-[var(--border-radius-small)] bg-transparent p-2 leading-none text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[var(--el-fill-color-light)]"
          data-top-navigation-key="help"
          aria-label="帮助中心"
          @click="openHelp"
        >
          <CircleHelp :size="16" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </el-tooltip>
    </template>
  </div>
</template>
