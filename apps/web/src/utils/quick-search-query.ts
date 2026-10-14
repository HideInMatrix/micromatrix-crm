import type {
  FieldVO,
  FilterCondition,
  ModuleQuickSearchConfig,
  QuickSearchQueryGroup,
} from '@micromatrix/shared'

/** 每个输入框使用同一关键字；多字段在组内 OR，不同输入框/预设之间 AND。 */
export function buildQuickSearchPayload(
  config: ModuleQuickSearchConfig,
  fields: FieldVO[],
  values: Record<string, string>,
): { filters: FilterCondition[]; quickGroups: QuickSearchQueryGroup[] } {
  const fieldMap = new Map(
    fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
  )
  const filters: FilterCondition[] = []
  const quickGroups: QuickSearchQueryGroup[] = []
  for (const item of config.items) {
    const raw = (values[item.id] ?? '').trim()
    if (!raw) continue
    if (item.kind === 'preset_select') {
      const selected = item.options?.find((option) => option.id === raw)
      if (selected?.conditions.length) {
        quickGroups.push({
          mode: selected.searchMode,
          conditions: selected.conditions.map((condition) => ({ ...condition })),
        })
      }
      continue
    }
    if (item.kind !== 'field' || !item.fieldKey) continue
    const field = fieldMap.get(item.fieldKey)
    if (!field) continue
    const value = ['number', 'currency', 'percent'].includes(field.type) ? Number(raw) : raw
    if (typeof value === 'number' && !Number.isFinite(value)) continue
    const condition: FilterCondition = { key: field.key, op: item.operator ?? 'eq', value }
    const extras = (item.fieldKeys ?? [])
      .filter((key) => key !== field.key && fieldMap.has(key))
      .map((key): FilterCondition => ({ key, op: condition.op, value: raw }))
    if (extras.length) quickGroups.push({ mode: 'OR', conditions: [condition, ...extras] })
    else filters.push(condition)
  }
  return { filters, quickGroups }
}
