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
const loadError = ref('')

function formatDate(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

async function load() {
  if (!props.resourceId) return
  loading.value = true
  loadError.value = ''
  try {
    const { data } =
      props.module === 'lead'
        ? await leadApi.ownerHistory(props.resourceId)
        : await customerExtraApi.ownerHistory(props.resourceId)
    rows.value = Array.isArray(data) ? data : []
  } catch (error) {
    rows.value = []
    loadError.value = extractErrorMessage(error)
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
  <div v-loading="loading" class="min-h-[180px]">
    <el-result
      v-if="!loading && loadError"
      icon="error"
      title="负责人记录加载失败"
      :sub-title="loadError"
    >
      <template #extra>
        <el-button type="primary" @click="load">重新加载</el-button>
      </template>
    </el-result>

    <el-empty
      v-else-if="!loading && rows.length === 0"
      description="暂无负责人记录"
      :image-size="76"
    />

    <el-table v-else-if="rows.length > 0" :data="rows" border stripe class="w-full">
      <el-table-column label="负责人" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.ownerName ?? row.ownerId ?? '-' }}
        </template>
      </el-table-column>
      <el-table-column label="部门" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.departmentName ?? '-' }}
        </template>
      </el-table-column>
      <el-table-column label="归属开始时间" min-width="170">
        <template #default="{ row }">
          {{ formatDate(row.collectedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="归属结束时间" min-width="170">
        <template #default="{ row }">
          {{ formatDate(row.endedAt) }}
        </template>
      </el-table-column>
      <el-table-column label="回收原因" min-width="130" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.reasonName ?? row.reasonId ?? '-' }}
        </template>
      </el-table-column>
      <el-table-column label="操作人" min-width="120" show-overflow-tooltip>
        <template #default="{ row }">
          {{ row.operatorName ?? row.operatorId ?? '系统' }}
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>
