<script setup lang="ts">
import {
  CalendarClock,
  ChevronDown,
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

const sidebarCollapsed = ref(readSidebarCollapsed())
const sidebarWidth = computed(() => (sidebarCollapsed.value ? '64px' : '256px'))
const userRoleLabel = computed(
  () => auth.user?.roles.map((role) => role.name).join('、') || '未分配角色',
)
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
  <div class="h-full min-h-0 flex flex-col overflow-hidden bg-[var(--el-bg-color-page)]">
    <header
      class="h-16 shrink-0 flex bg-[var(--el-bg-color)] shadow-[inset_0_-1px_0_var(--el-border-color-light)]"
    >
      <div
        class="h-full shrink-0 flex items-center justify-center overflow-hidden border-r border-white/10 bg-[#223270] text-white transition-[width] duration-[160ms] ease-in-out"
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
        <span v-else-if="!sidebarCollapsed" class="truncate text-[16px] font-semibold text-white">
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
        <div class="flex shrink-0 items-center gap-2">
          <TopNavigationActions />
          <el-dropdown
            class="ml-2 shrink-0"
            trigger="click"
            placement="bottom-end"
            @command="handlePersonalCommand"
          >
            <button
              type="button"
              class="flex items-center gap-3 rounded-lg border-0 bg-transparent px-2 py-1 text-left cursor-pointer hover:bg-[var(--el-fill-color-light)]"
              data-testid="personal-menu-trigger"
            >
              <el-avatar :size="40" :src="auth.user?.avatarUrl ?? undefined" class="shrink-0">
                {{ auth.user?.name?.slice(0, 1) ?? '?' }}
              </el-avatar>
              <span class="min-w-0 max-w-48 flex flex-col gap-0.5">
                <span
                  class="truncate text-sm font-semibold leading-5 text-[var(--el-text-color-primary)]"
                >
                  {{ auth.user?.name ?? '账号' }}
                </span>
                <span class="truncate text-xs leading-4 text-[var(--el-text-color-secondary)]">
                  {{ userRoleLabel }}
                </span>
              </span>
              <ChevronDown
                :size="16"
                class="shrink-0 text-[var(--el-text-color-secondary)]"
                aria-hidden="true"
              />
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
      </div>
    </header>

    <div class="min-h-0 flex flex-1">
      <aside
        class="min-h-0 shrink-0 flex flex-col overflow-hidden bg-[#262D40] text-white transition-[width] duration-[160ms] ease-in-out"
        :style="{ width: sidebarWidth }"
      >
        <el-menu
          :default-active="activeMenu"
          :collapse="sidebarCollapsed"
          :collapse-transition="false"
          router
          class="min-h-0 flex-1 !w-full overflow-y-auto !border-r-0 !bg-transparent !pt-[50px] !pb-1 font-medium [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          :class="sidebarCollapsed ? '!px-[10px]' : '!px-4'"
          :style="{
            '--el-menu-bg-color': 'transparent',
            '--el-menu-hover-bg-color': 'rgb(255 255 255 / 10%)',
            '--el-menu-active-color': 'var(--el-color-primary)',
            '--el-menu-text-color': 'rgb(255 255 255 / 75%)',
            '--el-menu-hover-text-color': '#FFFFFF',
            '--el-menu-item-height': '44px',
            '--el-menu-sub-item-height': '44px',
            '--el-menu-base-level-padding': sidebarCollapsed ? '0px' : '16px',
            '--el-menu-icon-width': sidebarCollapsed ? '0px' : '24px',
            '--el-menu-level-padding': '12px',
            '--el-menu-border-color': 'transparent',
          }"
        >
          <template v-for="menu in visibleMenus" :key="menu.path">
            <el-sub-menu
              v-if="menu.children?.length"
              :index="menu.path"
              class="[&>div]:!h-[44px] [&>div]:!leading-[44px] [&>div]:mb-3 [&>div]:rounded-lg"
            >
              <template #title>
                <component
                  :is="moduleIconOf(menu.moduleKey)"
                  :size="18"
                  class="mr-2 shrink-0"
                  :style="sidebarCollapsed ? { marginLeft: '13px', marginRight: '0' } : undefined"
                />
                <span>{{ menu.title }}</span>
              </template>
              <el-menu-item
                v-for="child in menu.children"
                :key="child.path"
                :index="child.path"
                class="!h-[44px] !leading-[44px] mb-3 rounded-lg [&.is-active]:!bg-[#EEF3FF]"
                :style="sidebarCollapsed ? { justifyContent: 'center', padding: '0' } : undefined"
              >
                {{ child.title }}
              </el-menu-item>
            </el-sub-menu>
            <el-menu-item
              v-else
              :index="menu.path"
              class="!h-[44px] !leading-[44px] mb-3 rounded-lg [&.is-active]:!bg-[#EEF3FF]"
              :style="sidebarCollapsed ? { justifyContent: 'center', padding: '0' } : undefined"
            >
              <component
                :is="moduleIconOf(menu.moduleKey)"
                :size="18"
                class="mr-2 shrink-0"
                :style="sidebarCollapsed ? { marginRight: '0' } : undefined"
              />
              <span>{{ menu.title }}</span>
            </el-menu-item>
          </template>
        </el-menu>

        <div class="shrink-0 p-2">
          <el-divider class="!my-3 !border-white/15" />
          <button
            type="button"
            class="h-8 w-full flex items-center justify-center rounded-[var(--border-radius-small)] border-0 bg-transparent px-2 text-white/70 cursor-pointer hover:bg-white/10 hover:text-white"
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
          class="crm-layout-main h-full bg-[#F0F5FC] !overflow-x-hidden"
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

<style scoped>
.crm-layout-main {
  --el-main-padding: 16px 20px;
}
</style>
