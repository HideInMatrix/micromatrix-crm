<script setup lang="ts">
import type { OwnerHistoryVO } from '@micromatrix/shared'
import { computed, onMounted, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { leadApi } from '@/api/sales'

const props = defineProps<{
  leadId: string
  ownerId?: string | null
  ownerName?: string | null
  collectedAt?: string | null
}>()

const loading = ref(false)
const rows = ref<OwnerHistoryVO[]>([])
const loadError = ref('')

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function ownerLabel(row: OwnerHistoryVO) {
  return row.ownerName ?? row.ownerId ?? '原负责人'
}

function nextOwner(row: OwnerHistoryVO) {
  // 线索负责人历史记录的是上一段归属的结束时间；下一段归属的开始时间与之相同。
  const successor = rows.value.find(
    (item) => item.id !== row.id && item.collectedAt === row.endedAt,
  )
  if (successor) return ownerLabel(successor)
  if (props.collectedAt === row.endedAt && props.ownerId) {
    return props.ownerName ?? props.ownerId
  }
  // 没有立即衔接的归属区间，表示该次归属结束后进入未分配状态。
  return '未分配'
}

const history = computed(() =>
  [...rows.value].sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime()),
)

async function load() {
  if (!props.leadId) return
  loading.value = true
  loadError.value = ''
  try {
    const { data } = await leadApi.ownerHistory(props.leadId)
    rows.value = Array.isArray(data) ? data : []
  } catch (error) {
    rows.value = []
    loadError.value = extractErrorMessage(error)
  } finally {
    loading.value = false
  }
}

watch(() => props.leadId, load)
onMounted(load)
</script>

<template>
  <section v-loading="loading" class="min-h-[120px]">
    <h3
      class="m-0 mb-[13px] flex items-center gap-[6px] text-[14px] leading-none font-medium text-[#333333]"
    >
      <span
        aria-hidden="true"
        class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
      />
      变更记录
    </h3>

    <el-result
      v-if="!loading && loadError"
      icon="error"
      title="变更记录加载失败"
      :sub-title="loadError"
    >
      <template #extra>
        <el-button type="primary" @click="load">重新加载</el-button>
      </template>
    </el-result>

    <ol
      v-else-if="history.length"
      class="m-0 ml-[7px] list-none border-l-2 border-[#D9D9D9] p-0 pl-[28px]"
    >
      <li v-for="(row, index) in history" :key="row.id" class="relative pb-[48px] last:pb-[20px]">
        <span
          aria-hidden="true"
          class="absolute top-[5px] -left-[36px] h-[12px] w-[12px] rounded-full"
          :class="
            index === 0
              ? 'bg-[var(--el-color-primary)] ring-[4px] ring-[var(--el-color-primary-light-9)]'
              : 'bg-[#A9A9A9]'
          "
        />
        <time class="block text-[14px] leading-none text-[#999999]" :datetime="row.endedAt">
          {{ formatDate(row.endedAt) }}
        </time>
        <div
          class="mt-[12px] whitespace-pre-wrap break-words text-[14px] leading-none text-[#333333]"
        >
          负责人由 {{ ownerLabel(row) }} 变更为 {{ nextOwner(row) }}
        </div>
        <span
          class="mt-[8px] inline-flex h-[24px] max-w-full items-center rounded-[4px] bg-[#F5F7FA] px-[10px] text-[12px] leading-none text-[#999999]"
        >
          操作人：{{ row.operatorName ?? row.operatorId ?? '系统' }}
        </span>
      </li>
    </ol>

    <el-empty v-else-if="!loading" description="暂无变更记录" :image-size="60" />
  </section>
</template>
