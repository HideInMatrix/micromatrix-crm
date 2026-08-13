import { BadRequestException } from '@nestjs/common'
import {
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { Prisma } from '../generated/prisma/client'

/** 解析前端传来的 filters JSON 字符串 */
export function parseFilters(raw?: string): FilterCondition[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((c) => c && typeof c.key === 'string' && typeof c.op === 'string')
  } catch {
    throw new BadRequestException('筛选条件格式错误')
  }
}

/**
 * 将筛选条件转换为 Prisma where 片段数组（AND 语义）。
 * 系统字段直接过滤实体列；cf_ 自定义字段过滤 customData JSONB。
 */
export function buildFilterClauses(
  fields: Map<string, FieldVO>,
  conditions: FilterCondition[],
): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = []
  for (const condition of conditions) {
    const field = fields.get(condition.key)
    if (!field || field.type === 'formula') continue
    const clause = isCustomFieldKey(condition.key)
      ? customClause(condition, field)
      : columnClause(condition, field)
    if (clause) clauses.push(clause)
  }
  return clauses
}

function castValue(field: FieldVO, value: unknown): unknown {
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent':
      return Number(value)
    case 'switch':
      return value === true || value === 'true'
    default:
      return value
  }
}

function columnClause(c: FilterCondition, field: FieldVO): Record<string, unknown> | null {
  const key = c.key
  const isDate = field.type === 'date' || field.type === 'datetime'
  const value = isDate ? new Date(String(c.value)) : castValue(field, c.value)

  switch (c.op) {
    case 'eq':
      return { [key]: { equals: value } }
    case 'ne':
      return { NOT: { [key]: { equals: value } } }
    case 'contains':
      return { [key]: { contains: String(c.value), mode: 'insensitive' } }
    case 'gt':
      return { [key]: { gt: value } }
    case 'gte':
      return { [key]: { gte: value } }
    case 'lt':
      return { [key]: { lt: value } }
    case 'lte':
      return { [key]: { lte: value } }
    case 'isEmpty':
      return { OR: [{ [key]: null }, ...(field.type === 'text' ? [{ [key]: '' }] : [])] }
    case 'notEmpty':
      return { NOT: { OR: [{ [key]: null }, ...(field.type === 'text' ? [{ [key]: '' }] : [])] } }
    default:
      return null
  }
}

function customClause(c: FilterCondition, field: FieldVO): Record<string, unknown> | null {
  const path = [c.key]
  const value = castValue(field, c.value)

  switch (c.op) {
    case 'eq':
      return { customData: { path, equals: value as Prisma.InputJsonValue } }
    case 'ne':
      return { NOT: { customData: { path, equals: value as Prisma.InputJsonValue } } }
    case 'contains':
      // 多选类型匹配数组元素；文本类型匹配子串
      return field.type === 'multiselect' || field.type === 'checkbox'
        ? { customData: { path, array_contains: [c.value] as Prisma.InputJsonValue } }
        : { customData: { path, string_contains: String(c.value) } }
    case 'gt':
      return { customData: { path, gt: value as number } }
    case 'gte':
      return { customData: { path, gte: value as number } }
    case 'lt':
      return { customData: { path, lt: value as number } }
    case 'lte':
      return { customData: { path, lte: value as number } }
    case 'notEmpty':
      return { customData: { path, not: Prisma.AnyNull } }
    case 'isEmpty':
      return { NOT: { customData: { path, not: Prisma.AnyNull } } }
    default:
      return null
  }
}
