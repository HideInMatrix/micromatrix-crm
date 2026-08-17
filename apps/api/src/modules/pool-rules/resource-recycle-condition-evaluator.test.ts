import assert from 'node:assert/strict'
import test from 'node:test'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

const evaluator = new ResourceRecycleConditionEvaluator()
const now = new Date('2026-08-17T12:00:00+08:00')

function resource(input?: {
  createdAt?: string
  collectedAt?: string | null
  lastFollowedAt?: string | null
}) {
  return {
    createdAt: new Date(input?.createdAt ?? '2026-07-01T10:00:00+08:00'),
    collectedAt:
      input?.collectedAt === null
        ? null
        : new Date(input?.collectedAt ?? '2026-07-10T10:00:00+08:00'),
    lastFollowedAt:
      input?.lastFollowedAt === null
        ? null
        : new Date(input?.lastFollowedAt ?? '2026-07-20T10:00:00+08:00'),
  }
}

test('AND: 入库早于 30 天且最后跟进早于 7 天时命中', () => {
  const conditions = [
    {
      column: 'storageTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,30,BEFORE_DAY',
      scope: ['Created'] as ('Created' | 'Picked')[],
    },
    {
      column: 'followUpTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,7,BEFORE_DAY',
    },
  ]
  assert.equal(evaluator.matches('AND', conditions, resource(), now), true)
})

test('AND: 任一条件未满足时不回收', () => {
  const conditions = [
    {
      column: 'storageTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,30,BEFORE_DAY',
      scope: ['Created'] as ('Created' | 'Picked')[],
    },
    {
      column: 'followUpTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,7,BEFORE_DAY',
    },
  ]
  const recent = resource({ lastFollowedAt: '2026-08-16T10:00:00+08:00' })
  assert.equal(evaluator.matches('AND', conditions, recent, now), false)
})

test('OR: 任一时间条件满足即可回收', () => {
  const conditions = [
    {
      column: 'storageTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,365,BEFORE_DAY',
      scope: ['Created'] as ('Created' | 'Picked')[],
    },
    {
      column: 'followUpTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,7,BEFORE_DAY',
    },
  ]
  assert.equal(evaluator.matches('OR', conditions, resource(), now), true)
})

test('storageTime Picked scope 使用 collectedAt 而不是 createdAt', () => {
  const conditions = [
    {
      column: 'storageTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,30,BEFORE_DAY',
      scope: ['Picked'] as ('Created' | 'Picked')[],
    },
  ]
  const recentlyPicked = resource({ collectedAt: '2026-08-16T10:00:00+08:00' })
  assert.equal(evaluator.matches('AND', conditions, recentlyPicked, now), false)
})

test('FIXED 时间区间支持毫秒时间戳', () => {
  const start = new Date('2026-07-01T00:00:00+08:00').getTime()
  const end = new Date('2026-07-31T23:59:59+08:00').getTime()
  const conditions = [
    {
      column: 'followUpTime' as const,
      operator: 'FIXED' as const,
      value: `${start},${end}`,
    },
  ]
  assert.equal(evaluator.matches('AND', conditions, resource(), now), true)
})

test('空跟进时间保持 Cordys 兼容语义：时间条件视为命中', () => {
  const conditions = [
    {
      column: 'followUpTime' as const,
      operator: 'DYNAMICS' as const,
      value: 'CUSTOM,7,BEFORE_DAY',
    },
  ]
  assert.equal(evaluator.matches('AND', conditions, resource({ lastFollowedAt: null }), now), true)
})

test('空条件不会退化为 AND 全量回收', () => {
  assert.equal(evaluator.matches('AND', [], resource(), now), false)
})
