<script setup lang="ts">
import type { NotificationVO } from '@micromatrix/shared'
import { Bell } from 'lucide-vue-next'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { notificationApi } from '@/api/system'
import { dispatchNotificationsChanged } from '@/utils/notification-events'
import { getAccessToken } from '@/utils/token-storage'

const router = useRouter()
const unread = ref(0)
const recent = ref<NotificationVO[]>([])

const RECONNECT_DELAYS = [1_000, 2_000, 5_000, 10_000, 30_000] as const
const MAX_SEEN_NOTIFICATION_IDS = 100

let eventSource: EventSource | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let refreshPromise: Promise<void> | null = null
let disposed = false

const seenNotificationIds = new Set<string>()

function rememberNotification(id: string): void {
  seenNotificationIds.add(id)
  if (seenNotificationIds.size <= MAX_SEEN_NOTIFICATION_IDS) return

  const oldest = seenNotificationIds.values().next().value
  if (oldest) seenNotificationIds.delete(oldest)
}

/**
 * The shared HTTP client refreshes an expired access token before retrying
 * failed API requests. Keep this request ahead of every SSE connection so
 * EventSource never starts with a token that is being refreshed concurrently.
 */
async function refresh(): Promise<void> {
  if (refreshPromise) return refreshPromise

  const current = (async () => {
    const [{ data: count }, { data: list }] = await Promise.all([
      notificationApi.unreadCount(),
      notificationApi.list({ page: 1, pageSize: 5, unreadOnly: true }),
    ])

    unread.value = count.count
    recent.value = list.items
    for (const item of list.items) rememberNotification(item.id)
  })()

  refreshPromise = current
  try {
    await current
  } finally {
    if (refreshPromise === current) refreshPromise = null
  }
}

function handleCreated(event: MessageEvent<string>): void {
  let notification: NotificationVO

  try {
    notification = JSON.parse(event.data) as NotificationVO
  } catch {
    void refresh().catch(() => undefined)
    return
  }

  if (!notification?.id || seenNotificationIds.has(notification.id)) return

  rememberNotification(notification.id)
  unread.value += 1
  recent.value = [notification, ...recent.value.filter((item) => item.id !== notification.id)].slice(
    0,
    5,
  )
  dispatchNotificationsChanged()

  ElNotification({
    title: notification.title,
    message: notification.content ?? '',
    type: 'info',
    duration: 4000,
  })
}

function handleRefresh(): void {
  void refresh()
    .then(() => dispatchNotificationsChanged())
    .catch(() => undefined)
}

function connectStream(): void {
  if (disposed || eventSource) return

  const token = getAccessToken()
  if (!token) return

  const source = new EventSource(
    `/api/notifications/stream?token=${encodeURIComponent(token)}`,
  )
  eventSource = source

  source.onopen = () => {
    if (eventSource !== source) return
    reconnectAttempts = 0
  }

  source.onmessage = handleCreated
  source.addEventListener('refresh', handleRefresh)

  source.onerror = () => {
    if (eventSource !== source) return

    // EventSource otherwise retries forever with the same URL (and token).
    // Close it and create a fresh connection after the HTTP client has had
    // an opportunity to refresh the access token.
    source.close()
    eventSource = null
    scheduleReconnect()
  }
}

function scheduleReconnect(): void {
  if (disposed || reconnectTimer) return

  const delay =
    RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)]
  reconnectAttempts += 1

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    void reconnectStream()
  }, delay)
}

async function reconnectStream(): Promise<void> {
  if (disposed || eventSource) return

  try {
    // This authenticated request goes through the shared Axios refresh flow.
    // The subsequent EventSource therefore uses the latest access token.
    await refresh()
  } catch {
    if (!disposed && getAccessToken()) scheduleReconnect()
    return
  }

  if (disposed || !getAccessToken()) return
  connectStream()
}

async function initialize(): Promise<void> {
  try {
    // Do not race the initial API token refresh against EventSource creation.
    await refresh()
  } catch {
    // Still try the current token; a failed network request is recovered by
    // the SSE error/reconnect path below.
  }

  if (!disposed && getAccessToken()) connectStream()
}

function handlePopoverShow(): void {
  void refresh().catch(() => undefined)
}

async function openItem(item: NotificationVO): Promise<void> {
  await notificationApi.markRead(item.id)
  await refresh()
  dispatchNotificationsChanged()
  if (item.link) router.push(item.link)
}

async function markAll(): Promise<void> {
  await notificationApi.markAllRead()
  await refresh()
  dispatchNotificationsChanged()
}

onMounted(() => {
  disposed = false
  void initialize()
})

onBeforeUnmount(() => {
  disposed = true

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  eventSource?.close()
  eventSource = null
})
</script>

<template>
  <el-popover
    placement="bottom-end"
    width="340"
    trigger="click"
    @after-enter="handlePopoverShow"
  >
    <template #reference>
      <button
        type="button"
        class="h-[38px] w-[38px] flex-center rounded-full border-0 bg-[#F5F7FA] p-0 text-[var(--el-text-color-regular)] cursor-pointer hover:bg-[#E9EDF5]"
        aria-label="消息中心"
      >
        <el-badge :is-dot="unread > 0" :hidden="unread === 0">
          <span class="inline-flex h-[18px] w-[18px] items-center justify-center">
            <Bell :size="18" :stroke-width="1.8" aria-hidden="true" />
          </span>
        </el-badge>
      </button>
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
