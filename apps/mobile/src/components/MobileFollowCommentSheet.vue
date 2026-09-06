<script setup lang="ts">
import type { FollowCommentVO } from '@micromatrix/shared'
import { computed, ref, watch } from 'vue'
import { showConfirmDialog, showFailToast, showSuccessToast } from 'vant'
import { extractErrorMessage } from '@/api/http'
import {
  followPlanCommentApi,
  followRecordCommentApi,
  type FollowCommentAddPayload,
  type FollowCommentUpdatePayload,
} from '@/api/sales'
import { useFieldRefs } from '@/composables/useFieldRefs'

const props = defineProps<{
  resourceType: 'record' | 'plan'
  resourceId: string
}>()

const show = defineModel<boolean>({ required: true })
const emit = defineEmits<{ countChanged: [count: number] }>()

const fieldRefs = useFieldRefs()
const comments = ref<FollowCommentVO[]>([])
const loading = ref(false)
const submitting = ref(false)
const page = ref(1)
const total = ref(0)
const commentCount = ref(0)
const editorMode = ref<'create' | 'reply' | 'edit'>('create')
const editorTarget = ref<FollowCommentVO | null>(null)
const content = ref('')
const mentionedUserIds = ref<string[]>([])

const currentApi = computed(() =>
  props.resourceType === 'plan' ? followPlanCommentApi : followRecordCommentApi,
)
const editorTitle = computed(() => {
  if (editorMode.value === 'edit') return '编辑评论'
  if (editorMode.value === 'reply' && editorTarget.value) {
    return `回复 ${editorTarget.value.createdByName}`
  }
  return '发表评论'
})
const hasMore = computed(() => comments.value.length < total.value)

function resetEditor() {
  editorMode.value = 'create'
  editorTarget.value = null
  content.value = ''
  mentionedUserIds.value = []
}

