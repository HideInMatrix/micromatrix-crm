<script setup lang="ts">
import type { NotificationBatchDetailVO } from '@micromatrix/shared'
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { notificationApi } from '@/api/system'
import { extractErrorMessage } from '@/api/http'

const route = useRoute()
const router = useRouter()
const id = computed(() => (typeof route.params.id === 'string' ? route.params.id : ''))
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
    const { data } = await notificationApi.batchItems(batchId, { page: page.value, pageSize })
    if (request === sequence && id.value === batchId) detail.value = data
  } catch (error) {
    if (request === sequence) errorMessage.value = extractErrorMessage(error)
  } finally {
    if (request === sequence) loading.value = false
  }
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
  <el-card shadow="never">
    <div class="flex items-center justify-between gap-3 mb-4">
      <el-button @click="router.push('/notifications')">返回消息中心</el-button>
      <el-button :loading="loading" @click="load">刷新明细</el-button>
    </div>
    <div v-loading="loading" class="min-h-40">
      <el-alert
        v-if="errorMessage"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />
      <template v-if="detail">
        <div class="flex items-center gap-3">
          <h2 class="m-0 text-lg font-semibold">{{ detail.title }}</h2>
          <el-tag size="small">{{ detail.channel === 'SYSTEM' ? '站内通知' : '企业微信' }}</el-tag>
        </div>
        <div class="mt-2 text-sm text-[var(--el-text-color-secondary)]">
          共 {{ detail.total }} 条 · {{ new Date(detail.windowStart).toLocaleString() }} 至
          {{ new Date(detail.windowEnd).toLocaleTimeString() }}
        </div>
        <el-empty
          v-if="!detail.items.length"
          :description="detail.detailsArchivedAt ? '明细已超过保留期限' : '暂无明细'"
        />
        <div
          v-for="item in detail.items"
          :key="item.id"
          class="py-4 border-b border-[var(--el-border-color-lighter)]"
        >
          <div class="flex items-center gap-3">
            <el-tag size="small" type="info">{{ item.eventName }}</el-tag>
            <span class="ml-auto text-xs text-[var(--el-text-color-secondary)]">{{
              new Date(item.occurredAt).toLocaleString()
            }}</span>
          </div>
          <template v-if="item.accessible">
            <div v-if="item.title && item.title !== item.eventName" class="mt-2 font-medium">
              {{ item.title }}
            </div>
            <div v-if="item.content" class="mt-1 text-sm whitespace-pre-wrap break-words">
              {{ item.content }}
            </div>
            <el-button
              v-if="item.link"
              link
              type="primary"
              class="mt-2"
              @click="router.push(item.link)"
              >{{ item.linkLabel || '查看业务详情' }}</el-button
            >
          </template>
          <div v-else class="mt-2 text-sm text-[var(--el-text-color-secondary)]">
            通知明细暂不可用。
          </div>
        </div>
        <div class="flex justify-end mt-4">
          <el-pagination
            v-model:current-page="page"
            :total="detail.total"
            :page-size="pageSize"
            layout="total, prev, pager, next"
            @current-change="load"
          />
        </div>
      </template>
    </div>
  </el-card>
</template>
