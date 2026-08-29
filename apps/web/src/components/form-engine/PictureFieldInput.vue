<script setup lang="ts">
import type { UploadRawFile } from 'element-plus'
import { onBeforeUnmount, ref, watch } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'

const props = withDefaults(
  defineProps<{
    max?: number
    maxSizeMb?: number
    readonly?: boolean
  }>(),
  { max: 10, maxSizeMb: 20, readonly: false },
)

const model = defineModel<string[]>({ default: () => [] })
const previewUrls = ref<Record<string, string>>({})
const uploading = ref(false)

watch(
  model,
  async (ids) => {
    const wanted = new Set(ids ?? [])
    for (const [id, url] of Object.entries(previewUrls.value)) {
      if (!wanted.has(id)) {
        URL.revokeObjectURL(url)
        delete previewUrls.value[id]
      }
    }
    await Promise.all(
      [...wanted].map(async (id) => {
        if (previewUrls.value[id]) return
        try {
          previewUrls.value[id] = await attachmentApi.objectUrl(id)
        } catch {
          // Keep the key visible even when a previously uploaded image is no longer available.
        }
      }),
    )
  },
  { immediate: true, deep: true },
)

onBeforeUnmount(() => {
  for (const url of Object.values(previewUrls.value)) URL.revokeObjectURL(url)
})

async function beforeUpload(file: UploadRawFile) {
  if (model.value.length >= props.max) {
    ElMessage.warning(`最多上传 ${props.max} 张图片`)
    return false
  }
  if (!file.type.startsWith('image/')) {
    ElMessage.warning('仅支持图片文件')
    return false
  }
  if (file.size > props.maxSizeMb * 1024 * 1024) {
    ElMessage.warning(`单张图片不能超过 ${props.maxSizeMb}MB`)
    return false
  }
  uploading.value = true
  try {
    const { data } = await attachmentApi.upload(file)
    model.value = [...model.value, data.id]
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    uploading.value = false
  }
  return false
}

function unlink(id: string) {
  model.value = model.value.filter((item) => item !== id)
}
</script>

<template>
  <div class="w-full">
    <div v-if="model.length" class="flex flex-wrap gap-2 mb-2">
      <div
        v-for="id in model"
        :key="id"
        class="relative h-24 w-24 overflow-hidden rounded border border-[var(--el-border-color)] bg-[var(--el-fill-color-light)]"
      >
        <img v-if="previewUrls[id]" :src="previewUrls[id]" class="h-full w-full object-cover" />
        <div
          v-else
          class="h-full w-full flex items-center justify-center text-xs text-[var(--el-text-color-secondary)]"
        >
          图片
        </div>
        <el-button
          v-if="!readonly"
          circle
          size="small"
          type="danger"
          class="!absolute right-1 top-1"
          @click="unlink(id)"
        >
          ×
        </el-button>
      </div>
    </div>
    <el-upload
      v-if="!readonly && model.length < max"
      :show-file-list="false"
      accept="image/*"
      multiple
      :before-upload="beforeUpload"
    >
      <el-button :loading="uploading" type="primary" plain>上传图片</el-button>
      <template #tip>
        <div class="text-xs text-[var(--el-text-color-secondary)] mt-1">
          最多 {{ max }} 张，单张 ≤ {{ maxSizeMb }}MB
        </div>
      </template>
    </el-upload>
  </div>
</template>