async function load(refresh = false) {
  if (!props.resourceId || loading.value) return
  loading.value = true
  try {
    const requestPage = refresh ? 1 : page.value
    const { data } = await currentApi.value.page(props.resourceId, requestPage, 10)
    comments.value = refresh ? data.items : [...comments.value, ...data.items]
    total.value = data.total
    commentCount.value = data.commentCount
    page.value = requestPage + 1
    emit('countChanged', data.commentCount)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function reply(comment: FollowCommentVO) {
  editorMode.value = 'reply'
  editorTarget.value = comment
  content.value = ''
  mentionedUserIds.value = []
}

function edit(comment: FollowCommentVO) {
  editorMode.value = 'edit'
  editorTarget.value = comment
  content.value = comment.content
  mentionedUserIds.value = comment.mentionUsers.map((item) => item.id)
}

async function submit() {
  const value = content.value.trim()
  if (!value) return void showFailToast('请输入评论内容')
  submitting.value = true
  try {
    if (editorMode.value === 'edit' && editorTarget.value) {
      const payload: FollowCommentUpdatePayload = {
        id: editorTarget.value.id,
        content: value,
        mentionedUserIds: mentionedUserIds.value,
      }
      await currentApi.value.update(payload)
      showSuccessToast('评论已更新')
    } else {
      const payload: FollowCommentAddPayload = {
        resourceId: props.resourceId,
        content: value,
        mentionedUserIds: mentionedUserIds.value,
      }
      if (editorMode.value === 'reply' && editorTarget.value) {
        payload.parentId = editorTarget.value.parentId ?? editorTarget.value.id
        payload.replyToUserId = editorTarget.value.createdById
      }
      await currentApi.value.add(payload)
      showSuccessToast(editorMode.value === 'reply' ? '回复已发送' : '评论已发送')
    }
    resetEditor()
    await load(true)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    submitting.value = false
  }
}

async function remove(comment: FollowCommentVO) {
  const confirmed = await showConfirmDialog({
    title: '删除评论',
    message: comment.parentId ? '确认删除这条回复？' : '确认删除这条评论及其回复？',
  })
    .then(() => true)
    .catch(() => false)
  if (!confirmed) return
  submitting.value = true
  try {
    await currentApi.value.remove(comment.id)
    showSuccessToast('评论已删除')
    resetEditor()
    await load(true)
  } catch (error) {
    showFailToast(extractErrorMessage(error))
  } finally {
    submitting.value = false
  }
}

watch(
  () => [show.value, props.resourceType, props.resourceId] as const,
  async ([visible]) => {
    if (!visible || !props.resourceId) return
    page.value = 1
    comments.value = []
    total.value = 0
    resetEditor()
    try {
      if (!fieldRefs.members.value.length) await fieldRefs.load()
    } catch (error) {
      showFailToast(extractErrorMessage(error))
    }
    await load(true)
  },
  { immediate: true },
)
</script>

<template>
  <van-popup v-model:show="show" position="bottom" round :style="{ height: '82%' }">
    <div class="flex h-full flex-col" data-testid="mobile-follow-comment-sheet">
      <div class="border-b border-gray-100 px-4 py-3 text-center font-medium">
        评论 {{ commentCount }}
      </div>
      <div class="flex-1 overflow-auto p-4">
        <van-loading v-if="loading && !comments.length" class="py-10 text-center" />
        <van-empty v-else-if="!comments.length" description="暂无评论" />
        <div v-else class="space-y-3">
          <div
            v-for="comment in comments"
            :key="comment.id"
            class="rounded-lg border border-gray-100 p-3"
            data-testid="mobile-follow-comment-item"
            :data-comment-id="comment.id"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm font-medium">{{ comment.createdByName || '成员' }}</span>
              <span class="text-xs text-gray-400">{{
                new Date(comment.createdAt).toLocaleString()
              }}</span>
            </div>
            <div class="mt-2 whitespace-pre-wrap break-words text-sm">{{ comment.content }}</div>
            <div v-if="comment.mentionUsers.length" class="mt-2 text-xs text-blue-500">
              @{{ comment.mentionUsers.map((item) => item.name).join(' @') }}
            </div>
            <div class="mt-2 flex justify-end gap-2">
              <van-button size="mini" plain @click="reply(comment)">回复</van-button>
              <van-button v-if="comment.editable" size="mini" plain @click="edit(comment)"
                >编辑</van-button
              >
              <van-button
                v-if="comment.editable"
                size="mini"
                plain
                type="danger"
                @click="remove(comment)"
                >删除</van-button
              >
            </div>
            <div
              v-if="comment.replies.length"
              class="mt-3 space-y-2 border-l-2 border-gray-100 pl-3"
            >
              <div v-for="replyItem in comment.replies" :key="replyItem.id" class="text-sm">
                <div class="flex items-center gap-1 text-xs text-gray-500">
                  <span>{{ replyItem.createdByName || '成员' }}</span>
                  <span v-if="replyItem.replyToUserName">回复 {{ replyItem.replyToUserName }}</span>
                </div>
                <div class="mt-1 whitespace-pre-wrap break-words">{{ replyItem.content }}</div>
                <div class="mt-1 flex justify-end gap-2">
                  <van-button size="mini" plain @click="reply(replyItem)">回复</van-button>
                  <van-button v-if="replyItem.editable" size="mini" plain @click="edit(replyItem)"
                    >编辑</van-button
                  >
                  <van-button
                    v-if="replyItem.editable"
                    size="mini"
                    plain
                    type="danger"
                    @click="remove(replyItem)"
                    >删除</van-button
                  >
                </div>
              </div>
            </div>
          </div>
          <van-button v-if="hasMore" block plain size="small" :loading="loading" @click="load()"
            >加载更多</van-button
          >
        </div>
      </div>
      <div class="border-t border-gray-100 p-4 space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium">{{ editorTitle }}</span>
          <van-button v-if="editorMode !== 'create'" size="mini" plain @click="resetEditor"
            >取消</van-button
          >
        </div>
        <van-field
          v-model="content"
          data-testid="mobile-follow-comment-content"
          type="textarea"
          rows="2"
          maxlength="300"
          show-word-limit
          placeholder="输入评论内容"
        />
        <van-field label="@成员">
          <template #input>
            <select
              v-model="mentionedUserIds"
              multiple
              class="min-h-10 w-full bg-transparent text-sm"
              data-testid="mobile-follow-comment-mentions"
            >
              <option v-for="member in fieldRefs.members.value" :key="member.id" :value="member.id">
                {{ member.name }}
              </option>
            </select>
          </template>
        </van-field>
        <van-button
          block
          type="primary"
          :loading="submitting"
          data-testid="mobile-follow-comment-submit"
          @click="submit"
        >
          {{ editorMode === 'edit' ? '保存' : '发送' }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>
