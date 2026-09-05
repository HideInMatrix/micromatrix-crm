import type {
  CustomFormDataDetailVO,
  CustomFormDataPageVO,
  CustomFormDataVO,
  FilterCondition,
} from '@micromatrix/shared'
import { computed, reactive, ref, type Ref } from 'vue'
import { customFormApi } from '@/api/custom-form'
import { extractErrorMessage } from '@/api/http'
import type { MemberOption } from '@/api/system'

const EMPTY_PAGE: CustomFormDataPageVO = {
  list: [],
  total: 0,
  current: 1,
  pageSize: 20,
  fields: [],
  access: {
    isAdmin: false,
    canViewAll: false,
    canManageAll: false,
    canManageOwn: false,
    canCreate: false,
  },
}

export function useCustomFormData(
  activeFormId: Ref<string>,
  currentUserId: Readonly<Ref<string | undefined>>,
  members: Ref<MemberOption[]>,
) {
  const loading = ref(false)
  const page = ref<CustomFormDataPageVO>({ ...EMPTY_PAGE, access: { ...EMPTY_PAGE.access } })
  const keyword = ref('')
  const selectedIds = ref<string[]>([])

  const drawerVisible = ref(false)
  const saving = ref(false)
  const editingData = ref<CustomFormDataDetailVO | null>(null)
  const form = reactive({ name: '', ownerId: '' })
  const values = ref<Record<string, unknown>>({})

  const ownerOptions = computed(() => {
    if (page.value.access.canManageAll) return members.value
    return currentUserId.value
      ? members.value.filter((item) => item.id === currentUserId.value)
      : []
  })

  function resetPage() {
    page.value = { ...EMPTY_PAGE, access: { ...EMPTY_PAGE.access } }
    selectedIds.value = []
  }

  async function loadData(reset = false, filters: FilterCondition[] = [], viewId?: string) {
    if (!activeFormId.value) {
      resetPage()
      return
    }
    if (reset) page.value.current = 1
    loading.value = true
    try {
      const { data } = await customFormApi.dataPage(activeFormId.value, {
        current: page.value.current,
        pageSize: page.value.pageSize,
        keyword: keyword.value.trim() || undefined,
        filters: filters.length ? filters : undefined,
        viewId,
      })
      page.value = data
      selectedIds.value = []
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    } finally {
      loading.value = false
    }
  }

  function handleSelectionChange(rows: CustomFormDataVO[]) {
    selectedIds.value = rows.map((row) => row.id)
  }

  function openCreate(onReset?: () => void) {
    editingData.value = null
    form.name = ''
    form.ownerId = currentUserId.value ?? ''
    values.value = {}
    onReset?.()
    drawerVisible.value = true
  }

  async function openEdit(rowValue: unknown, onLoaded?: (data: CustomFormDataDetailVO) => void) {
    const row = rowValue as CustomFormDataVO
    if (!activeFormId.value) return
    try {
      const { data } = await customFormApi.dataDetail(activeFormId.value, row.id)
      editingData.value = data
      form.name = data.name
      form.ownerId = data.ownerId
      values.value = { ...data.values }
      onLoaded?.(data)
      drawerVisible.value = true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
    }
  }

  async function save(onCommitted?: () => void, afterSave?: () => Promise<void>) {
    const formId = activeFormId.value
    if (!formId) return false
    saving.value = true
    try {
      const payload = {
        name: form.name.trim(),
        ownerId: form.ownerId,
        values: values.value,
      }
      if (editingData.value) {
        await customFormApi.updateData(formId, editingData.value.id, payload)
      } else {
        await customFormApi.createData(formId, payload)
      }
      onCommitted?.()
      drawerVisible.value = false
      ElMessage.success(editingData.value ? '数据已更新' : '数据已创建')
      await afterSave?.()
      return true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return false
    } finally {
      saving.value = false
    }
  }

  async function remove(rowValue: unknown, afterRemove?: () => Promise<void>) {
    const row = rowValue as CustomFormDataVO
    if (!activeFormId.value) return false
    const confirmed = await ElMessageBox.confirm(`确定删除「${row.name}」？`, '删除数据', {
      type: 'warning',
    }).catch(() => false)
    if (!confirmed) return false
    try {
      await customFormApi.removeData(activeFormId.value, row.id)
      ElMessage.success('数据已删除')
      await afterRemove?.()
      return true
    } catch (error) {
      ElMessage.error(extractErrorMessage(error))
      return false
    }
  }

  return {
    loading,
    page,
    keyword,
    selectedIds,
    drawerVisible,
    saving,
    editingData,
    form,
    values,
    ownerOptions,
    resetPage,
    loadData,
    handleSelectionChange,
    openCreate,
    openEdit,
    save,
    remove,
  }
}
