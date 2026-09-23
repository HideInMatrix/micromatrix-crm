<script setup lang="ts">
import type { NotificationVO } from '@micromatrix/shared'
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import { showSuccessFeedback } from '@/utils/feedback'
import { notificationApi } from '@/api/system'

type MessageTab = 'all' | 'unread'

const router = useRouter()
const activeTab = ref<MessageTab>('all')
const items = ref<NotificationVO[]>([])
const page = ref(1)
const loading = ref(false)
const finished = ref(false)
const refreshing = ref(false)
const unreadCount = ref(0)

async function loadUnreadCount() {
  const { data } = await notificationApi.unreadCount()
  unreadCount.value = data.count
}

async function loadMore() {
  loading.value = true
  try {
    const { data } = await notificationApi.list({
      page: page.value,
      pageSize: 20,
      unreadOnly: activeTab.value === 'unread' || undefined,
    })
    if (refreshing.value) {
      items.value = []
      refreshing.value = false
    }
    items.value.push(...data.items)
    finished.value = items.value.length >= data.total
    page.value += 1
  } catch (error) {
    showFailToast(extractErrorMessage(error))
    finished.value = true
  } finally {
    loading.value = false
  }
}

function reload() {
  page.value = 1
  items.value = []
  finished.value = false
  void loadMore()
  void loadUnreadCount()
}

async function openItem(item: NotificationVO) {
  try {
    if (!item.readAt) {
      await notificationApi.markRead(item.id)
      item.readAt = new Date().toISOString()
      unreadCount.value = Math.max(0, unreadCount.value - 1)
      if (activeTab.value === 'unread') items.value = items.value.filter((row) => row.id !== item.id)
    }

    if (!item.link) return
    if (/^https?:\/\//i.test(item.link)) {
      window.location.href = item.link
      return
    }
    if (item.link.startsWith('/mobile/')) {
      await router.push(item.link.slice('/mobile'.length) || '/home')
      return
    }
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

async function markAllRead() {
  try {
    await notificationApi.markAllRead()
    unreadCount.value = 0
    items.value.forEach((item) => {
      item.readAt ||= new Date().toISOString()
    })
    if (activeTab.value === 'unread') items.value = []
    showSuccessFeedback('已全部标记为已读')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  }
}

watch(activeTab, reload)
onMounted(() => {
  void loadUnreadCount()
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <van-nav-bar
      title="消息通知"
      left-arrow
      right-text="全部已读"
      @click-left="router.back()"
      @click-right="markAllRead"
    />

    <van-tabs v-model:active="activeTab" border>
      <van-tab name="all">
        <template #title>
          <div class="text-base" :class="activeTab === 'all' ? 'text-[var(--primary-8)]' : ''">
            全部消息
          </div>
        </template>
      </van-tab>
      <van-tab name="unread">
        <template #title>
          <van-badge :content="unreadCount || undefined" :show-zero="false">
            <div
              class="text-base"
              :class="activeTab === 'unread' ? 'text-[var(--primary-8)]' : ''"
            >
              未读消息
            </div>
          </van-badge>
        </template>
      </van-tab>
    </van-tabs>

    <van-pull-refresh
      v-model="refreshing"
      class="min-h-0 flex-1 overflow-auto"
      @refresh="reload"
    >
      <van-list
        v-model:loading="loading"
        :finished="finished"
        finished-text="已经到底部啦~"
        class="flex flex-col gap-4 p-4"
        @load="loadMore"
      >
        <van-empty
          v-if="items.length === 0 && finished"
          image-size="64"
          description="暂无消息"
          class="!py-10"
        />

        <div
          v-for="item in items"
          :key="item.id"
          class="rounded-[6px] bg-[var(--text-n10)] px-5 py-4"
          @click="openItem(item)"
        >
          <div class="flex items-start gap-3">
            <van-badge :dot="!item.readAt">
              <div
                class="flex h-8 w-8 items-center justify-center rounded-[6px] bg-[var(--primary-7)]"
              >
                <van-icon name="volume-o" size="18" color="var(--primary-8)" />
              </div>
            </van-badge>

            <div class="min-w-0 flex-1">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-n1)]">
                  {{ item.title }}
                </div>
                <div class="shrink-0 text-xs text-[var(--text-n5)]">
                  {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}
                </div>
              </div>
              <div
                v-if="item.content"
                class="mt-2 line-clamp-2 text-xs leading-5 text-[var(--text-n4)]"
              >
                {{ item.content }}
              </div>
              <div
                v-if="item.linkLabel"
                class="mt-2 text-xs text-[var(--primary-8)]"
              >
                {{ item.linkLabel }}
              </div>
            </div>
          </div>
        </div>
      </van-list>
    </van-pull-refresh>
  </div>
</template>
