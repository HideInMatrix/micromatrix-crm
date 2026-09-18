import { BadRequestException } from '@nestjs/common'
import type { FilterCondition } from '@micromatrix/shared'

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
