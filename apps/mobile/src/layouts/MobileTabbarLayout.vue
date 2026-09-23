<script setup lang="ts">
import { House, Lightbulb, UserRound, Users } from 'lucide-vue-next'
import { computed, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MobileHeader from '@/components/MobileHeader.vue'
import { useAuthStore } from '@/stores/auth'
import { useSearchSelectStore } from '@/stores/search-select'
import { isWeComWorkbenchBrowser } from '@/utils/wecom'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const searchSelect = useSearchSelectStore()
const isWeCom = isWeComWorkbenchBrowser()
const transitionName = ref('transition-none')

const tabs = [
  { name: 'mobile-home', title: '首页', icon: House, path: '/home' },
  { name: 'leads', title: '线索', icon: Lightbulb, path: '/leads', perm: 'menu:lead' },
  { name: 'customers', title: '客户', icon: Users, path: '/customers', perm: 'menu:customer' },
  { name: 'mobile-mine', title: '我的', icon: UserRound, path: '/mine' },
]

const visibleTabs = computed(() => tabs.filter((tab) => !tab.perm || auth.hasPerm(tab.perm)))
const showTabbar = computed(() => route.meta.depth === 1)
const headerConfig = computed(() => route.meta.mobileHeader)
const showHeader = computed(() => Boolean(headerConfig.value) && !isWeCom)
const headerTitle = computed(() => {
  const config = headerConfig.value
  if (!config) return ''

  if (config.titleSource === 'search-select') {
    return `选择${searchSelect.context?.field.label ?? '内容'}`
  }

  if (config.titleQuery) {
    const queryTitle = route.query[config.titleQuery]
    if (typeof queryTitle === 'string' && queryTitle.trim()) return queryTitle.trim()
  }

  return route.meta.title ?? ''
})
const headerBack = computed(() => headerConfig.value?.back === true)

const removeTransitionGuard = router.beforeEach((to, from) => {
  const toDepth = to.meta.depth ?? 0
  const fromDepth = from.meta.depth ?? 0

  if (toDepth === 1 && fromDepth === 1) {
    transitionName.value = 'transition-none'
    return
  }
  transitionName.value = toDepth >= fromDepth ? 'slide-left' : 'slide-right'
})

onUnmounted(removeTransitionGuard)

const active = computed({
  get: () => (route.name as string) ?? 'home',
  set: (name: string) => {
    const tab = visibleTabs.value.find((t) => t.name === name)
    if (tab && route.path !== tab.path) router.replace(tab.path)
  },
})
</script>

<template>
  <div
    class="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[var(--mobile-page-background)]"
  >
    <MobileHeader
      v-if="showHeader"
      :title="headerTitle"
      :left-arrow="headerBack"
      class="shrink-0"
      @back="router.back()"
    />
    <router-view v-slot="{ Component, route: viewRoute }">
      <div
        class="relative min-h-0 flex-1 overflow-hidden bg-[var(--mobile-page-background)]"
      >
        <transition :name="transitionName">
          <keep-alive v-if="viewRoute.meta.depth === 1">
            <component :is="Component" :key="String(viewRoute.name)" />
          </keep-alive>
          <component
            :is="Component"
            v-else
            :key="viewRoute.meta.stableViewKey ? String(viewRoute.name) : viewRoute.fullPath"
          />
        </transition>
      </div>
    </router-view>
    <van-tabbar
      v-if="showTabbar"
      v-model="active"
      :fixed="false"
      :z-index="100"
      safe-area-inset-bottom
      class="relative box-content h-10 shrink-0 gap-2 border-t-[0.5px] border-[var(--text-n8)] bg-[var(--text-n10)]"
    >
      <van-tabbar-item
        v-for="tab in visibleTabs"
        :key="tab.name"
        :name="tab.name"
      >
        <template #icon="{ active: tabActive }">
          <component
            :is="tab.icon"
            :size="18"
            :stroke-width="tabActive ? 2.4 : 2"
            aria-hidden="true"
          />
        </template>
        {{ tab.title }}
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>
