import type { CustomFormListVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

export function useCustomForms() {
  const auth = useAuthStore()
  const loading = ref(false)
  const formList = ref<CustomFormListVO[]>([])
  const keyword = ref('')
  const activeFormId = ref('')

  const filteredForms = computed(() => {
    const q = keyword.value.trim().toLocaleLowerCase()
    if (!q) return formList.value
    return formList.value.filter((item) => item.name.toLocaleLowerCase().includes(q))
  })

  const activeForm = computed(() => formList.value.find((item) => item.id === activeFormId.value))

  const canAddForm = computed(() => {
    const permissions = auth.user?.permissions ?? []
    return permissions.includes('*') || permissions.includes('CUSTOM_FORM:ADD')
  })

  async function loadForms(preferredId?: string) {
    loading.value = true
    try {
      const { data } = await customFormApi.list()
      formList.value = data
      const candidate = preferredId || activeFormId.value
      activeFormId.value = data.some((item) => item.id === candidate)
        ? candidate
        : (data[0]?.id ?? '')
      return activeFormId.value
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return ''
    } finally {
      loading.value = false
    }
  }

  function selectForm(id: string) {
    if (activeFormId.value === id) return false
    activeFormId.value = id
    return true
  }

  async function createForm() {
    const result = await ElMessageBox.prompt('请输入自定义表单名称', '新建自定义表单', {
      inputPlaceholder: '例如：渠道拜访记录',
      inputValidator: (value) => Boolean(value?.trim()) || '表单名称不能为空',
    }).catch(() => null)
    if (!result) return undefined
    try {
      const { data } = await customFormApi.create({ name: result.value.trim(), enable: true })
      ElMessage.success('自定义表单已创建')
      await loadForms(data.id)
      return data.id
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return undefined
    }
  }

  async function toggleForm(row: CustomFormListVO) {
    try {
      await customFormApi.status(row.id, !row.enable)
      ElMessage.success(row.enable ? '表单已停用' : '表单已启用')
      await loadForms(row.id)
      return true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return false
    }
  }

  async function removeForm(row: CustomFormListVO) {
    const confirmed = await ElMessageBox.confirm(
      `删除「${row.name}」会同时删除该表单全部数据、字段和成员权限，且无法恢复。`,
      '删除自定义表单',
      { type: 'warning', confirmButtonText: '删除' },
    ).catch(() => false)
    if (!confirmed) return false
    try {
      await customFormApi.remove(row.id)
      ElMessage.success('自定义表单已删除')
      if (activeFormId.value === row.id) activeFormId.value = ''
      await loadForms()
      return true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return false
    }
  }

  return {
    auth,
    loading,
    formList,
    keyword,
    activeFormId,
    filteredForms,
    activeForm,
    canAddForm,
    loadForms,
    selectForm,
    createForm,
    toggleForm,
    removeForm,
  }
}
