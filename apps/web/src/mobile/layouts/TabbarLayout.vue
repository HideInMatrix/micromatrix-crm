<script setup lang="ts">
import { ClipboardCheck, House, Lightbulb, UserRound, Users } from 'lucide-vue-next'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

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

const active = computed({
  get: () => (route.name as string) ?? 'home',
  set: (name: string) => {
    const tab = visibleTabs.value.find((t) => t.name === name)
    if (tab && route.path !== tab.path) router.push(tab.path)
  },
})
</script>

<template>
  <div class="min-h-full pb-14">
    <router-view />
    <van-tabbar v-model="active" :z-index="100">
      <van-tabbar-item v-for="tab in visibleTabs" :key="tab.name" :name="tab.name">
        <template #icon="{ active: tabActive }">
          <component
            :is="tab.icon"
            :size="22"
            :stroke-width="tabActive ? 2.4 : 2"
            aria-hidden="true"
          />
        </template>
        {{ tab.title }}
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>
