<script setup lang="ts">
import { ElMessage } from 'element-plus'
import { ref, watch } from 'vue'
import type { MemberOption } from '@/api/system'

const props = withDefaults(
  defineProps<{
    members: MemberOption[]
    initialContent?: string
    initialMentionIds?: string[]
    contextLabel?: string
    submitText?: string
  }>(),
  {
    initialContent: '',
    initialMentionIds: () => [],
    contextLabel: '',
    submitText: '发送',
  },
)

const emit = defineEmits<{
  submit: [payload: { content: string; mentionedUserIds: string[] }]
  cancel: []
}>()

const content = ref('')
const mentionIds = ref<string[]>([])

watch(
  () => [props.initialContent, props.initialMentionIds] as const,
  ([initialContent, initialMentionIds]) => {
    content.value = initialContent
    mentionIds.value = [...initialMentionIds]
  },
  { immediate: true, deep: true },
)

function submit() {
  const text = content.value.trim()
  if (!text) {
    ElMessage.warning('请输入评论内容')
    return
  }
  // @成员仅作为提醒接收人保存，不拼接到评论正文中。
  const mentionedUserIds = [...mentionIds.value]
  emit('submit', { content: text, mentionedUserIds })
}
</script>

<template>
  <div
    class="rounded border border-[var(--el-border-color)] p-3"
    data-testid="follow-comment-editor"
  >
    <div v-if="contextLabel" class="mb-2 text-xs text-[var(--el-text-color-secondary)]">
      {{ contextLabel }}
    </div>
    <el-input
      v-model="content"
      type="textarea"
      :rows="3"
      maxlength="300"
      show-word-limit
      placeholder="输入评论内容"
      data-testid="follow-comment-content"
    />
    <div class="mt-2 flex items-center gap-2">
      <el-select
        v-model="mentionIds"
        multiple
        filterable
        clearable
        collapse-tags
        :max-collapse-tags="2"
        :multiple-limit="100"
        class="min-w-0 flex-1"
        placeholder="@成员，可选"
        data-testid="follow-comment-mentions"
      >
        <el-option
          v-for="member in members"
          :key="member.id"
          :label="member.name"
          :value="member.id"
        />
      </el-select>
      <el-button v-if="contextLabel" @click="emit('cancel')">取消</el-button>
      <el-button type="primary" data-testid="follow-comment-submit" @click="submit">
        {{ submitText }}
      </el-button>
    </div>
  </div>
</template>
