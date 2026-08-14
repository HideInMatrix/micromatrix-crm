<script setup lang="ts">
import { FOLLOW_UP_TYPES, type FollowUpVO } from '@micromatrix/shared'
import type { UploadFile, UploadRawFile } from 'element-plus'
import { reactive, ref, watch } from 'vue'
import { attachmentApi } from '@/api/attachments'
import { extractErrorMessage } from '@/api/http'
import { followUpApi } from '@/api/sales'

const props = defineProps<{
  targetType: 'lead' | 'customer' | 'opportunity' | 'contract'
  targetId: string | null
  targetName?: string
}>()

const visible = defineModel<boolean>({ required: true })
const emit = defineEmits<{ followed: [] }>()

const records = ref<FollowUpVO[]>([])
const loading = ref(false)
const saving = ref(false)
const form = reactive({ type: '电话', content: '', nextFollowAt: '' })
const pendingFiles = ref<UploadRawFile[]>([])
const uploadRef = ref<{ clearFiles: () => void } | null>(null)

watch(visible, (open) => {
  if (open && props.targetId) {
    pendingFiles.value = []
    loadRecords()
  }
})

async function loadRecords() {
  if (!props.targetId) return
  loading.value = true
  try {
    const { data } = await followUpApi.list(props.targetType, props.targetId)
    records.value = data
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function handlePendingChange(_file: UploadFile, fileList: UploadFile[]) {
  pendingFiles.value = fileList.map((f) => f.raw).filter(Boolean) as UploadRawFile[]
}

async function handleSubmit() {
  if (!props.targetId) return
  if (!form.content.trim()) {
    ElMessage.warning('请填写跟进内容')
    return
  }
  saving.value = true
  try {
    const { data: created } = await followUpApi.create({
      targetType: props.targetType,
      targetId: props.targetId,
      type: form.type,
      content: form.content.trim(),
      nextFollowAt: form.nextFollowAt || undefined,
    })
    for (const file of pendingFiles.value) {
      await attachmentApi.upload(file, 'follow-up', created.id)
    }
    form.content = ''
    form.nextFollowAt = ''
    pendingFiles.value = []
    uploadRef.value?.clearFiles()
    ElMessage.success('跟进已记录')
    loadRecords()
    emit('followed')
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function handleDownload(id: string, name: string) {
  try {
    await attachmentApi.download(id, name)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}
</script>

<template>
  <el-drawer v-model="visible" :title="`跟进记录${targetName ? ` · ${targetName}` : ''}`" size="440px">
    <div class="mb-4 p-3 rounded bg-[var(--el-fill-color-light)]">
      <div class="flex gap-2 mb-2">
        <el-select v-model="form.type" class="!w-28">
          <el-option v-for="t in FOLLOW_UP_TYPES" :key="t" :label="t" :value="t" />
        </el-select>
        <el-date-picker
          v-model="form.nextFollowAt"
          type="datetime"
          placeholder="下次跟进时间（可选）"
          value-format="YYYY-MM-DDTHH:mm:ss.000[Z]"
          class="flex-1"
        />
      </div>
      <el-input v-model="form.content" type="textarea" :rows="3" placeholder="跟进内容..." />
      <el-upload
        ref="uploadRef"
        class="mt-2"
        :auto-upload="false"
        multiple
        :on-change="handlePendingChange"
        accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip"
      >
        <el-button size="small">添加附件</el-button>
      </el-upload>
      <div class="flex justify-end mt-2">
        <el-button type="primary" size="small" :loading="saving" @click="handleSubmit">
          记录跟进
        </el-button>
      </div>
    </div>

    <el-timeline v-loading="loading">
      <el-empty v-if="records.length === 0" description="暂无跟进记录" :image-size="60" />
      <el-timeline-item
        v-for="record in records"
        :key="record.id"
        :timestamp="`${new Date(record.createdAt).toLocaleString()} · ${record.ownerName}`"
        placement="top"
      >
        <div class="text-sm">
          <el-tag size="small" class="mr-1">{{ record.type }}</el-tag>
          {{ record.content }}
        </div>
        <div v-if="record.nextFollowAt" class="text-xs text-[var(--el-text-color-secondary)] mt-1">
          下次跟进：{{ new Date(record.nextFollowAt).toLocaleString() }}
        </div>
        <div v-if="record.attachments?.length" class="mt-1">
          <el-button
            v-for="file in record.attachments"
            :key="file.id"
            link
            type="primary"
            size="small"
            @click="handleDownload(file.id, file.name)"
          >
            {{ file.name }}
          </el-button>
        </div>
      </el-timeline-item>
    </el-timeline>
  </el-drawer>
</template>
