import { formatLocationValue, type FieldVO } from '@micromatrix/shared'

export interface DisplayContext {
  memberMap: Map<string, string>
  deptMap: Map<string, string>
  dataSourceMap?: Map<string, string>
}

export function dataSourceDisplayKey(sourceType: string, id: string): string {
  return `${sourceType}:${id}`
}

const SYSTEM_FIELD_ALIASES: Record<string, string[]> = {
  // 元数据沿用 Cordys 业务键，VO 则使用更明确的展示/关联字段名。
  owner: ['ownerId'],
  contact: ['contactName'],
}

/** 从行数据中取字段值（系统字段取实体列，自定义字段取 customData） */
export function fieldValue(field: FieldVO, row: Record<string, unknown>): unknown {
  if (!field.system || field.type === 'formula') {
    return (row.customData as Record<string, unknown> | undefined)?.[field.key]
  }
  const directValue = row[field.key]
  if (directValue !== undefined) return directValue
  for (const alias of SYSTEM_FIELD_ALIASES[field.key] ?? []) {
    const aliasedValue = row[alias]
    if (aliasedValue !== undefined) return aliasedValue
  }
  return undefined
}

/** 将字段值格式化为列表展示文本 */
export function formatFieldValue(
  field: FieldVO,
  row: Record<string, unknown>,
  ctx: DisplayContext,
): string {
  const value = fieldValue(field, row)
  if (value === undefined || value === null || value === '') return '-'

  switch (field.type) {
    case 'select':
    case 'radio': {
      const opt = field.options?.find((o) => o.value === value)
      return opt?.label ?? String(value)
    }
    case 'multiselect':
    case 'checkbox': {
      const values = Array.isArray(value) ? value : [value]
      return values
        .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
        .join('、')
    }
    case 'member': {
      // 负责人列优先用后端拼好的 ownerName
      if (['owner', 'ownerId'].includes(field.key) && row.ownerName) return String(row.ownerName)
      return ctx.memberMap.get(String(value)) ?? '-'
    }
    case 'dept':
      return ctx.deptMap.get(String(value)) ?? '-'
    case 'switch':
      return value ? '是' : '否'
    case 'currency':
      return `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}`
    case 'percent':
      return `${value}%`
    case 'formula': {
      const precision = field.config?.precision
      return typeof value === 'number' && precision !== undefined
        ? value.toFixed(precision)
        : String(value)
    }
    case 'datetime':
      return String(value).replace('T', ' ').slice(0, 16)
    case 'location':
      return (
        formatLocationValue(
          String(value),
          '/',
          ' ',
          field.config?.scope ?? 'ALL',
          field.config?.locationType ?? 'PCD',
        ) || '-'
      )
    case 'attachment':
      return Array.isArray(value) && value.length ? `${value.length} 个附件` : '-'
    case 'data_source': {
      const sourceType = field.config?.dataSourceType
      if (!sourceType) return String(value)
      return (
        ctx.dataSourceMap?.get(dataSourceDisplayKey(sourceType, String(value))) ?? String(value)
      )
    }
    case 'data_source_multiple': {
      const sourceType = field.config?.dataSourceType
      const values = Array.isArray(value) ? value : [value]
      if (!sourceType) return values.map(String).join('、')
      return values
        .map(
          (item) =>
            ctx.dataSourceMap?.get(dataSourceDisplayKey(sourceType, String(item))) ?? String(item),
        )
        .join('、')
    }
    default:
      return String(value)
  }
}
