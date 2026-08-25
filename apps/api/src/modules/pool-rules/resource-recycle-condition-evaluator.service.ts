import { Injectable } from '@nestjs/common'
import type { ResourcePoolRecycleCondition } from './pool-domain.types'

export interface RecycleTimeResource {
  createdAt: Date
  collectedAt: Date | null
  lastFollowedAt: Date | null
}

type SearchMode = 'AND' | 'OR'

/**
 * CordysCRM 公海/线索池专用时间回收条件。
 *
 * 注意：这不是普通高级筛选器。Cordys 当前只把 storageTime / followUpTime
 * 用作自动回收条件，因此这里保持独立语义，避免后续任意字段意外触发自动回收。
 */
@Injectable()
export class ResourceRecycleConditionEvaluator {
  hasValidConditions(value: unknown): value is ResourcePoolRecycleCondition[] {
    return Array.isArray(value) && value.some((condition) => this.isValidCondition(condition))
  }

  matches(
    mode: string | null | undefined,
    rawConditions: unknown,
    resource: RecycleTimeResource,
    now = new Date(),
  ): boolean {
    if (!Array.isArray(rawConditions)) return false
    const conditions = rawConditions.filter(
      (condition): condition is ResourcePoolRecycleCondition => this.isValidCondition(condition),
    )
    // 安全边界：Cordys UI 自动回收至少配置一个条件。空 AND 不允许退化成“回收全部”。
    if (conditions.length === 0) return false

    const searchMode: SearchMode = mode === 'OR' ? 'OR' : 'AND'
    const results = conditions.map((condition) => this.matchesCondition(condition, resource, now))
    return searchMode === 'AND' ? results.every(Boolean) : results.some(Boolean)
  }

  private matchesCondition(
    condition: ResourcePoolRecycleCondition,
    resource: RecycleTimeResource,
    now: Date,
  ) {
    if (condition.column === 'storageTime') {
      const scope = condition.scope ?? []
      const created = scope.includes('Created')
      const picked = scope.includes('Picked')
      if (created && !picked) return this.matchesTime(condition, resource.createdAt, now)
      if (picked && !created) return this.matchesTime(condition, resource.collectedAt, now)
      return (
        this.matchesTime(condition, resource.createdAt, now) ||
        this.matchesTime(condition, resource.collectedAt, now)
      )
    }
    return this.matchesTime(condition, resource.lastFollowedAt, now)
  }

  private matchesTime(condition: ResourcePoolRecycleCondition, time: Date | null, now: Date) {
    // 与 Cordys RecycleConditionUtils.matchTime 保持兼容：空时间也满足回收条件。
    if (!time) return true

    const parts = condition.value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (condition.operator === 'FIXED') {
      if (parts.length !== 2) return false
      const start = this.parseTimestamp(parts[0])
      const end = this.parseTimestamp(parts[1])
      return start !== null && end !== null && time.getTime() >= start && time.getTime() <= end
    }

    if (condition.operator !== 'DYNAMICS') return false
    if (parts.length === 1) {
      const range = this.dynamicRange(parts[0], now)
      return !!range && time.getTime() >= range[0] && time.getTime() <= range[1]
    }

    const threshold = this.dynamicThreshold(parts, now)
    if (!threshold) return false
    return threshold.direction === 'before'
      ? time.getTime() < threshold.time.getTime()
      : time.getTime() > threshold.time.getTime()
  }

  private dynamicRange(key: string, now: Date): [number, number] | null {
    const startOfDay = (date: Date) => {
      const out = new Date(date)
      out.setHours(0, 0, 0, 0)
      return out
    }
    const endOfDay = (date: Date) => {
      const out = new Date(date)
      out.setHours(23, 59, 59, 999)
      return out
    }
    const addDays = (date: Date, days: number) => {
      const out = new Date(date)
      out.setDate(out.getDate() + days)
      return out
    }
    const mondayOfWeek = (date: Date) => {
      const out = startOfDay(date)
      const weekday = out.getDay() || 7
      out.setDate(out.getDate() - weekday + 1)
      return out
    }

    switch (key) {
      case 'TODAY':
        return [startOfDay(now).getTime(), endOfDay(now).getTime()]
      case 'YESTERDAY': {
        const day = addDays(now, -1)
        return [startOfDay(day).getTime(), endOfDay(day).getTime()]
      }
      case 'TOMORROW': {
        const day = addDays(now, 1)
        return [startOfDay(day).getTime(), endOfDay(day).getTime()]
      }
      case 'WEEK': {
        const start = mondayOfWeek(now)
        return [start.getTime(), endOfDay(addDays(start, 6)).getTime()]
      }
      case 'LAST_WEEK': {
        const start = addDays(mondayOfWeek(now), -7)
        return [start.getTime(), endOfDay(addDays(start, 6)).getTime()]
      }
      case 'MONTH': {
        const start = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1))
        const end = endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0))
        return [start.getTime(), end.getTime()]
      }
      case 'LAST_MONTH': {
        const start = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1))
        const end = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0))
        return [start.getTime(), end.getTime()]
      }
      case 'LAST_SEVEN':
        return [startOfDay(addDays(now, -7)).getTime(), startOfDay(now).getTime()]
      case 'SEVEN':
        return [startOfDay(now).getTime(), endOfDay(addDays(now, 6)).getTime()]
      case 'LAST_THIRTY':
        return [startOfDay(addDays(now, -30)).getTime(), startOfDay(now).getTime()]
      case 'THIRTY':
        return [startOfDay(now).getTime(), endOfDay(addDays(now, 29)).getTime()]
      default:
        return null
    }
  }

  private dynamicThreshold(parts: string[], now: Date) {
    // 兼容 Cordys 旧格式："30,day" / "2,week" / "1,month"。
    if (parts.length === 2) {
      const amount = Number(parts[0])
      if (!Number.isFinite(amount)) return null
      const time = new Date(now)
      if (parts[1] === 'day') time.setDate(time.getDate() - amount)
      else if (parts[1] === 'week') time.setDate(time.getDate() - amount * 7)
      else if (parts[1] === 'month') time.setMonth(time.getMonth() - amount)
      else return null
      return { time, direction: 'before' as const }
    }

    // Cordys 新格式：首段为自定义标记，第二段为数量，第三段为 BEFORE/AFTER_*。
    if (parts.length !== 3) return null
    const amount = Number(parts[1])
    if (!Number.isFinite(amount)) return null
    const unit = parts[2]
    const time = new Date(now)
    const direction = unit.includes('BEFORE')
      ? ('before' as const)
      : unit.includes('AFTER')
        ? ('after' as const)
        : null
    if (!direction) return null
    const sign = direction === 'before' ? -1 : 1
    if (unit.endsWith('_DAY')) time.setDate(time.getDate() + sign * amount)
    else if (unit.endsWith('_WEEK')) time.setDate(time.getDate() + sign * amount * 7)
    else if (unit.endsWith('_MONTH')) time.setMonth(time.getMonth() + sign * amount)
    else return null
    return { time, direction }
  }

  private parseTimestamp(value: string): number | null {
    const numberValue = Number(value)
    if (Number.isFinite(numberValue)) return numberValue
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }

  private isValidCondition(value: unknown): value is ResourcePoolRecycleCondition {
    if (!value || typeof value !== 'object') return false
    const condition = value as Partial<ResourcePoolRecycleCondition>
    return (
      (condition.column === 'storageTime' || condition.column === 'followUpTime') &&
      (condition.operator === 'FIXED' || condition.operator === 'DYNAMICS') &&
      typeof condition.value === 'string' &&
      condition.value.trim().length > 0
    )
  }
}
