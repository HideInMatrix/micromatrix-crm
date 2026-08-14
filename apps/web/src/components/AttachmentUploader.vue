<script setup lang="ts">
import type { AttachmentVO } from '@micromatrix/shared'
import type { UploadFile, UploadRawFile } from 'element-plus'
import { ref, watch } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  targetType: string
  targetId: string | null
  readonly?: boolean
}>()

const files = ref<AttachmentVO[]>([])
const loading = ref(false)

watch(
  () => [props.targetType, props.targetId] as const,
  ([, id]) => {
    if (id) loadList()
    else files.value = []
  },
  { immediate: true },
)

async function loadList() {
  if (!props.targetId) return
  loading.value = true
  try {
    const { data } = await attachmentApi.list(props.targetType, props.targetId)
    files.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleUpload(uploadFile: UploadRawFile) {
  if (!props.targetId) return
  try {
    await attachmentApi.upload(uploadFile, props.targetType, props.targetId)
    ElMessage.success('已上传')
    await loadList()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDownload(file: AttachmentVO) {
  try {
    await attachmentApi.download(file.id, file.name)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleRemove(file: AttachmentVO) {
  const confirmed = await ElMessageBox.confirm(`删除附件「${file.name}」？`, '确认', {
    type: 'warning',
  }).catch(() => false)
  if (!confirmed) return
  try {
    await attachmentApi.remove(file.id)
    ElMessage.success('已删除')
    await loadList()
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function beforeUpload(file: UploadRawFile) {
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('文件不能超过 20MB')
    return false
  }
  void handleUpload(file)
  return false
}

function noopChange(_file: UploadFile) {
  return
}
</script>

<template>
  <div v-loading="loading">
    <el-upload
      v-if="!readonly && targetId"
      :show-file-list="false"
      :before-upload="beforeUpload"
      :on-change="noopChange"
      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
    >
      <el-button size="small" type="primary">上传附件</el-button>
      <template #tip>
        <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
          支持图片、Office、PDF、压缩包，单文件 ≤20MB
        </div>
      </template>
    </el-upload>

    <el-empty v-if="files.length === 0" description="暂无附件" :image-size="48" />
    <div
      v-for="file in files"
      :key="file.id"
      class="flex-between py-2 border-b border-[var(--el-border-color-lighter)] last:border-b-0"
    >
      <div class="min-w-0">
        <div class="text-sm truncate">{{ file.name }}</div>
        <div class="text-xs text-[var(--el-text-color-secondary)]">{{ formatSize(file.size) }}</div>
      </div>
      <div class="shrink-0">
        <el-button link type="primary" size="small" @click="handleDownload(file)">下载</el-button>
        <el-button
          v-if="!readonly"
          link
          type="danger"
          size="small"
          @click="handleRemove(file)"
        >
          删除
        </el-button>
      </div>
    </div>
  </div>
</template>
