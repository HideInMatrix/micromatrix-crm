<script setup lang="ts">
import type { FollowCommentVO } from '@micromatrix/shared'

defineProps<{ comment: FollowCommentVO }>()
const emit = defineEmits<{
  reply: [comment: FollowCommentVO]
  edit: [comment: FollowCommentVO]
  remove: [comment: FollowCommentVO]
}>()

function formatTime(value: string) {
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div
    class="rounded border border-[var(--el-border-color-lighter)] p-3"
    data-testid="follow-comment-item"
    :data-comment-id="comment.id"
  >
    <div class="flex items-start gap-3">
      <el-avatar :src="comment.createdByAvatar || undefined" :size="30">
        {{ comment.createdByName.slice(0, 1) }}
      </el-avatar>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <div class="text-sm font-medium">{{ comment.createdByName }}</div>
          <div class="text-xs text-[var(--el-text-color-secondary)]">
            {{ formatTime(comment.createdAt) }}
          </div>
        </div>
        <div class="mt-1 whitespace-pre-wrap break-words text-sm">{{ comment.content }}</div>
        <div v-if="comment.mentionUsers.length" class="mt-1 flex flex-wrap gap-1">
          <el-tag v-for="member in comment.mentionUsers" :key="member.id" size="small" type="info"
            >@{{ member.name }}</el-tag
          >
        </div>
        <div class="mt-1 flex gap-1">
          <el-button
            data-testid="follow-comment-reply"
            link
            type="primary"
            @click="emit('reply', comment)"
            >回复</el-button
          >
          <el-button
            v-if="comment.editable"
            data-testid="follow-comment-edit"
            link
            type="primary"
            @click="emit('edit', comment)"
            >编辑</el-button
          >
          <el-button
            v-if="comment.editable"
            data-testid="follow-comment-delete"
            link
            type="danger"
            @click="emit('remove', comment)"
            >删除</el-button
          >
        </div>
        <div
          v-if="comment.replies.length"
          class="mt-2 space-y-2 border-l border-[var(--el-border-color)] pl-3"
        >
          <div
            v-for="replyItem in comment.replies"
            :key="replyItem.id"
            class="rounded bg-[var(--el-fill-color-lighter)] p-2"
            data-testid="follow-comment-reply-item"
            :data-comment-id="replyItem.id"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="text-xs font-medium">
                {{ replyItem.createdByName }}
                <span
                  v-if="replyItem.replyToUserName"
                  class="font-normal text-[var(--el-text-color-secondary)]"
                  >回复 {{ replyItem.replyToUserName }}</span
                >
              </div>
              <div class="text-xs text-[var(--el-text-color-secondary)]">
                {{ formatTime(replyItem.createdAt) }}
              </div>
            </div>
            <div class="mt-1 whitespace-pre-wrap break-words text-sm">{{ replyItem.content }}</div>
            <div v-if="replyItem.mentionUsers.length" class="mt-1 flex flex-wrap gap-1">
              <el-tag
                v-for="member in replyItem.mentionUsers"
                :key="member.id"
                size="small"
                type="info"
                >@{{ member.name }}</el-tag
              >
            </div>
            <div class="mt-1 flex gap-1">
              <el-button link type="primary" @click="emit('reply', replyItem)">回复</el-button>
              <el-button
                v-if="replyItem.editable"
                link
                type="primary"
                @click="emit('edit', replyItem)"
                >编辑</el-button
              >
              <el-button
                v-if="replyItem.editable"
                link
                type="danger"
                @click="emit('remove', replyItem)"
                >删除</el-button
              >
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
