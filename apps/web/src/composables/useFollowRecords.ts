import type { FollowTargetType, FollowUpVO } from '@micromatrix/shared'
import { ElMessage } from 'element-plus'
import { ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { followUpApi } from '@/api/sales'

export function useFollowRecords(
  targetType: () => FollowTargetType,
  targetId: () => string | null,
) {
  const records = ref<FollowUpVO[]>([])
  const loading = ref(false)

  async function load() {
    const id = targetId()
    if (!id) {
      records.value = []
      return
    }
    loading.value = true
    try {
      const { data } = await followUpApi.page({
        page: 1,
        pageSize: 100,
        targetType: targetType(),
        targetId: id,
      })
      records.value = data.items
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      loading.value = false
    }
  }

  async function remove(record: FollowUpVO) {
    await followUpApi.remove(record.id)
    records.value = records.value.filter((item) => item.id !== record.id)
  }

  function patch(id: string, changes: Partial<FollowUpVO>) {
    records.value = records.value.map((item) => (item.id === id ? { ...item, ...changes } : item))
  }

  return { records, loading, load, remove, patch }
}
