import type { DataSourceType } from '@micromatrix/shared'
import { computed, ref } from 'vue'
import { showFailToast } from 'vant'
import { dataSourceApi } from '@/api/data-source'
import { extractErrorMessage } from '@/api/http'
import { deptApi, memberApi } from '@/api/system'
import { useSearchSelectStore } from '@/stores/search-select'
import {
  filterSearchSelectOptions,
  flattenDepartmentOptions,
  type MobileSearchSelectOption,
} from '@/utils/search-select'

const PAGE_SIZE = 30

export function useMobileSearchSelect() {
  const store = useSearchSelectStore()
  const keyword = ref('')
  const items = ref<MobileSearchSelectOption[]>([])
  const selectedIds = ref<string[]>([...(store.context?.selectedIds ?? [])])
  const loading = ref(false)
  const finished = ref(false)
  const page = ref(1)
  const departmentOptions = ref<MobileSearchSelectOption[] | null>(null)
  let generation = 0

  const field = computed(() => store.context?.field ?? null)
  const multiple = computed(() => field.value?.type === 'data_source_multiple')
  const title = computed(() => '选择' + (field.value?.label ?? '内容'))
  const placeholder = computed(() => '搜索' + (field.value?.label ?? ''))

  async function loadDepartments() {
    if (departmentOptions.value) return departmentOptions.value
    const { data } = await deptApi.tree()
    departmentOptions.value = flattenDepartmentOptions(data)
    return departmentOptions.value
  }

  async function loadMore() {
    if (finished.value || !field.value) return
    const requestGeneration = generation
    loading.value = true
    try {
      if (field.value.type === 'dept') {
        const all = await loadDepartments()
        if (requestGeneration !== generation) return
        items.value = filterSearchSelectOptions(all, keyword.value)
        finished.value = true
        return
      }

      if (field.value.type === 'member') {
        const { data } = await memberApi.list({
          page: page.value,
          pageSize: PAGE_SIZE,
          keyword: keyword.value.trim() || undefined,
          status: 'ACTIVE',
        })
        if (requestGeneration !== generation) return
        const existing = new Set(items.value.map((item) => item.id))
        items.value.push(
          ...data.items
            .filter((item) => !existing.has(item.id))
            .map((item) => ({
              id: item.id,
              name: item.name,
              description: [item.deptName, item.position].filter(Boolean).join(' · ') || undefined,
            })),
        )
        page.value += 1
        finished.value = items.value.length >= data.total || data.items.length < PAGE_SIZE
        return
      }

      if (['data_source', 'data_source_multiple'].includes(field.value.type)) {
        const sourceType = field.value.config?.dataSourceType as DataSourceType | undefined
        if (!sourceType) {
          finished.value = true
          return
        }
        const result = await dataSourceApi.page(sourceType, {
          current: page.value,
          pageSize: PAGE_SIZE,
          keyword: keyword.value.trim() || undefined,
        })
        if (requestGeneration !== generation) return
        const existing = new Set(items.value.map((item) => item.id))
        items.value.push(...result.list.filter((item) => !existing.has(item.id)))
        page.value += 1
        finished.value = items.value.length >= result.total || result.list.length < PAGE_SIZE
        return
      }

      finished.value = true
    } catch (error) {
      if (requestGeneration === generation) {
        finished.value = true
        showFailToast(extractErrorMessage(error))
      }
    } finally {
      if (requestGeneration === generation) loading.value = false
    }
  }

  function search() {
    generation += 1
    page.value = 1
    items.value = []
    finished.value = false
    loading.value = false
    void loadMore()
  }

  function select(option: MobileSearchSelectOption) {
    if (!multiple.value) {
      selectedIds.value = [option.id]
      return true
    }
    const ids = new Set(selectedIds.value)
    if (ids.has(option.id)) ids.delete(option.id)
    else ids.add(option.id)
    selectedIds.value = [...ids]
    return false
  }

  function confirm() {
    store.confirm(selectedIds.value)
  }

  function cancel() {
    store.cancel()
  }

  return {
    store,
    field,
    keyword,
    items,
    selectedIds,
    loading,
    finished,
    multiple,
    title,
    placeholder,
    loadMore,
    search,
    select,
    confirm,
    cancel,
  }
}

