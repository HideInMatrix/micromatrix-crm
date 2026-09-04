<script setup lang="ts">
import { FOLLOW_UP_TYPES, type FollowUpVO } from '@micromatrix/shared'
import { showFailToast, showSuccessToast } from 'vant'
import { reactive, ref, watch } from 'vue'
import { createFollowUp, listFollowUps } from '@/api/mobile'
import { extractErrorMessage } from '@/api/http'

const props = defineProps<{
  targetType: 'lead' | 'customer'
  targetId: string | null
  targetName?: string
}>()

const show = defineModel<boolean>({ required: true })
const emit = defineEmits<{ followed: [] }>()

const records = ref<FollowUpVO[]>([])
const loading = ref(false)
const saving = ref(false)
const form = reactive({ type: '电话', content: '' })

watch(show, (open) => {
  if (open && props.targetId) load()
})

async function load() {
  if (!props.targetId) return
  loading.value = true
  try {
    const { data } = await listFollowUps(props.targetType, props.targetId)
    records.value = data
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!props.targetId) return
  if (!form.content.trim()) {
    showFailToast('请填写跟进内容')
    return
  }
  saving.value = true
  try {
    await createFollowUp({
      targetType: props.targetType,
      targetId: props.targetId,
      type: form.type,
      content: form.content.trim(),
    })
    form.content = ''
    showSuccessToast('已记录')
    load()
    emit('followed')
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ height: '75%' }">
    <div class="p-4 h-full flex flex-col">
      <div class="text-center font-medium mb-3">跟进 · {{ props.targetName ?? '' }}</div>

      <div class="mb-3">
        <div class="flex gap-2 mb-2 flex-wrap">
          <van-tag
            v-for="t in FOLLOW_UP_TYPES"
            :key="t"
            :type="form.type === t ? 'primary' : 'default'"
            size="medium"
            @click="form.type = t"
          >
            {{ t }}
          </van-tag>
        </div>
        <van-field
          v-model="form.content"
          type="textarea"
          rows="2"
          autosize
          placeholder="跟进内容..."
          class="!bg-[var(--text-n9)] rounded-[var(--border-radius-small)]"
        />
        <van-button
          type="primary"
          size="small"
          block
          class="mt-2"
          :loading="saving"
          @click="submit"
        >
          记录跟进
        </van-button>
      </div>

      <div class="flex-1 overflow-y-auto">
        <div v-if="loading" class="flex justify-center py-4">
          <van-loading size="20" />
        </div>
        <van-empty v-else-if="records.length === 0" description="暂无跟进记录" image-size="60" />
        <div
          v-for="record in records"
          :key="record.id"
          class="py-2.5 border-b border-[var(--text-n8)] last:border-b-0"
        >
          <div class="text-sm">
            <van-tag size="medium" class="mr-1">{{ record.type }}</van-tag>
            {{ record.content }}
          </div>
          <div class="text-xs text-gray-400 mt-1">
            {{ new Date(record.createdAt).toLocaleString() }} · {{ record.ownerName }}
          </div>
        </div>
      </div>
    </div>
  </van-popup>
</template>
