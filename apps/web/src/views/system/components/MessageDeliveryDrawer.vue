<script setup lang="ts">
import type { MessageDeliveryStatus, MessageDeliveryVO } from '@micromatrix/shared'
import { MESSAGE_TASK_DEFINITIONS } from '@micromatrix/shared'
import { computed, reactive, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { messageDeliveryApi } from '@/api/system'
import { useAuthStore } from '@/stores/auth'

const model = defineModel<boolean>({ required: true })
const auth = useAuthStore()
const loading = ref(false)
const retryingId = ref('')
const items = ref<MessageDeliveryVO[]>([])
const total = ref(0)
const query = reactive<{
  page: number
  pageSize: number
  keyword: string
  status: '' | MessageDeliveryStatus
  event: string
}>({ page: 1, pageSize: 20, keyword: '', status: '', event: '' })

const eventOptions = computed(() =>
  MESSAGE_TASK_DEFINITIONS.map((item) => ({ label: item.eventName, value: item.event })),
)

const statusMeta: Record<
  MessageDeliveryStatus,
  { label: string; type: 'success' | 'warning' | 'danger' | 'info' }
> = {
  PENDING: { label: '等待发送', type: 'info' },
  SENDING: { label: '发送中', type: 'warning' },
  SUCCEEDED: { label: '已送达', type: 'success' },
  FAILED: { label: '等待重试', type: 'warning' },
  DEAD: { label: '已终止', type: 'danger' },
}

async function load() {
  loading.value = true
  try {
    const { data } = await messageDeliveryApi.list({
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword.trim() || undefined,
      status: query.status || undefined,
      event: query.event || undefined,
    })
    items.value = data.items
    total.value = data.total
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function search() {
  query.page = 1
  void load()
}

async function retry(row: MessageDeliveryVO) {
  retryingId.value = row.id
  try {
    await messageDeliveryApi.retry(row.id)
    ElMessage.success('已重新加入发送队列')
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    retryingId.value = ''
  }
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

watch(model, (visible) => {
  if (visible) void load()
})
</script>

<template>
  <el-drawer v-model="model" title="企业微信投递记录" size="76%" destroy-on-close>
    <div class="mb-4 flex flex-wrap gap-2">
      <el-input
        v-model="query.keyword"
        placeholder="接收人 / UserID / 错误信息"
        clearable
        class="!w-64"
        @keyup.enter="search"
        @clear="search"
      />
      <el-select v-model="query.status" clearable placeholder="全部状态" class="!w-36">
        <el-option
          v-for="(meta, status) in statusMeta"
          :key="status"
          :label="meta.label"
          :value="status"
        />
      </el-select>
      <el-select v-model="query.event" clearable filterable placeholder="全部场景" class="!w-48">
        <el-option
          v-for="option in eventOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
        />
      </el-select>
      <el-button type="primary" @click="search">查询</el-button>
    </div>

    <el-table v-loading="loading" :data="items" border>
      <el-table-column label="发送时间" width="170">
        <template #default="{ row }">{{ formatDate(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column prop="eventName" label="通知场景" width="150" />
      <el-table-column label="接收人" width="160">
        <template #default="{ row }">
          <div>{{ row.userName || '-' }}</div>
          <div class="text-xs text-[var(--el-text-color-secondary)]">
            {{ row.externalSubject || '无企微映射' }}
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="title" label="消息" min-width="220" show-overflow-tooltip />
      <el-table-column label="状态" width="110" align="center">
        <template #default="{ row }">
          <el-tag :type="statusMeta[row.status as MessageDeliveryStatus].type">
            {{ statusMeta[row.status as MessageDeliveryStatus].label }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="尝试" width="80" align="center">
        <template #default="{ row }">{{ row.attempts }}/{{ row.maxAttempts }}</template>
      </el-table-column>
      <el-table-column label="结果" min-width="240" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.status === 'SUCCEEDED'">{{ formatDate(row.sentAt) }}</span>
          <span v-else>{{ row.errorMessage || '-' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="90" fixed="right">
        <template #default="{ row }">
          <el-button
            v-if="row.status === 'FAILED' || row.status === 'DEAD'"
            link
            type="primary"
            :loading="retryingId === row.id"
            :disabled="!auth.hasPerm('system:message:update')"
            @click="retry(row as MessageDeliveryVO)"
          >
            重试
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="mt-4 flex justify-end">
      <el-pagination
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </div>
  </el-drawer>
</template>
