import { Injectable } from '@nestjs/common'
import type { ResourcePoolRecycleCondition } from './pool-domain.types'

export interface RecycleTimeResource {
  createdAt: Date
  collectedAt: Date | null
  lastFollowedAt: Date | null
}

type SearchMode = 'AND' | 'OR'

/**
 * 线索池与客户公海共用的时间回收条件计算器。
 *
 * 注意：这不是普通高级筛选器。当前只把 storageTime / followUpTime
 * 用作自动回收条件，因此这里保持独立语义，避免任意字段意外触发自动回收。
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

  /**
   * 计算下一次可能满足回收条件的时间点。该方法只负责调度边界，
   * 到期后仍必须调用 matches() 重新判断完整规则。
   */
  nextDueAt(
    mode: string | null | undefined,
    rawConditions: unknown,
    resource: RecycleTimeResource,
    now = new Date(),
  ): Date | null {
    if (!Array.isArray(rawConditions)) return null
    const conditions = rawConditions.filter(
      (condition): condition is ResourcePoolRecycleCondition => this.isValidCondition(condition),
    )
    if (!conditions.length) return null

    const searchMode: SearchMode = mode === 'OR' ? 'OR' : 'AND'
    const dueCandidates: number[] = []
    const nonThresholdResults: boolean[] = []

    for (const condition of conditions) {
      const dueAt = this.thresholdDueAt(condition, resource)
      if (dueAt !== null) {
        dueCandidates.push(dueAt)
        continue
      }
      nonThresholdResults.push(this.matchesCondition(condition, resource, now))
    }

    const immediate = now.getTime() + 1_000
    if (searchMode === 'OR') {
      if (nonThresholdResults.some(Boolean)) return new Date(immediate)
      if (!dueCandidates.length) return null
      return new Date(Math.max(immediate, Math.min(...dueCandidates)))
    }

    if (nonThresholdResults.some((matched) => !matched)) return null
    if (!dueCandidates.length) return null
    return new Date(Math.max(immediate, ...dueCandidates))
  }

  private thresholdDueAt(
    condition: ResourcePoolRecycleCondition,
    resource: RecycleTimeResource,
  ): number | null {
    if (condition.operator !== 'DYNAMICS') return null
    const threshold = this.parseDuration(condition.value)
    if (!threshold || threshold.direction !== 'before') return null

    const dueFor = (anchor: Date | null) => {
      if (!anchor) return null
      const due = new Date(anchor)
      const sign = 1
      if (threshold.unit === 'MINUTE') due.setTime(due.getTime() + sign * threshold.amount * 60_000)
      else if (threshold.unit === 'HOUR')
        due.setTime(due.getTime() + sign * threshold.amount * 3_600_000)
      else if (threshold.unit === 'DAY') due.setDate(due.getDate() + sign * threshold.amount)
      else if (threshold.unit === 'WEEK') due.setDate(due.getDate() + sign * threshold.amount * 7)
      else if (threshold.unit === 'MONTH') due.setMonth(due.getMonth() + sign * threshold.amount)
      else return null
      // matchesTime 使用严格小于，延后 1ms 确保边界时刻不会提前回收。
      return due.getTime() + 1
    }

    if (condition.column === 'followUpTime')
      return dueFor(resource.lastFollowedAt ?? resource.collectedAt)
    if (condition.column !== 'storageTime') return null
    const scope = condition.scope ?? []
    const anchors: Array<Date | null> = []
    if (scope.includes('Created')) anchors.push(resource.createdAt)
    if (scope.includes('Picked')) anchors.push(resource.collectedAt)
    if (!anchors.length) return null
    const dueTimes = anchors.map(dueFor)
    if (dueTimes.some((value) => value === null)) return null
    // 同时勾选创建/领取时间时，Evaluator 要求二者都满足，取较晚的边界。
    return Math.max(...(dueTimes as number[]))
  }

  private parseDuration(value: string): {
    amount: number
    direction: 'before' | 'after'
    unit: 'MINUTE' | 'HOUR' | 'DAY' | 'WEEK' | 'MONTH'
  } | null {
    const parts = value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (parts.length === 2) {
      const amount = Number(parts[0])
      const legacyUnit = parts[1].toUpperCase()
      const unit =
        legacyUnit === 'DAY'
          ? 'DAY'
          : legacyUnit === 'WEEK'
            ? 'WEEK'
            : legacyUnit === 'MONTH'
              ? 'MONTH'
              : null
      return Number.isInteger(amount) && amount > 0 && unit
        ? { amount, direction: 'before', unit }
        : null
    }
    if (parts.length !== 3) return null
    const amount = Number(parts[1])
    const rawUnit = parts[2].toUpperCase()
    const direction = rawUnit.startsWith('BEFORE_')
      ? 'before'
      : rawUnit.startsWith('AFTER_')
        ? 'after'
        : null
    const suffix = rawUnit.replace(/^(BEFORE_|AFTER_)/, '')
    const unit =
      suffix === 'MINUTE'
        ? 'MINUTE'
        : suffix === 'HOUR'
          ? 'HOUR'
          : suffix === 'DAY'
            ? 'DAY'
            : suffix === 'WEEK'
              ? 'WEEK'
              : suffix === 'MONTH'
                ? 'MONTH'
                : null
    return Number.isInteger(amount) && amount > 0 && direction && unit
      ? { amount, direction, unit }
      : null
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
      if (created && picked) {
        // 同时勾选多个时间来源时，所有选中时间都必须满足条件，避免旧创建时间
        // 覆盖近期领取时间而导致线索被提前回收。
        return (
          this.matchesTime(condition, resource.createdAt, now) &&
          this.matchesTime(condition, resource.collectedAt, now)
        )
      }
      if (created) return this.matchesTime(condition, resource.createdAt, now)
      if (picked) return this.matchesTime(condition, resource.collectedAt, now)
      return false
    }
    // 从未跟进时，以最近一次领取时间作为初始计时锚点；一旦有跟进记录，
    // 则只使用最后跟进时间。领取时间缺失时仍不匹配，避免错误回收。
    return this.matchesTime(condition, resource.lastFollowedAt ?? resource.collectedAt, now)
  }

  private matchesTime(condition: ResourcePoolRecycleCondition, time: Date | null, now: Date) {
    // 缺失时间不匹配普通时间条件，避免 null 被误判为符合任意回收规则。
    if (!time) return false

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

    // 动态阈值以所选时间字段为锚点；HOUR 按精确小时计算，DAY/WEEK/MONTH 保留旧配置兼容。
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
    if (unit.endsWith('_MINUTE')) time.setTime(time.getTime() + sign * amount * 60 * 1000)
    else if (unit.endsWith('_HOUR')) time.setTime(time.getTime() + sign * amount * 60 * 60 * 1000)
    else if (unit.endsWith('_DAY')) time.setDate(time.getDate() + sign * amount)
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
