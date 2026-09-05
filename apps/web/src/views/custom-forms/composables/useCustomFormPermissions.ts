import type { CustomFormRoleKey } from '@micromatrix/shared'
import { ref } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'

export function useCustomFormPermissions(onSaved: (formId: string) => Promise<void>) {
  const loading = ref(false)
  const saving = ref(false)
  const admins = ref<string[]>([])
  const roles = ref<Record<CustomFormRoleKey, string[]>>({
    MANAGE_ALL: [],
    VIEW_ALL: [],
    MANAGE_OWN: [],
  })

  async function load(formId: string) {
    loading.value = true
    try {
      const [adminRes, roleRes] = await Promise.all([
        customFormApi.admins(formId),
        customFormApi.roles(formId),
      ])
      admins.value = adminRes.data.map((item) => item.id)
      const next: Record<CustomFormRoleKey, string[]> = {
        MANAGE_ALL: [],
        VIEW_ALL: [],
        MANAGE_OWN: [],
      }
      for (const role of roleRes.data) next[role.internalKey] = role.users.map((item) => item.id)
      roles.value = next
      return true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return false
    } finally {
      loading.value = false
    }
  }

  async function save(formId?: string) {
    if (!formId) return
    if (!admins.value.length) {
      ElMessage.warning('至少保留一名表单管理员')
      return
    }
    saving.value = true
    try {
      await customFormApi.setAdmins(formId, admins.value)
      await Promise.all(
        (Object.entries(roles.value) as Array<[CustomFormRoleKey, string[]]>).map(
          ([roleKey, userIds]) => customFormApi.setRoleUsers(formId, roleKey, userIds),
        ),
      )
      ElMessage.success('成员权限已保存')
      await onSaved(formId)
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      saving.value = false
    }
  }

  return { loading, saving, admins, roles, load, save }
}
