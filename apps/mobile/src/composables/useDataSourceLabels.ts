import type { FieldVO, LeadVO } from '@micromatrix/shared'
import { resolveDataSourceDisplayMap } from '@micromatrix/frontend-shared/field-display'
import { ref, watch, type ComputedRef, type Ref } from 'vue'
import { dataSourceApi } from '@/api/data-source'

/** 随字段和记录变化异步解析数据源名称，丢弃过期请求结果。 */
export function useDataSourceLabels(
  fields: Ref<FieldVO[]> | ComputedRef<FieldVO[]>,
  rows: Ref<LeadVO[]> | ComputedRef<LeadVO[]>,
) {
  const dataSourceMap = ref(new Map<string, string>())
  let generation = 0
  watch(
    () => [fields.value, rows.value.map((row) => row.customData)],
    async () => {
      const current = ++generation
      const names = await resolveDataSourceDisplayMap(fields.value, rows.value, dataSourceApi.resolve)
      if (current === generation) dataSourceMap.value = names
    },
    { immediate: true },
  )
  return dataSourceMap
}
