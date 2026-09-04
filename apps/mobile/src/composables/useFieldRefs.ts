import type { DepartmentVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { deptApi, memberApi, roleApi, type MemberOption, type RoleOption } from '@/api/system'

/** 动态表单/列表渲染所需的引用数据：成员选项与部门树 */
export function useFieldRefs() {
  const members = ref<MemberOption[]>([])
  const deptTree = ref<DepartmentVO[]>([])
  const roles = ref<RoleOption[]>([])

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
  const roleMap = computed(() => new Map(roles.value.map((role) => [role.id, role.name])))

  async function load() {
    const [{ data: memberList }, { data: tree }, { data: roleList }] = await Promise.all([
      memberApi.options(),
      deptApi.tree(),
      roleApi.options(),
    ])
    members.value = memberList
    deptTree.value = tree
    roles.value = roleList
  }

  return { members, deptTree, roles, memberMap, deptMap, roleMap, load }
}

export type FieldRefs = ReturnType<typeof useFieldRefs>
