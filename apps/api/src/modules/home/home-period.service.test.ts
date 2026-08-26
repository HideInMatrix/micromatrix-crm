import assert from 'node:assert/strict'
import test from 'node:test'
import { HomePeriodService } from './home-period.service'

const service = new HomePeriodService()
const now = new Date(2026, 7, 26, 13, 31, 22, 345)

test('HomePeriodService TODAY 使用本地自然日并生成完整上一日', () => {
  const range = service.range('TODAY', now)
  assert.equal(range.start.getTime(), new Date(2026, 7, 26, 0, 0, 0, 0).getTime())
  assert.equal(range.end.getTime(), new Date(2026, 7, 26, 23, 59, 59, 999).getTime())
  assert.equal(range.previousStart.getTime(), new Date(2026, 7, 25, 0, 0, 0, 0).getTime())
  assert.equal(range.previousEnd.getTime(), new Date(2026, 7, 25, 23, 59, 59, 999).getTime())
})

test('HomePeriodService THIS_WEEK 以周一为起点并生成完整上一周', () => {
  const range = service.range('THIS_WEEK', now)
  assert.equal(range.start.getTime(), new Date(2026, 7, 24, 0, 0, 0, 0).getTime())
  assert.equal(range.end.getTime(), new Date(2026, 7, 30, 23, 59, 59, 999).getTime())
  assert.equal(range.previousStart.getTime(), new Date(2026, 7, 17, 0, 0, 0, 0).getTime())
  assert.equal(range.previousEnd.getTime(), new Date(2026, 7, 23, 23, 59, 59, 999).getTime())
})

test('HomePeriodService THIS_MONTH 跨月边界不按固定天数回退', () => {
  const range = service.range('THIS_MONTH', now)
  assert.equal(range.start.getTime(), new Date(2026, 7, 1, 0, 0, 0, 0).getTime())
  assert.equal(range.end.getTime(), new Date(2026, 7, 31, 23, 59, 59, 999).getTime())
  assert.equal(range.previousStart.getTime(), new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  assert.equal(range.previousEnd.getTime(), new Date(2026, 6, 31, 23, 59, 59, 999).getTime())
})

test('HomePeriodService THIS_YEAR 跨闰年边界仍使用自然年', () => {
  const leapNow = new Date(2024, 1, 29, 12, 0, 0, 0)
  const range = service.range('THIS_YEAR', leapNow)
  assert.equal(range.start.getTime(), new Date(2024, 0, 1, 0, 0, 0, 0).getTime())
  assert.equal(range.end.getTime(), new Date(2024, 11, 31, 23, 59, 59, 999).getTime())
  assert.equal(range.previousStart.getTime(), new Date(2023, 0, 1, 0, 0, 0, 0).getTime())
  assert.equal(range.previousEnd.getTime(), new Date(2023, 11, 31, 23, 59, 59, 999).getTime())
})
