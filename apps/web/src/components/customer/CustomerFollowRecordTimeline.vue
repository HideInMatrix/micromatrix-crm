<script setup lang="ts">
import type { FollowUpVO } from '@micromatrix/shared'
import { MessageCircle, Pencil, Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  records: FollowUpVO[]
  loading?: boolean
  allowManage?: boolean
}>()

const emit = defineEmits<{
  edit: [record: FollowUpVO]
  remove: [record: FollowUpVO]
  comments: [record: FollowUpVO]
}>()

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
  <section v-loading="props.loading" class="min-h-[120px]">
    <h3
      class="m-0 mb-[13px] flex items-center gap-[6px] text-[14px] leading-none font-medium text-[#333333]"
    >
      <span
        aria-hidden="true"
        class="h-4 w-[3px] shrink-0 rounded-[4px] bg-[var(--el-color-primary)]"
      />
      跟进记录
    </h3>

    <ol
      v-if="props.records.length"
      class="m-0 ml-[7px] list-none border-l-2 border-[#D9D9D9] p-0 pl-[28px]"
    >
      <li
        v-for="(record, index) in props.records"
        :key="record.id"
        class="group relative pb-[48px] last:pb-0"
        data-testid="follow-record-item"
        :data-record-id="record.id"
      >
        <span
          aria-hidden="true"
          class="absolute top-[5px] -left-[36px] h-[12px] w-[12px] rounded-full"
          :class="
            index === 0
              ? 'bg-[var(--el-color-primary)] ring-[4px] ring-[var(--el-color-primary-light-9)]'
              : 'bg-[#A9A9A9]'
          "
        />
        <time class="block text-[14px] leading-none text-[#999999]" :datetime="record.createdAt">
          {{ formatDate(record.createdAt) }}
        </time>
        <div
          class="mt-[12px] whitespace-pre-wrap break-words text-[14px] leading-none text-[#333333]"
        >
          {{ record.content }}
        </div>
        <span
          class="mt-[8px] inline-flex h-[24px] max-w-full items-center rounded-[4px] bg-[#F5F7FA] px-[10px] text-[12px] leading-none text-[#999999]"
        >
          操作人：{{ record.ownerName || '-' }}
        </span>
        <div
          class="mt-2 flex flex-wrap items-center gap-3 text-[var(--el-color-primary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100"
        >
          <button
            type="button"
            class="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-[var(--el-color-primary)]"
            data-testid="follow-record-comments"
            @click="emit('comments', record)"
          >
            <MessageCircle :size="13" />
            评论{{ record.commentCount ? ` ${record.commentCount}` : '' }}
          </button>
          <template v-if="allowManage !== false && record.canManage">
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-[var(--el-color-primary)]"
              data-testid="follow-record-edit"
              @click="emit('edit', record)"
            >
              <Pencil :size="13" />编辑
            </button>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] text-[#F56C6C]"
              data-testid="follow-record-delete"
              @click="emit('remove', record)"
            >
              <Trash2 :size="13" />删除
            </button>
          </template>
        </div>
        <slot name="comments" :record="record" />
      </li>
    </ol>

    <el-empty v-else-if="!props.loading" description="暂无跟进记录" :image-size="60" />
  </section>
</template>
