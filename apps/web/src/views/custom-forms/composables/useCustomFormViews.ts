import type { CustomFormDataPageVO, FilterCondition } from '@micromatrix/shared'
import { computed, ref, type Ref } from 'vue'

export function useCustomFormViews(
  dataPage: Ref<CustomFormDataPageVO>,
  activeFormId: Ref<string>,
  reload: (reset?: boolean) => Promise<void>,
) {
  const advancedFilters = ref<FilterCondition[]>([])
  const activeViewId = ref<string>()
  const visibleColumnKeys = ref<string[]>([])

  const displayFields = computed(() =>
    dataPage.value.fields.filter((field) => field.showInList && field.type !== 'attachment'),
  )
  const filterableFields = computed(() =>
    dataPage.value.fields.filter(
      (field) => !field.hidden && !['formula', 'picture', 'attachment'].includes(field.type),
    ),
  )
  const defaultColumnKeys = computed(() => displayFields.value.map((field) => field.key))
  const visibleDisplayFields = computed(() => {
    if (!visibleColumnKeys.value.length) return displayFields.value
    const visible = new Set(visibleColumnKeys.value)
    return dataPage.value.fields.filter(
      (field) => !field.hidden && field.type !== 'attachment' && visible.has(field.key),
    )
  })
  const savedViewModule = computed(() =>
    activeFormId.value ? `customForm:${activeFormId.value}` : '',
  )
  const savedViewFields = computed(() =>
    dataPage.value.fields.filter((field) => field.type !== 'attachment'),
  )
  const customDataFields = computed(() => dataPage.value.fields.filter((field) => !field.system))
  const batchEditableFields = computed(() =>
    dataPage.value.fields.filter(
      (field) => !['attachment', 'picture', 'formula'].includes(field.type),
    ),
  )
  const exportFields = computed(() =>
    dataPage.value.fields.filter(
      (field) => !['picture', 'formula', 'attachment'].includes(field.type),
    ),
  )
  const exportDisplayFields = computed(() => [
    ...dataPage.value.fields
      .filter((field) => !field.hidden && field.type === 'formula')
      .map((field) => ({ key: field.key, label: field.label })),
    { key: 'createTime', label: '创建时间' },
    { key: 'updateTime', label: '更新时间' },
    { key: 'createUser', label: '创建人' },
    { key: 'updateUser', label: '更新人' },
  ])

  function reset() {
    advancedFilters.value = []
    activeViewId.value = undefined
    visibleColumnKeys.value = []
  }

  function handleAdvancedFilter() {
    void reload(true)
  }

  function handleSavedViewChange(viewId: string | undefined) {
    activeViewId.value = viewId
    void reload(true)
  }

  function clearAdvancedFilters() {
    advancedFilters.value = []
  }

  function handleColumnsChange(keys: string[]) {
    visibleColumnKeys.value = keys
  }

  return {
    advancedFilters,
    activeViewId,
    visibleColumnKeys,
    displayFields,
    filterableFields,
    defaultColumnKeys,
    visibleDisplayFields,
    savedViewModule,
    savedViewFields,
    customDataFields,
    batchEditableFields,
    exportFields,
    exportDisplayFields,
    reset,
    handleAdvancedFilter,
    handleSavedViewChange,
    clearAdvancedFilters,
    handleColumnsChange,
  }
}
