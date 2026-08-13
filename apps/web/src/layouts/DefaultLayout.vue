<script setup lang="ts">
import { useDark } from '@vueuse/core'
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import NotificationBell from '@/components/NotificationBell.vue'
import { MENUS, type MenuItem } from '@/router/menu'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const isDark = useDark()
const activeMenu = computed(() => route.path)

/** 按当前用户权限过滤菜单 */
const visibleMenus = computed<MenuItem[]>(() =>
  MENUS.map((m) => ({
    ...m,
    children: m.children?.filter((c) => auth.hasPerm(c.perm)),
  })).filter((m) => auth.hasPerm(m.perm) && (!m.children || m.children.length > 0)),
)

onMounted(() => {
  auth.fetchMe().catch(() => undefined)
})

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <el-container class="h-full">
    <el-aside width="220px" class="border-r border-[var(--el-border-color)]">
      <div class="h-14 flex-center gap-1 text-lg font-bold">
        <span class="text-[var(--el-color-primary)]">微矩阵</span>
        <span>CRM</span>
      </div>
      <el-menu :default-active="activeMenu" router class="!border-r-0">
        <template v-for="menu in visibleMenus" :key="menu.path">
          <el-sub-menu v-if="menu.children?.length" :index="menu.path">
            <template #title>{{ menu.title }}</template>
            <el-menu-item v-for="child in menu.children" :key="child.path" :index="child.path">
              {{ child.title }}
            </el-menu-item>
          </el-sub-menu>
          <el-menu-item v-else :index="menu.path">{{ menu.title }}</el-menu-item>
        </template>
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="flex-between border-b border-[var(--el-border-color)]">
        <span class="text-sm text-[var(--el-text-color-secondary)]">{{ route.meta.title }}</span>
        <div class="flex items-center gap-5">
          <NotificationBell />
          <el-switch v-model="isDark" inline-prompt active-text="暗" inactive-text="亮" />
          <el-dropdown @command="handleLogout">
            <span class="cursor-pointer text-sm outline-none">
              {{ auth.user?.name ?? '账号' }}
              <span v-if="auth.user?.roleName" class="text-[var(--el-text-color-secondary)]">
                · {{ auth.user.roleName }}
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
