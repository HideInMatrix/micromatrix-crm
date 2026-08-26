<script setup lang="ts">
import { useDark } from '@vueuse/core'
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import ExportTaskButton from '@/components/ExportTaskButton.vue'
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
    </el-aside>

    <el-container>
      <el-header class="flex-between border-b border-[var(--el-border-color)]">
        <span class="text-sm text-[var(--el-text-color-secondary)]">{{ route.meta.title }}</span>
        <div class="flex items-center gap-5">
          <ExportTaskButton />
          <TopNavigationActions />
          <el-switch v-model="isDark" inline-prompt active-text="暗" inactive-text="亮" />
          <el-dropdown @command="handleLogout">
            <span class="cursor-pointer text-sm outline-none">
              {{ auth.user?.name ?? '账号' }}
              <span v-if="auth.user?.roles.length" class="text-[var(--el-text-color-secondary)]">
                · {{ auth.user.roles.map((role) => role.name).join(' / ') }}
              </span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="bg-[var(--el-bg-color-page)]">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>
