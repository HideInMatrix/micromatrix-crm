import type { CustomFormListVO } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'
import { useAuthStore } from '@/stores/auth'

export function useCustomForms(referenceMode = false) {
  const auth = useAuthStore()
  const loading = ref(false)
  const formList = ref<CustomFormListVO[]>([])
  const keyword = ref('')
  const activeFormId = ref('')

  const filteredForms = computed(() => {
    const q = keyword.value.trim().toLocaleLowerCase()
    const entries = formList.value.filter(
      (item) => Boolean(item.referenceDataSource) === referenceMode,
    )
    if (!q) return entries
    return entries.filter((item) => item.name.toLocaleLowerCase().includes(q))
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
      const allowed = data.filter((item) => Boolean(item.referenceDataSource) === referenceMode)
      activeFormId.value = allowed.some((item) => item.id === candidate)
        ? candidate
        : (allowed[0]?.id ?? '')
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
    const result = await ElMessageBox.prompt(
      referenceMode ? '请输入数据源名称' : '请输入自定义表单名称',
      referenceMode ? '新建数据源' : '新建自定义表单',
      {
        inputPlaceholder: referenceMode ? '例如：学校资料库' : '例如：渠道拜访记录',
        inputValidator: (value) => Boolean(value?.trim()) || '表单名称不能为空',
      },
    ).catch(() => null)
    if (!result) return undefined
    try {
      const { data } = await customFormApi.create({
        name: result.value.trim(),
        enable: true,
        ...(referenceMode ? { formProp: { referenceDataSource: true } } : {}),
      })
      const selectedId = await loadForms(data.id)
      if (selectedId !== data.id) {
        ElMessage.warning(
          referenceMode
            ? '数据源已保存，但列表未返回该数据源，请检查 API 服务是否已更新并刷新页面'
            : '表单已保存，但列表未返回新建表单，请检查读取权限并刷新页面',
        )
        return undefined
      }
      ElMessage.success(referenceMode ? '数据源已创建' : '自定义表单已创建')
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
      referenceMode
        ? `确认删除数据源「${row.name}」？存在资料记录的数据源不能直接删除，请使用停用。`
        : `删除「${row.name}」会同时删除该表单全部数据、字段和成员权限，且无法恢复。`,
      referenceMode ? '删除数据源' : '删除自定义表单',
      { type: 'warning', confirmButtonText: '删除' },
    ).catch(() => false)
    if (!confirmed) return false
    try {
      await customFormApi.remove(row.id)
      ElMessage.success(referenceMode ? '数据源已删除' : '自定义表单已删除')
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
