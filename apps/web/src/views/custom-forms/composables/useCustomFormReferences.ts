import { ref } from 'vue'
import { extractErrorMessage } from '@/api/http'
import { deptApi, memberApi, type MemberOption } from '@/api/system'

export function useCustomFormReferences() {
  const members = ref<MemberOption[]>([])
  const deptTree = ref<Awaited<ReturnType<typeof deptApi.tree>>['data']>([])

  async function load() {
    try {
      const [memberRes, deptRes] = await Promise.all([memberApi.options(), deptApi.tree()])
      members.value = memberRes.data
      deptTree.value = deptRes.data
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  return { members, deptTree, load }
}
