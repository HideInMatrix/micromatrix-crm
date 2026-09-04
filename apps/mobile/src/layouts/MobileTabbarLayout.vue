<script setup lang="ts">
import { ClipboardCheck, House, Lightbulb, UserRound, Users } from 'lucide-vue-next'
import { computed, onUnmounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const transitionName = ref('transition-none')

const tabs = [
  { name: 'mobile-home', title: '工作台', icon: House, path: '/home' },
  { name: 'leads', title: '线索', icon: Lightbulb, path: '/leads', perm: 'menu:lead' },
  { name: 'customers', title: '客户', icon: Users, path: '/customers', perm: 'menu:customer' },
  {
    name: 'approvals',
    title: '审批',
    icon: ClipboardCheck,
    path: '/approvals',
    perm: 'menu:approval',
  },
  { name: 'mobile-mine', title: '我的', icon: UserRound, path: '/mine' },
]

const visibleTabs = computed(() => tabs.filter((tab) => !tab.perm || auth.hasPerm(tab.perm)))
const showTabbar = computed(() => route.meta.depth === 1)

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
    if (tab && route.path !== tab.path) router.push(tab.path)
  },
})
</script>

<template>
  <div class="crm-mobile-layout min-h-full" :class="{ 'crm-mobile-layout--tabbar': showTabbar }">
    <router-view v-slot="{ Component, route: viewRoute }">
      <div class="crm-mobile-view">
        <transition :name="transitionName">
          <keep-alive v-if="viewRoute.meta.depth === 1">
            <component :is="Component" :key="String(viewRoute.name)" />
          </keep-alive>
          <component :is="Component" v-else :key="viewRoute.fullPath" />
        </transition>
      </div>
    </router-view>
    <van-tabbar
      v-if="showTabbar"
      v-model="active"
      :z-index="100"
      safe-area-inset-bottom
      class="crm-mobile-tabbar"
    >
      <van-tabbar-item v-for="tab in visibleTabs" :key="tab.name" :name="tab.name">
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
