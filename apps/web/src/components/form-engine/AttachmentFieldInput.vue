<script setup lang="ts">
import type { AttachmentVO } from '@micromatrix/shared'
import type { UploadRawFile } from 'element-plus'
import { ref, watch } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'

const props = withDefaults(
  defineProps<{
    initialOptions?: AttachmentVO[]
    onlyOne?: boolean
    accept?: string
    limitSize?: string
    readonly?: boolean
    download?: (file: AttachmentVO) => Promise<void>
  }>(),
  {
    initialOptions: () => [],
    onlyOne: false,
    accept: '',
    limitSize: '',
    readonly: false,
    download: undefined,
  },
)

const model = defineModel<string[]>({ default: () => [] })
const files = ref<AttachmentVO[]>([])
const uploading = ref(false)

const maxCount = () => (props.onlyOne ? 1 : 10)

function parseLimitBytes() {
  const text = props.limitSize.trim()
  if (!text) return 20 * 1024 * 1024
  const match = text.match(/^(\d+(?:\.\d+)?)(KB|MB)$/i)
  if (!match) return 20 * 1024 * 1024
  return Number(match[1]) * (match[2]?.toUpperCase() === 'KB' ? 1024 : 1024 * 1024)
}

function humanSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

watch(
  [model, () => props.initialOptions],
  () => {
    const metadata = new Map([
      ...props.initialOptions.map((item) => [item.id, item] as const),
      ...files.value.map((item) => [item.id, item] as const),
    ])
    files.value = (model.value ?? []).map(
      (id) =>
        metadata.get(id) ?? {
          id,
          name: id,
          size: 0,
          mime: null,
          targetType: null,
          targetId: null,
          uploaderId: null,
          createdAt: '',
        },
    )
  },
  { immediate: true, deep: true },
)

async function beforeUpload(file: UploadRawFile) {
  if (!props.onlyOne && model.value.length >= maxCount()) {
    ElMessage.warning(`最多上传 ${maxCount()} 个附件`)
    return false
  }
  const accepted = props.accept
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (
    accepted.length &&
    !accepted.some((extension) => file.name.toLowerCase().endsWith(extension))
  ) {
    ElMessage.warning(`仅允许上传：${accepted.join('、')}`)
    return false
  }
  if (file.size > parseLimitBytes()) {
    ElMessage.warning(`单个附件不能超过 ${props.limitSize || '20MB'}`)
    return false
  }

  uploading.value = true
  try {
    const { data } = await attachmentApi.upload(file)
    if (props.onlyOne) {
      for (const previous of files.value) {
        if (!previous.targetType) await attachmentApi.remove(previous.id).catch(() => undefined)
      }
      files.value = [data]
      model.value = [data.id]
    } else {
      files.value = [...files.value, data]
      model.value = [...model.value, data.id]
    }
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    uploading.value = false
  }
  return false
}

async function remove(file: AttachmentVO) {
  try {
    if (!file.targetType) await attachmentApi.remove(file.id)
    files.value = files.value.filter((item) => item.id !== file.id)
    model.value = model.value.filter((id) => id !== file.id)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function handleDownload(file: AttachmentVO) {
  try {
    if (props.download) await props.download(file)
    else await attachmentApi.download(file.id, file.name)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}
</script>

<template>
  <div class="w-full">
    <div v-if="files.length" class="mb-2 space-y-2">
      <div
        v-for="file in files"
        :key="file.id"
        class="flex items-center gap-3 rounded border border-[var(--el-border-color)] px-3 py-2"
      >
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm">{{ file.name }}</div>
          <div class="mt-0.5 text-xs text-[var(--el-text-color-secondary)]">
            {{ file.size ? humanSize(file.size) : '附件' }}
          </div>
        </div>
        <el-button link type="primary" @click="handleDownload(file)">下载</el-button>
        <el-button v-if="!readonly" link type="danger" @click="remove(file)">移除</el-button>
      </div>
    </div>

    <el-upload
      v-if="!readonly && model.length < maxCount()"
      :show-file-list="false"
      :accept="accept || undefined"
      :multiple="!onlyOne"
      :before-upload="beforeUpload"
    >
      <el-button :loading="uploading" type="primary" plain>上传附件</el-button>
      <template #tip>
        <div class="mt-1 text-xs text-[var(--el-text-color-secondary)]">
          {{ accept ? `允许 ${accept}` : '支持平台允许的文件类型' }}，单文件 ≤
          {{ limitSize || '20MB' }}，最多 {{ maxCount() }} 个
        </div>
      </template>
    </el-upload>
  </div>
</template>
