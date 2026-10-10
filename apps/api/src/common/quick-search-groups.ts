import { BadRequestException } from '@nestjs/common'
import { filterOpsForType, type FieldVO, type FilterCondition, type QuickSearchQueryGroup } from '@micromatrix/shared'

/** 仅接收已存在、可查询字段，避免 OR 组中未知字段导致错误地命中全表。 */
export function validateQuickSearchGroups(raw: unknown, fields: FieldVO[]): QuickSearchQueryGroup[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > 12) throw new BadRequestException('快捷搜索条件组无效')
  const fieldMap = new Map(fields.filter((field) => !field.hidden && field.type !== 'formula').map((field) => [field.key, field]))
  return raw.map((group: unknown) => {
    if (!group || typeof group !== 'object') throw new BadRequestException('快捷搜索条件组格式错误')
    const candidate = group as Record<string, unknown>
    if ((candidate.mode !== 'AND' && candidate.mode !== 'OR') ||
        !Array.isArray(candidate.conditions) || candidate.conditions.length < 1 || candidate.conditions.length > 8) {
      throw new BadRequestException('快捷搜索条件组格式错误')
    }
    const conditions: FilterCondition[] = candidate.conditions.map((value: unknown) => {
      if (!value || typeof value !== 'object') throw new BadRequestException('快捷搜索条件格式错误')
      const item = value as Record<string, unknown>
      const field = fieldMap.get(String(item.key ?? ''))
      if (!field || typeof item.op !== 'string' || !filterOpsForType(field.type).includes(item.op as FilterCondition['op'])) {
        throw new BadRequestException('快捷搜索包含不存在的字段或不支持的操作符')
      }
      const unary = item.op === 'isEmpty' || item.op === 'notEmpty'
      const values = Array.isArray(item.value) ? item.value : [item.value]
      if (!unary && (!values.length || values.length > 50 || values.some((v) =>
        (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') ||
        String(v).length > 500 || v === ''))) {
        throw new BadRequestException('快捷搜索条件值格式错误')
      }
      return {
        key: field.key,
        op: item.op as FilterCondition['op'],
        ...(unary ? {} : { value: item.value }),
      }
    })
    return { mode: candidate.mode as 'AND' | 'OR', conditions }
  })
}

/** 计算 (组内 AND/OR) 之间的 AND/OR：组内复用现有字段筛选实现。 */
export async function resolveQuickSearchGroupIds(
  groups: QuickSearchQueryGroup[],
  resolver: (conditions: FilterCondition[], mode: 'AND' | 'OR') => Promise<string[]>,
): Promise<string[] | null> {
  if (!groups.length) return null
  const sets = await Promise.all(groups.map(async (group) => new Set(await resolver(group.conditions, group.mode))))
  const [first, ...rest] = sets
  return [...first!].filter((id) => rest.every((set) => set.has(id)))
}
