<script setup lang="ts">
import { TOP_NAVIGATION_DEFINITIONS } from '@micromatrix/shared'
import { CircleHelp, Info, ListTodo } from 'lucide-vue-next'
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
  <div class="flex items-center gap-4" data-testid="top-navigation-actions">
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
          <ListTodo :size="20" :stroke-width="1.8" aria-hidden="true" />
        </el-badge>
      </el-tooltip>

      <span
        v-else-if="action.key === 'notify'"
        class="inline-flex"
        data-top-navigation-key="notify"
      >
        <NotificationBell />
      </span>

      <el-popover
        v-else-if="action.key === 'about'"
        placement="bottom-end"
        width="280"
        trigger="click"
      >
        <template #reference>
          <button
            type="button"
            class="border-0 bg-transparent p-0 text-lg leading-none cursor-pointer"
            data-top-navigation-key="about"
            aria-label="关于"
          >
            <Info :size="20" :stroke-width="1.8" aria-hidden="true" />
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
          class="border-0 bg-transparent p-0 text-lg leading-none cursor-pointer"
          data-top-navigation-key="help"
          aria-label="帮助中心"
          @click="openHelp"
        >
          <CircleHelp :size="20" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </el-tooltip>
    </template>
  </div>
</template>
