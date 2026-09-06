import type { FollowCommentVO } from '@micromatrix/shared'
import { ref } from 'vue'
import {
  followPlanCommentApi,
  followRecordCommentApi,
  type FollowCommentAddPayload,
  type FollowCommentUpdatePayload,
} from '@/api/sales'

export type FollowCommentResourceType = 'record' | 'plan'

export function useFollowComments(
  resourceType: () => FollowCommentResourceType,
  resourceId: () => string,
  pageSize = 10,
) {
  const comments = ref<FollowCommentVO[]>([])
  const loading = ref(false)
  const submitting = ref(false)
  const page = ref(1)
  const total = ref(0)
  const commentCount = ref(0)

  function currentApi() {
    return resourceType() === 'plan' ? followPlanCommentApi : followRecordCommentApi
  }

  async function load() {
    const id = resourceId()
    if (!id) {
      comments.value = []
      total.value = 0
      commentCount.value = 0
      return
    }
    loading.value = true
    try {
      const { data } = await currentApi().page(id, page.value, pageSize)
      comments.value = data.items
      total.value = data.total
      commentCount.value = data.commentCount
    } finally {
      loading.value = false
    }
  }

  async function add(payload: Omit<FollowCommentAddPayload, 'resourceId'>) {
    submitting.value = true
    try {
      await currentApi().add({ resourceId: resourceId(), ...payload })
      await load()
    } finally {
      submitting.value = false
    }
  }

  async function update(payload: FollowCommentUpdatePayload) {
    submitting.value = true
    try {
      await currentApi().update(payload)
      await load()
    } finally {
      submitting.value = false
    }
  }

  async function remove(comment: FollowCommentVO) {
    submitting.value = true
    try {
      await currentApi().remove(comment.id)
      if (comments.value.length === 1 && page.value > 1) page.value -= 1
      await load()
    } finally {
      submitting.value = false
    }
  }

  async function reset() {
    page.value = 1
    await load()
  }

  return {
    comments,
    loading,
    submitting,
    page,
    pageSize,
    total,
    commentCount,
    load,
    reset,
    add,
    update,
    remove,
  }
}
