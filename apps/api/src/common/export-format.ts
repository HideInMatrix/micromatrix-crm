import type { FieldVO } from '@micromatrix/shared'

/** 导出时将字段值转为可读文本（选项转 label、开关转是/否） */
export function formatForExport(field: FieldVO, row: Record<string, unknown>): string {
  const value =
    !field.system || field.type === 'formula'
      ? (row.customData as Record<string, unknown> | undefined)?.[field.key]
      : row[field.key]

  if (value === undefined || value === null || value === '') return ''
  switch (field.type) {
    case 'select':
    case 'radio':
      return field.options?.find((o) => o.value === value)?.label ?? String(value)
    case 'multiselect':
    case 'checkbox': {
      const values = Array.isArray(value) ? value : [value]
      return values
        .map((v) => field.options?.find((o) => o.value === v)?.label ?? String(v))
        .join('、')
    }
    case 'member':
      return String((row.ownerName as string) ?? value)
    case 'switch':
      return value ? '是' : '否'
    default:
      return String(value)
  }
}
