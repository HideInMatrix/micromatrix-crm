<script setup lang="ts">
import type { AttachmentVO } from '@micromatrix/shared'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'

const props = withDefaults(
  defineProps<{
    modelValue: AttachmentVO[]
    readonly?: boolean
  }>(),
  { readonly: false },
)

const emit = defineEmits<{
  'update:modelValue': [value: AttachmentVO[]]
}>()

const inputRef = ref<HTMLInputElement>()
const uploading = ref(false)

function formatSize(size: number) {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function chooseFiles() {
  inputRef.value?.click()
}

async function uploadFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  if (!files.length) return
  if (props.modelValue.length + files.length > 20) {
    ElMessage.warning('单次审批最多上传 20 个附件')
    return
  }
  uploading.value = true
  const next = [...props.modelValue]
  try {
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        ElMessage.warning(`附件「${file.name}」超过 20MB`)
        continue
      }
      const { data } = await attachmentApi.upload(file)
      next.push(data)
      emit('update:modelValue', [...next])
    }
  } catch (error) {
    emit('update:modelValue', [...next])
    ElMessage.error(extractErrorMessage(error))
  } finally {
    uploading.value = false
  }
}

async function removeFile(file: AttachmentVO) {
  try {
    await attachmentApi.remove(file.id)
    emit(
      'update:modelValue',
      props.modelValue.filter((item) => item.id !== file.id),
    )
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function downloadFile(file: AttachmentVO) {
  try {
    await attachmentApi.download(file.id, file.name)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}
</script>

<template>
  <div class="space-y-2">
    <div v-if="!readonly" class="flex items-center gap-2">
      <input
        ref="inputRef"
        type="file"
        multiple
        class="hidden"
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
        @change="uploadFiles"
      />
      <button
        type="button"
        class="rounded border border-[var(--el-border-color)] px-3 py-1.5 text-sm disabled:opacity-50"
        :disabled="uploading"
        @click="chooseFiles"
      >
        {{ uploading ? '上传中...' : '上传附件' }}
      </button>
      <span class="text-xs text-[var(--el-text-color-secondary)]">单文件 ≤20MB</span>
    </div>

    <div v-if="modelValue.length" class="space-y-1">
      <div
        v-for="file in modelValue"
        :key="file.id"
        class="flex items-center justify-between gap-3 rounded bg-[var(--el-fill-color-light)] px-3 py-2"
      >
        <button type="button" class="min-w-0 text-left" @click="downloadFile(file)">
          <span class="block truncate text-sm text-[var(--el-color-primary)]">{{ file.name }}</span>
          <span class="text-xs text-[var(--el-text-color-secondary)]">{{ formatSize(file.size) }}</span>
        </button>
        <button
          v-if="!readonly"
          type="button"
          class="shrink-0 text-xs text-[var(--el-color-danger)]"
          @click="removeFile(file)"
        >
          删除
        </button>
      </div>
    </div>
  </div>
</template>
