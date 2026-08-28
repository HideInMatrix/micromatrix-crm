<script setup lang="ts">
import type { ExportTaskVO } from '@micromatrix/shared'
import { ref } from 'vue'
import { exportTasksApi } from '@/api/import-export'
import { extractErrorMessage } from '@/api/http'

const visible = ref(false)
const loading = ref(false)
const tasks = ref<ExportTaskVO[]>([])
const props = withDefaults(defineProps<{ showTrigger?: boolean }>(), { showTrigger: true })

async function open() {
  visible.value = true
  await load()
}

defineExpose({ open })

async function load() {
  loading.value = true
  try {
    const { data } = await exportTasksApi.list()
    tasks.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function download(task: ExportTaskVO) {
  try {
    const { data } = await exportTasksApi.download(task.id)
    const url = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = url
    link.download = `${task.fileName}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(task: ExportTaskVO) {
  try {
    await exportTasksApi.remove(task.id)
    await load()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function statusType(status: ExportTaskVO['status']) {
  if (status === 'SUCCESS') return 'success'
  if (status === 'FAILED') return 'danger'
  if (status === 'CANCELED') return 'info'
  return 'warning'
}

function statusLabel(status: ExportTaskVO['status']) {
  return { PENDING: '处理中', SUCCESS: '已完成', FAILED: '失败', CANCELED: '已取消' }[status]
}
</script>

<template>
  <el-button v-if="props.showTrigger" link @click="open">导出任务</el-button>
  <el-drawer v-model="visible" title="导出任务" size="560px" destroy-on-close>
    <div class="flex justify-end mb-3">
      <el-button size="small" :loading="loading" @click="load">刷新</el-button>
    </div>
    <el-table v-loading="loading" :data="tasks" empty-text="暂无导出任务">
      <el-table-column prop="fileName" label="文件" min-width="180" show-overflow-tooltip />
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)" size="small">{{ statusLabel(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="rowCount" label="数据量" width="80" />
      <el-table-column label="创建时间" width="150">
        <template #default="{ row }">{{ new Date(row.createdAt).toLocaleString() }}</template>
      </el-table-column>
      <el-table-column label="操作" width="110" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'SUCCESS'" link type="primary" @click="download(row as ExportTaskVO)">下载</el-button>
          <el-button link @click="remove(row as ExportTaskVO)">清理</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-alert
      title="导出任务仅保留 24 小时，请及时下载。"
      type="info"
      :closable="false"
      class="mt-4"
    />
  </el-drawer>
</template>
