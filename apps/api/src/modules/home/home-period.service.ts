import { Injectable } from '@nestjs/common'
import type { HomeStatisticPeriod } from '@micromatrix/shared'

export interface HomePeriodRange {
  start: Date
  end: Date
  previousStart: Date
  previousEnd: Date
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function endBefore(value: Date) {
  return new Date(value.getTime() - 1)
}

@Injectable()
export class HomePeriodService {
  range(period: HomeStatisticPeriod, now = new Date()): HomePeriodRange {
    const today = startOfDay(now)
    switch (period) {
      case 'TODAY': {
        const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
        const previousStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
        return { start: today, end: endBefore(next), previousStart, previousEnd: endBefore(today) }
      }
      case 'THIS_WEEK': {
        const day = today.getDay() || 7
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - day + 1)
        const next = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
        const previousStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - 7)
        return { start, end: endBefore(next), previousStart, previousEnd: endBefore(start) }
      }
      case 'THIS_MONTH': {
        const start = new Date(today.getFullYear(), today.getMonth(), 1)
        const next = new Date(today.getFullYear(), today.getMonth() + 1, 1)
        const previousStart = new Date(today.getFullYear(), today.getMonth() - 1, 1)
        return { start, end: endBefore(next), previousStart, previousEnd: endBefore(start) }
      }
      case 'THIS_YEAR': {
        const start = new Date(today.getFullYear(), 0, 1)
        const next = new Date(today.getFullYear() + 1, 0, 1)
        const previousStart = new Date(today.getFullYear() - 1, 0, 1)
        return { start, end: endBefore(next), previousStart, previousEnd: endBefore(start) }
      }
    }
  }
}
