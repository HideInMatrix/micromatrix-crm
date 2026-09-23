<script setup lang="ts">
import type { NotificationVO } from '@micromatrix/shared'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { notificationApi } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const keyword = ref('')
const notifications = ref<NotificationVO[]>([])
const unreadCount = ref(0)

async function load() {
  const [notificationRes, unreadRes] = await Promise.all([
    notificationApi.list({ page: 1, pageSize: 4 }),
    notificationApi.unreadCount(),
  ])
  notifications.value = notificationRes.data.items
  unreadCount.value = unreadRes.data.count
}

function openSearch() {
  router.push('/search')
}

async function markNotificationRead(item: NotificationVO) {
  if (!item.readAt) {
    await notificationApi.markRead(item.id)
    item.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  }
}

onMounted(load)
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <div class="flex items-center justify-between gap-3 bg-[var(--text-n10)] px-3 py-1">
      <div
        class="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[var(--text-n9)] text-base text-[var(--text-n2)]"
        @click="router.push('/mine')"
      >
        {{ auth.user?.name?.slice(0, 1) || 'M' }}
      </div>
      <van-search
        v-model="keyword"
        shape="round"
        placeholder="搜索"
        readonly
        class="flex-1 !p-0"
        @click="openSearch"
      />
      <van-badge :dot="unreadCount > 0">
        <van-icon name="bell" size="21" @click="router.push('/mine/message')" />
      </van-badge>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-[12px]">
      <van-cell-group class="mb-4 px-5 py-4" :border="false">
        <van-cell :border="false" class="!py-0">
          <template #title>
            <div class="font-semibold text-[var(--text-n1)]">快捷入口</div>
          </template>
        </van-cell>
        <van-grid :border="false" :column-num="3" class="mt-3">
          <van-grid-item text="新建线索" @click="router.push('/leads/create')">
            <template #icon><van-icon name="records-o" size="30" color="#ff9f0a" /></template>
          </van-grid-item>
          <van-grid-item text="新建客户" @click="router.push('/customers/create')">
            <template #icon><van-icon name="manager-o" size="30" color="#07c160" /></template>
          </van-grid-item>
          <van-grid-item text="新建联系人" @click="router.push('/contacts/create')">
            <template #icon><van-icon name="friends-o" size="30" color="#3b82f6" /></template>
          </van-grid-item>
        </van-grid>
      </van-cell-group>

      <van-cell-group class="px-5 py-4" :border="false">
        <van-cell :border="false" class="!py-0">
          <template #title>
            <div class="font-semibold text-[var(--text-n1)]">消息通知</div>
          </template>
          <template #value>
            <span class="text-[var(--text-n4)]" @click="router.push('/mine/message')">
              {{ unreadCount > 0 ? `未读 ${unreadCount}` : '全部已读' }}
            </span>
          </template>
        </van-cell>

        <van-empty
          v-if="notifications.length === 0"
          image-size="48"
          description="暂无消息"
          class="!py-5"
        />
        <van-cell
          v-for="item in notifications"
          v-else
          :key="item.id"
          class="!px-4"
          clickable
          @click="markNotificationRead(item)"
        >
          <template #title>
            <div class="flex min-w-0 items-center gap-2">
              <van-badge :dot="!item.readAt">
                <van-icon name="volume-o" size="18" color="var(--primary-8)" />
              </van-badge>
              <div class="min-w-0 flex-1 truncate text-sm text-[var(--text-n1)]">
                {{ item.title }}
              </div>
            </div>
          </template>
          <template #label>
            <div class="mt-1 line-clamp-2 text-xs text-[var(--text-n4)]">
              {{ item.content || '暂无详细内容' }}
            </div>
            <div class="mt-1 text-xs text-[var(--text-n5)]">
              {{ new Date(item.createdAt).toLocaleString('zh-CN') }}
            </div>
          </template>
        </van-cell>
      </van-cell-group>
    </div>
  </div>
</template>
