<script setup lang="ts">
import type { NotificationVO } from '@micromatrix/shared'
import { Bell } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { notificationApi } from '@/api/system'
import { getAccessToken } from '@/utils/token-storage'

const router = useRouter()
const unread = ref(0)
const recent = ref<NotificationVO[]>([])
let eventSource: EventSource | null = null

async function refresh() {
  const [{ data: count }, { data: list }] = await Promise.all([
    notificationApi.unreadCount(),
    notificationApi.list({ page: 1, pageSize: 5, unreadOnly: true }),
  ])
  unread.value = count.count
  recent.value = list.items
}

function connectStream() {
  const token = getAccessToken()
  if (!token) return
  eventSource = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`)
  eventSource.onmessage = (event) => {
    const notification = JSON.parse(event.data) as NotificationVO
    unread.value += 1
    recent.value = [notification, ...recent.value].slice(0, 5)
    ElNotification({
      title: notification.title,
      message: notification.content ?? '',
      type: 'info',
      duration: 4000,
    })
  }
  eventSource.addEventListener('refresh', () => {
    refresh().catch(() => undefined)
  })
}

async function openItem(item: NotificationVO) {
  await notificationApi.markRead(item.id)
  await refresh()
  if (item.link) router.push(item.link)
}

async function markAll() {
  await notificationApi.markAllRead()
  await refresh()
}

onMounted(() => {
  refresh().catch(() => undefined)
  connectStream()
})

onBeforeUnmount(() => {
  eventSource?.close()
})
</script>

<template>
  <el-popover placement="bottom-end" width="340" trigger="click">
    <template #reference>
      <el-badge :value="unread" :hidden="unread === 0" :max="99" class="cursor-pointer">
        <button
          type="button"
          class="h-8 w-8 flex-center border-0 rounded-[var(--border-radius-small)] bg-transparent p-2 text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[var(--el-fill-color-light)]"
          aria-label="消息中心"
        >
          <Bell :size="16" :stroke-width="1.8" aria-hidden="true" />
        </button>
      </el-badge>
    </template>

    <div class="flex-between mb-2">
      <span class="font-medium">未读消息</span>
      <div class="flex gap-3">
        <el-button link type="primary" size="small" :disabled="unread === 0" @click="markAll">
          全部已读
        </el-button>
        <el-button link size="small" @click="router.push('/notifications')">查看全部</el-button>
      </div>
    </div>

    <el-empty v-if="recent.length === 0" description="暂无未读消息" :image-size="60" />
    <div
      v-for="item in recent"
      :key="item.id"
      class="py-2 border-b border-[var(--el-border-color-lighter)] last:border-b-0 cursor-pointer hover:bg-[var(--el-fill-color-light)] px-1 rounded"
      @click="openItem(item)"
    >
      <div class="text-sm">{{ item.title }}</div>
      <div v-if="item.content" class="text-xs text-[var(--el-text-color-secondary)] mt-1 truncate">
        {{ item.content }}
      </div>
      <div class="text-xs text-[var(--el-text-color-placeholder)] mt-1">
        {{ new Date(item.createdAt).toLocaleString() }}
      </div>
    </div>
  </el-popover>
</template>
