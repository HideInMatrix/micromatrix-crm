<script setup lang="ts">
import type { OwnerHistoryVO } from '@micromatrix/shared'
import { onMounted, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { customerExtraApi, leadApi } from '@/api/sales'

const props = defineProps<{
  module: 'lead' | 'customer'
  resourceId: string
}>()

const loading = ref(false)
const rows = ref<OwnerHistoryVO[]>([])

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  if (!props.resourceId) return
  loading.value = true
  try {
    const { data } =
      props.module === 'lead'
        ? await leadApi.ownerHistory(props.resourceId)
        : await customerExtraApi.ownerHistory(props.resourceId)
    rows.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.module, props.resourceId],
  () => load(),
)

onMounted(load)
</script>

<template>
  <div v-loading="loading">
    <el-empty v-if="!loading && rows.length === 0" description="暂无负责人历史" :image-size="70" />
    <el-timeline v-else>
      <el-timeline-item
        v-for="row in rows"
        :key="row.id"
        :timestamp="formatDate(row.endedAt)"
        placement="top"
      >
        <el-card shadow="never" class="!border-[var(--el-border-color-lighter)]">
          <div class="flex-between gap-3">
            <div>
              <span class="font-medium">{{ row.ownerName ?? '未知负责人' }}</span>
              <span v-if="row.departmentName" class="text-sm text-[var(--el-text-color-secondary)] ml-2">
                {{ row.departmentName }}
              </span>
            </div>
            <el-tag size="small" type="info">负责人结束</el-tag>
          </div>
          <div class="grid grid-cols-2 gap-x-5 gap-y-1 mt-3 text-sm">
            <div>
              <span class="text-[var(--el-text-color-secondary)]">开始持有：</span>
              {{ formatDate(row.collectedAt) }}
            </div>
            <div>
              <span class="text-[var(--el-text-color-secondary)]">结束时间：</span>
              {{ formatDate(row.endedAt) }}
            </div>
            <div>
              <span class="text-[var(--el-text-color-secondary)]">操作人：</span>
              {{ row.operatorName ?? (row.operatorId ? row.operatorId : '系统') }}
            </div>
            <div v-if="row.reasonName || row.reasonId">
              <span class="text-[var(--el-text-color-secondary)]">退池原因：</span>
              {{ row.reasonName ?? row.reasonId }}
            </div>
          </div>
        </el-card>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>
