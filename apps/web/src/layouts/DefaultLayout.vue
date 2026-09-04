<script setup lang="ts">
import { useDark } from '@vueuse/core'
import {
  CalendarClock,
  Download,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
} from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
import PcTopMenu from '@/components/PcTopMenu.vue'
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

const SIDEBAR_COLLAPSED_KEY = 'mmx-pc-sidebar-collapsed'

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const isDark = useDark()
const sidebarCollapsed = ref(readSidebarCollapsed())
const sidebarWidth = computed(() => (sidebarCollapsed.value ? '56px' : '180px'))
const brandInitial = computed(() => enterpriseUi.branding.title.trim().slice(0, 1) || 'M')
const activeMenu = computed(() => route.meta.activeMenu ?? route.path)
const isEnterpriseSettings = computed(() => route.path === '/system/settings')
const personalVisible = ref(false)
const personalTab = ref<'info' | 'plan' | 'apiKey'>('info')
const exportTasksRef = ref<InstanceType<typeof ExportTaskButton> | null>(null)
const hasExportPermission = computed(() =>
  [
    'customer:export',
    'customerPool:export',
    'contact:export',
    'lead:export',
    'leadPool:export',
  ].some((code) => auth.hasPerm(code)),
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

watch(sidebarCollapsed, (value) => {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // 浏览器禁用存储时只失去折叠状态持久化，不影响布局使用。
  }
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
  <div class="crm-layout h-full min-h-0 flex flex-col overflow-hidden bg-[var(--el-bg-color-page)]">
    <header class="crm-layout-header h-14 shrink-0 flex bg-[var(--el-bg-color)]">
      <div
        class="crm-layout-brand h-full shrink-0 flex items-center justify-center overflow-hidden border-r border-[var(--el-border-color-light)]"
        :class="sidebarCollapsed ? 'px-0' : 'px-4'"
        :style="{ width: sidebarWidth }"
      >
        <img
          v-if="enterpriseUi.platformLogoUrl"
          :src="enterpriseUi.platformLogoUrl"
          :alt="enterpriseUi.branding.title"
          class="h-7 shrink-0 object-contain"
          :class="sidebarCollapsed ? 'max-w-7' : 'max-w-[130px]'"
        />
        <span
          v-else-if="!sidebarCollapsed"
          class="truncate text-[16px] font-semibold text-[var(--el-text-color-primary)]"
        >
          {{ enterpriseUi.branding.title }}
        </span>
        <span
          v-else
          class="h-8 w-8 flex-center rounded-[var(--border-radius-medium)] bg-[var(--el-color-primary)] text-[16px] font-semibold text-white"
        >
          {{ brandInitial }}
        </span>
      </div>

      <div class="min-w-0 flex flex-1 items-center justify-between gap-4 px-4">
        <PcTopMenu v-if="route.meta.topMenuGroup" />
        <span v-else class="truncate text-sm font-medium text-[var(--el-text-color-primary)]">
          {{ route.meta.title }}
        </span>
        <div class="flex items-center gap-2">
          <TopNavigationActions />
          <el-switch
            v-model="isDark"
            size="small"
            inline-prompt
            active-text="暗"
            inactive-text="亮"
          />
        </div>
      </div>
    </header>

    <div class="min-h-0 flex flex-1">
      <aside
        class="crm-layout-sider min-h-0 shrink-0 flex flex-col overflow-hidden border-r border-[var(--el-border-color-light)] bg-[var(--el-bg-color)]"
        :style="{ width: sidebarWidth }"
      >
        <el-menu
          :default-active="activeMenu"
          :collapse="sidebarCollapsed"
          :collapse-transition="false"
          router
          class="crm-side-menu min-h-0 flex-1 overflow-y-auto"
        >
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

        <div class="shrink-0 p-2">
          <el-dropdown
            class="w-full"
            trigger="click"
            placement="right-end"
            @command="handlePersonalCommand"
          >
            <button
              type="button"
              class="w-full flex items-center gap-2 rounded-[var(--border-radius-small)] border-0 bg-[var(--el-fill-color-light)] p-2 text-left cursor-pointer hover:bg-[var(--el-color-primary-light-9)]"
              :class="sidebarCollapsed ? 'justify-center' : ''"
              data-testid="personal-menu-trigger"
            >
              <el-avatar
                :size="sidebarCollapsed ? 25 : 40"
                :src="auth.user?.avatarUrl ?? undefined"
                class="shrink-0 transition-all"
              >
                {{ auth.user?.name?.slice(0, 1) ?? '?' }}
              </el-avatar>
              <div v-if="!sidebarCollapsed" class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium">{{ auth.user?.name ?? '账号' }}</div>
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

          <el-divider class="!my-3" />
          <button
            type="button"
            class="h-8 w-full flex items-center justify-center rounded-[var(--border-radius-small)] border-0 bg-transparent px-2 text-[var(--el-text-color-secondary)] cursor-pointer hover:bg-[var(--el-fill-color-light)] hover:text-[var(--el-text-color-primary)]"
            :aria-label="sidebarCollapsed ? '展开菜单' : '收起菜单'"
            @click="sidebarCollapsed = !sidebarCollapsed"
          >
            <PanelLeftOpen v-if="sidebarCollapsed" :size="16" aria-hidden="true" />
            <PanelLeftClose v-else :size="16" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section class="min-w-0 min-h-0 flex-1 overflow-hidden">
        <el-main
          class="crm-page-main h-full bg-[var(--el-bg-color-page)] !p-4 !pb-0 !overflow-x-hidden"
          :class="{
            '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden': isEnterpriseSettings,
          }"
        >
          <router-view />
        </el-main>
      </section>
    </div>

    <PersonalCenterDrawer v-model:visible="personalVisible" v-model:active-tab="personalTab" />
    <ExportTaskButton ref="exportTasksRef" :show-trigger="false" />
  </div>
</template>
