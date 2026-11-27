<script setup lang="ts">
import type { NotificationBatchDetailVO } from '@micromatrix/shared'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showFailToast } from 'vant'
import { notificationApi } from '@/api/system'
import { extractErrorMessage } from '@/api/http'
import { resolveMobileNotificationPath } from '@/utils/notification-link'

const route = useRoute()
const router = useRouter()
const id = computed(() => (typeof route.query.id === 'string' ? route.query.id : ''))
const detail = ref<NotificationBatchDetailVO | null>(null)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const errorMessage = ref('')
let sequence = 0

async function load() {
  const request = ++sequence
  const batchId = id.value
  detail.value = null
  errorMessage.value = ''
  loading.value = true
  try {
    if (!batchId) throw new Error('缺少通知批次编号')
    const { data } = await notificationApi.batchItems(batchId, { page: page.value, pageSize })
    if (request === sequence && id.value === batchId) detail.value = data
  } catch (error) {
    if (request === sequence) errorMessage.value = extractErrorMessage(error)
  } finally {
    if (request === sequence) loading.value = false
  }
}
function open(link: string) {
  const target = resolveMobileNotificationPath(link)
  if (!target) {
    showFailToast('该消息没有可打开的移动端链接')
    return
  }
  void router.push(target)
}
watch(
  id,
  () => {
    page.value = 1
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  sequence++
  detail.value = null
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-[var(--text-n9)]">
    <div class="min-h-0 flex-1 overflow-auto p-4">
      <div v-if="loading" class="flex justify-center py-10"><van-loading>加载中</van-loading></div>
      <van-empty v-else-if="errorMessage" image="error" :description="errorMessage">
        <van-button size="small" type="primary" @click="load">重试</van-button>
      </van-empty>
      <template v-else-if="detail">
        <div class="rounded-[6px] bg-[var(--text-n10)] p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-base font-semibold text-[var(--text-n1)]">{{ detail.title }}</span>
            <van-tag plain type="primary">{{
              detail.channel === 'SYSTEM' ? '站内通知' : '企业微信'
            }}</van-tag>
          </div>
          <div class="mt-2 text-sm text-[var(--text-n4)]">共 {{ detail.total }} 条通知</div>
          <div class="mt-1 text-xs text-[var(--text-n5)]">
            {{ new Date(detail.windowStart).toLocaleString() }} 至
            {{ new Date(detail.windowEnd).toLocaleTimeString() }}
          </div>
        </div>
        <van-empty v-if="!detail.items.length" description="暂无明细" />
        <div
          v-for="item in detail.items"
          :key="item.id"
          class="mt-3 rounded-[6px] bg-[var(--text-n10)] p-4"
        >
          <div class="flex items-start justify-between gap-2">
            <span class="min-w-0 text-sm font-semibold text-[var(--text-n1)]">{{
              item.eventName
            }}</span>
            <span class="shrink-0 text-xs text-[var(--text-n5)]">{{
              new Date(item.occurredAt).toLocaleTimeString()
            }}</span>
          </div>
          <template v-if="item.accessible">
            <div v-if="item.title" class="mt-2 text-sm font-medium">{{ item.title }}</div>
            <div
              v-if="item.content"
              class="mt-2 text-sm whitespace-pre-wrap break-words text-[var(--text-n4)]"
            >
              {{ item.content }}
            </div>
            <van-button
              v-if="item.link"
              plain
              type="primary"
              size="small"
              class="mt-3"
              @click="open(item.link)"
              >{{ item.linkLabel || '查看业务详情' }}</van-button
            >
          </template>
          <div v-else class="mt-2 text-sm text-[var(--text-n5)]">
            当前无法确认该业务的访问权限，明细内容已隐藏。
          </div>
        </div>
        <van-pagination
          v-model="page"
          :total-items="detail.total"
          :items-per-page="pageSize"
          class="mt-4"
          @change="load"
        />
        <div class="mt-4 flex justify-center">
          <van-button size="small" @click="load">刷新明细</van-button>
        </div>
      </template>
    </div>
  </div>
</template>
