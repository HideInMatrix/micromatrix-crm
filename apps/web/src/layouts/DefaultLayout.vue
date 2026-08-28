<script setup lang="ts">
import { useDark } from '@vueuse/core'
import { CalendarClock, Download, LogOut, UserRound } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
import PersonalCenterDrawer from '@/components/personal/PersonalCenterDrawer.vue'
import TopNavigationActions from '@/components/TopNavigationActions.vue'
import { MENUS, type MenuItem } from '@/router/menu'
import { moduleIconOf } from '@/router/navigation-icons'
import { useAuthStore } from '@/stores/auth'
import { useEnterpriseUiStore } from '@/stores/enterprise-ui'
import { useModuleConfigStore } from '@/stores/module-config'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const enterpriseUi = useEnterpriseUiStore()
const moduleConfig = useModuleConfigStore()

const isDark = useDark()
const activeMenu = computed(() => route.meta.activeMenu ?? route.path)
const isEnterpriseSettings = computed(() => route.path === '/system/settings')
const personalVisible = ref(false)
const personalTab = ref<'info' | 'plan' | 'apiKey'>('info')
const exportTasksRef = ref<InstanceType<typeof ExportTaskButton> | null>(null)
const hasExportPermission = computed(() =>
  ['customer:export', 'customerPool:export', 'contact:export', 'lead:export', 'leadPool:export'].some(
    (code) => auth.hasPerm(code),
  ),
)

const canAccessMenu = (menu: MenuItem) => !menu.perm || auth.hasPerm(menu.perm)

/** 按当前用户权限过滤菜单 */
const visibleMenus = computed<MenuItem[]>(() =>
  MENUS.map((m) => ({
    ...m,
    children: m.children?.filter(canAccessMenu),
  }))
    .filter(
      (m) =>
        moduleConfig.isEnabled(m.moduleKey) &&
        canAccessMenu(m) &&
        (!m.children || m.children.length > 0),
    )
    .sort((a, b) => moduleConfig.orderOf(a.moduleKey) - moduleConfig.orderOf(b.moduleKey)),
)

onMounted(() => {
  auth.fetchMe().catch(() => undefined)
  moduleConfig.load().catch(() => undefined)
})

function handleLogout() {
  const tenant = auth.user?.tenantSlug
  auth.logout()
  router.push({ name: 'login', query: tenant ? { tenant } : undefined })
}

function handlePersonalCommand(command: string) {
  if (command === 'info' || command === 'plan') {
    personalTab.value = command
    personalVisible.value = true
    return
  }
  if (command === 'export') {
    exportTasksRef.value?.open()
    return
  }
  if (command === 'logout') handleLogout()
}
</script>

<template>
  <el-container class="h-full">
    <el-aside width="220px" class="flex flex-col border-r border-[var(--el-border-color)]">
      <div class="h-14 shrink-0 flex items-center justify-center gap-2 px-4 text-lg font-bold">
        <img
          v-if="enterpriseUi.platformLogoUrl"
          :src="enterpriseUi.platformLogoUrl"
          :alt="enterpriseUi.branding.title"
          class="max-h-8 max-w-24 shrink-0 object-contain"
        />
        <span class="truncate">{{ enterpriseUi.branding.title }}</span>
      </div>
      <el-menu :default-active="activeMenu" router class="flex-1 overflow-y-auto !border-r-0">
        <template v-for="menu in visibleMenus" :key="menu.path">
          <el-sub-menu v-if="menu.children?.length" :index="menu.path">
            <template #title>
              <component :is="moduleIconOf(menu.moduleKey)" :size="18" class="mr-2 shrink-0" />
              <span>{{ menu.title }}</span>
            </template>
            <el-menu-item v-for="child in menu.children" :key="child.path" :index="child.path">
              {{ child.title }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="menu.path">
            <component :is="moduleIconOf(menu.moduleKey)" :size="18" class="mr-2 shrink-0" />
            <span>{{ menu.title }}</span>
          </el-menu-item>
        </template>
      </el-menu>
      <div class="shrink-0 border-t border-[var(--el-border-color)] p-2">
        <el-dropdown trigger="click" placement="top-start" @command="handlePersonalCommand">
          <button
            type="button"
            class="w-full flex items-center gap-3 rounded-md border-0 bg-transparent px-2 py-2 text-left cursor-pointer hover:bg-[var(--el-fill-color-light)]"
            data-testid="personal-menu-trigger"
          >
            <el-avatar :size="38" :src="auth.user?.avatarUrl ?? undefined">
              {{ auth.user?.name?.slice(0, 1) ?? '?' }}
            </el-avatar>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm">{{ auth.user?.name ?? '账号' }}</div>
            </div>
          </button>
          <template #dropdown>
            <el-dropdown-menu data-testid="personal-menu-dropdown">
              <el-dropdown-item disabled>{{ auth.user?.name ?? '账号' }}</el-dropdown-item>
              <el-dropdown-item divided command="info">
                <UserRound :size="17" class="mr-2" />个人信息
              </el-dropdown-item>
              <el-dropdown-item command="plan">
                <CalendarClock :size="17" class="mr-2" />我的计划
              </el-dropdown-item>
              <el-dropdown-item v-if="hasExportPermission" command="export">
                <Download :size="17" class="mr-2" />我的导出
              </el-dropdown-item>
              <el-dropdown-item command="logout">
                <LogOut :size="17" class="mr-2" />退出系统
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-aside>

    <el-container>
      <el-header class="flex-between border-b border-[var(--el-border-color)]">
        <span class="text-sm text-[var(--el-text-color-secondary)]">{{ route.meta.title }}</span>
        <div class="flex items-center gap-5">
          <TopNavigationActions />
          <el-switch v-model="isDark" inline-prompt active-text="暗" inactive-text="亮" />
        </div>
      </el-header>

      <el-main
        class="bg-[var(--el-bg-color-page)] !pb-0 !overflow-x-hidden"
        :class="{
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden': isEnterpriseSettings,
        }"
      >
        <router-view />
      </el-main>
    </el-container>
    <PersonalCenterDrawer v-model:visible="personalVisible" v-model:active-tab="personalTab" />
    <ExportTaskButton ref="exportTasksRef" :show-trigger="false" />
  </el-container>
</template>
