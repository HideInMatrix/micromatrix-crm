<script setup lang="ts">
import type { NotificationVO } from '@micromatrix/shared'
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { extractErrorMessage } from '@/api/http'
import { notificationApi } from '@/api/system'

const router = useRouter()
const loading = ref(false)
const items = ref<NotificationVO[]>([])
const total = ref(0)
const query = reactive({ page: 1, pageSize: 10, unreadOnly: false })

async function loadData() {
  loading.value = true
  try {
    const { data } = await notificationApi.list({
      page: query.page,
      pageSize: query.pageSize,
      unreadOnly: query.unreadOnly || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function openItem(item: NotificationVO) {
  if (!item.readAt) {
    await notificationApi.markRead(item.id)
    item.readAt = new Date().toISOString()
  }
  if (item.link) router.push(item.link)
}

async function markAll() {
  await notificationApi.markAllRead()
  ElMessage.success('已全部标记为已读')
  loadData()
}

onMounted(loadData)
</script>

<template>
  <el-card shadow="never">
    <div class="flex-between mb-4">
      <el-switch
        v-model="query.unreadOnly"
        active-text="只看未读"
        @change="((query.page = 1), loadData())"
      />
      <el-button @click="markAll">全部已读</el-button>
    </div>

    <div v-loading="loading">
      <el-empty v-if="items.length === 0" description="暂无消息" />
      <div
        v-for="item in items"
        :key="item.id"
        class="py-3 border-b border-[var(--el-border-color-lighter)] cursor-pointer hover:bg-[var(--el-fill-color-light)] px-2 rounded"
        @click="openItem(item)"
      >
        <div class="flex items-center gap-2">
          <el-badge v-if="!item.readAt" is-dot />
          <span class="font-medium text-sm">{{ item.title }}</span>
          <el-tag size="small" class="ml-auto">{{ item.type }}</el-tag>
        </div>
        <div v-if="item.content" class="text-sm text-[var(--el-text-color-secondary)] mt-1">
          {{ item.content }}
        </div>
        <div class="text-xs text-[var(--el-text-color-placeholder)] mt-1">
          {{ new Date(item.createdAt).toLocaleString() }}
        </div>
      </div>
    </div>

    <div class="flex justify-end mt-4">
      <el-pagination
        v-model:current-page="query.page"
        :total="total"
        :page-size="query.pageSize"
        layout="total, prev, pager, next"
        @current-change="loadData"
      />
    </div>
  </el-card>
</template>
