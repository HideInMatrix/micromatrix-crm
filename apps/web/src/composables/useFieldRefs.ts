import type { DepartmentVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { deptApi, memberApi, type MemberOption } from '@/api/system'

/** 动态表单/列表渲染所需的引用数据：成员选项与部门树 */
export function useFieldRefs() {
  const members = ref<MemberOption[]>([])
  const deptTree = ref<DepartmentVO[]>([])

  const memberMap = computed(() => new Map(members.value.map((m) => [m.id, m.name])))
  const deptMap = computed(() => {
    const map = new Map<string, string>()
    const walk = (nodes: DepartmentVO[]) => {
      for (const node of nodes) {
        map.set(node.id, node.name)
        if (node.children) walk(node.children)
      }
    }
    walk(deptTree.value)
    return map
  })

  async function load() {
    const [{ data: memberList }, { data: tree }] = await Promise.all([
      memberApi.options(),
      deptApi.tree(),
    ])
    members.value = memberList
    deptTree.value = tree
  }

  return { members, deptTree, memberMap, deptMap, load }
}

export type FieldRefs = ReturnType<typeof useFieldRefs>
