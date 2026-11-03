<script setup lang="ts">
import type { FollowCommentVO } from '@micromatrix/shared'
import { ElMessage, ElMessageBox } from 'element-plus'
import { computed, nextTick, ref, watch } from 'vue'
import { extractErrorMessage } from '@/api/http'
import type { MemberOption } from '@/api/system'
import { useFollowComments, type FollowCommentResourceType } from '@/composables/useFollowComments'
import FollowCommentEditor from './FollowCommentEditor.vue'
import FollowCommentItem from './FollowCommentItem.vue'

const props = defineProps<{
  resourceType: FollowCommentResourceType
  resourceId: string
  members: MemberOption[]
  focusCommentId?: string | null
}>()

const emit = defineEmits<{
  countChanged: [count: number]
}>()

const pageSize = 10
const editorMode = ref<'create' | 'reply' | 'edit'>('create')
const editorRevision = ref(0)
const editorTarget = ref<FollowCommentVO | null>(null)
const commentListRef = ref<HTMLElement | null>(null)
const highlightedCommentId = ref<string | null>(null)
const {
  comments,
  loading,
  submitting,
  page,
  total,
  commentCount,
  load,
  reset,
  goToComment,
  add,
  update,
  remove: removeComment,
} = useFollowComments(
  () => props.resourceType,
  () => props.resourceId,
  pageSize,
)

const editorLabel = computed(() => {
  if (editorMode.value === 'edit') return '编辑评论'
  if (editorMode.value === 'reply' && editorTarget.value) {
    return `回复 ${editorTarget.value.createdByName}`
  }
  return ''
})

const editorContent = computed(() =>
  editorMode.value === 'edit' ? (editorTarget.value?.content ?? '') : '',
)
const editorMentions = computed(() =>
  editorMode.value === 'edit'
    ? (editorTarget.value?.mentionUsers.map((item) => item.id) ?? [])
    : [],
)

function resetEditor() {
  editorMode.value = 'create'
  editorTarget.value = null
}

async function focusComment(commentId: string) {
  const found = await goToComment(commentId)
  if (!found) {
    ElMessage.warning('这条评论可能已被删除，或当前账号无权查看')
    return
  }
  highlightedCommentId.value = commentId
  await nextTick()
  commentListRef.value
    ?.querySelector<HTMLElement>(`[data-comment-id="${commentId}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function reply(comment: FollowCommentVO) {
  editorMode.value = 'reply'
  editorTarget.value = comment
}

function edit(comment: FollowCommentVO) {
  editorMode.value = 'edit'
  editorTarget.value = comment
}

async function submit(payload: { content: string; mentionedUserIds: string[] }) {
  try {
    if (editorMode.value === 'edit' && editorTarget.value) {
      await update({
        id: editorTarget.value.id,
        content: payload.content,
        mentionedUserIds: payload.mentionedUserIds,
      })
    } else if (editorMode.value === 'reply' && editorTarget.value) {
      await add({
        parentId: editorTarget.value.parentId ?? editorTarget.value.id,
        replyToUserId: editorTarget.value.createdById,
        content: payload.content,
        mentionedUserIds: payload.mentionedUserIds,
      })
    } else {
      await add({
        content: payload.content,
        mentionedUserIds: payload.mentionedUserIds,
      })
    }
    resetEditor()
    editorRevision.value += 1
    emit('countChanged', commentCount.value)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

async function remove(comment: FollowCommentVO) {
  try {
    await ElMessageBox.confirm(
      comment.parentId ? '确认删除这条回复？' : '确认删除这条评论及其回复？',
      '删除评论',
      { type: 'warning' },
    )
    await removeComment(comment)
    resetEditor()
    emit('countChanged', commentCount.value)
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    ElMessage.error(extractErrorMessage(error))
  }
}

async function changePage() {
  try {
    await load()
    emit('countChanged', commentCount.value)
  } catch (error) {
    ElMessage.error(extractErrorMessage(error))
  }
}

watch(
  () => [props.resourceType, props.resourceId],
  async () => {
    resetEditor()
    highlightedCommentId.value = null
    try {
      await reset()
      emit('countChanged', commentCount.value)
      if (props.focusCommentId) await focusComment(props.focusCommentId)
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  },
  { immediate: true },
)

watch(
  () => props.focusCommentId,
  async (commentId) => {
    if (!commentId) return
    try {
      await focusComment(commentId)
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  },
)
</script>

<template>
  <div v-loading="loading || submitting" class="space-y-3">
    <FollowCommentEditor
      :key="`${editorMode}:${editorTarget?.id ?? 'new'}:${editorRevision}`"
      :members="members"
      :initial-content="editorContent"
      :initial-mention-ids="editorMentions"
      :context-label="editorLabel"
      :submit-text="editorMode === 'edit' ? '保存' : '发送'"
      @submit="submit"
      @cancel="resetEditor"
    />

    <el-empty v-if="!comments.length" description="暂无评论" :image-size="56" />
    <div ref="commentListRef" class="space-y-3">
      <FollowCommentItem
        v-for="comment in comments"
        :key="comment.id"
        :comment="comment"
        :highlighted-comment-id="highlightedCommentId"
        @reply="reply"
        @edit="edit"
        @remove="remove"
      />
    </div>

    <div v-if="total > pageSize" class="flex justify-end">
      <el-pagination
        v-model:current-page="page"
        background
        layout="prev, pager, next"
        :page-size="pageSize"
        :total="total"
        @current-change="changePage"
      />
    </div>
  </div>
</template>
