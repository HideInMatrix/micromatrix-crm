<script setup lang="ts">
import type { FollowUpVO } from '@micromatrix/shared'

defineProps<{
  records: FollowUpVO[]
  loading?: boolean
  allowCreate?: boolean
  allowManage?: boolean
}>()

const emit = defineEmits<{
  create: []
  edit: [record: FollowUpVO]
  remove: [record: FollowUpVO]
  comments: [record: FollowUpVO]
}>()
</script>

<template>
  <div class="min-h-40">
    <div v-if="allowCreate !== false" class="mb-3 flex justify-end">
      <el-button
        type="primary"
        size="small"
        data-testid="follow-record-create"
        @click="emit('create')"
      >
        记录跟进
      </el-button>
    </div>
    <el-timeline v-loading="loading">
      <el-empty v-if="records.length === 0" description="暂无跟进记录" :image-size="60" />
      <el-timeline-item
        v-for="record in records"
        :key="record.id"
        :timestamp="`${new Date(record.createdAt).toLocaleString()} · ${record.ownerName}`"
        placement="top"
      >
        <div
          class="rounded border border-[var(--el-border-color-lighter)] p-3"
          data-testid="follow-record-item"
          :data-record-id="record.id"
        >
          <div class="flex items-start gap-2">
            <div class="min-w-0 flex-1 text-sm">
              <el-tag v-if="record.type" size="small" class="mr-1">{{ record.type }}</el-tag>
              <span class="whitespace-pre-wrap break-words">{{ record.content }}</span>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <el-button
                link
                type="primary"
                data-testid="follow-record-comments"
                @click="emit('comments', record)"
              >
                评论{{ record.commentCount ? ` ${record.commentCount}` : '' }}
              </el-button>
              <el-button
                v-if="allowManage !== false && record.canManage"
                link
                type="primary"
                data-testid="follow-record-edit"
                @click="emit('edit', record)"
              >
                编辑
              </el-button>
              <el-button
                v-if="allowManage !== false && record.canManage"
                link
                type="danger"
                data-testid="follow-record-delete"
                @click="emit('remove', record)"
              >
                删除
              </el-button>
            </div>
          </div>
          <div v-if="record.followedAt" class="mt-2 text-xs text-[var(--el-text-color-secondary)]">
            跟进时间：{{ new Date(record.followedAt).toLocaleString() }}
          </div>
          <slot name="comments" :record="record" />
        </div>
      </el-timeline-item>
    </el-timeline>
  </div>
</template>
