import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { ClaimRuleContext, DirectPoolPickRule } from './pool-domain.types'
import { PoolRuleCalculator, POOL_DAY_MS } from './pool-rule-calculator.service'

const calculator = new PoolRuleCalculator()
const now = BigInt(new Date('2026-08-25T12:00:00+08:00').getTime())

const rule: DirectPoolPickRule = {
  limitOnNumber: true,
  pickNumber: 3,
  limitPreOwner: true,
  pickIntervalDays: 7,
  limitNew: true,
  newPickInterval: 2,
}

function context(overrides: Partial<ClaimRuleContext> = {}): ClaimRuleContext {
  return {
    rule,
    claimantId: 'user-1',
    processCount: 1,
    todayPickedCount: 0,
    previousOwner: null,
    poolEnteredAt: now - 3n * POOL_DAY_MS,
    capacity: 10,
    ownedCount: 2,
    excludedOwnedCount: 0,
    poolAdmin: false,
    poolAdminStillChecksPreviousOwner: false,
    now,
    ...overrides,
  }
}

function rejects(run: () => void, message: RegExp) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof BadRequestException)
    assert.match(error.message, message)
    return true
  })
}

test('每日领取数量按当前批次与当日已领取数量合并校验', () => {
  rejects(
    () => calculator.assertClaimAllowed(context({ processCount: 2, todayPickedCount: 2 })),
    /今日领取数量已达上限/,
  )
  calculator.assertClaimAllowed(context({ processCount: 1, todayPickedCount: 2 }))
})

test('前负责人必须等待冷却期结束，边界时刻允许领取', () => {
  const previousOwner = {
    owner: 'user-1',
    collectionTime: now - 20n * POOL_DAY_MS,
    endTime: now - 6n * POOL_DAY_MS,
  }
  rejects(() => calculator.assertClaimAllowed(context({ previousOwner })), /前负责人需到/)
  calculator.assertClaimAllowed(
    context({ previousOwner: { ...previousOwner, endTime: now - 7n * POOL_DAY_MS } }),
  )
})

test('新进入池的数据在保护期内不可领取', () => {
  rejects(
    () => calculator.assertClaimAllowed(context({ poolEnteredAt: now - POOL_DAY_MS })),
    /该数据需到/,
  )
})

test('客户库容排除数量从实际持有量中扣除', () => {
  calculator.assertClaimAllowed(context({ capacity: 3, ownedCount: 4, excludedOwnedCount: 2 }))
  rejects(
    () =>
      calculator.assertClaimAllowed(context({ capacity: 3, ownedCount: 4, excludedOwnedCount: 1 })),
    /库容不足/,
  )
})

test('池管理员仍受库容限制', () => {
  rejects(
    () => calculator.assertClaimAllowed(context({ poolAdmin: true, capacity: 1, ownedCount: 1 })),
    /库容不足/,
  )
})

test('按 Cordys 源码保留线索池与客户公海的管理员冷却差异', () => {
  const previousOwner = {
    owner: 'user-1',
    collectionTime: now - 20n * POOL_DAY_MS,
    endTime: now - POOL_DAY_MS,
  }
  calculator.assertClaimAllowed(
    context({ poolAdmin: true, previousOwner, poolAdminStillChecksPreviousOwner: false }),
  )
  rejects(
    () =>
      calculator.assertClaimAllowed(
        context({ poolAdmin: true, previousOwner, poolAdminStillChecksPreviousOwner: true }),
      ),
    /前负责人需到/,
  )
})

test('分配不带领取规则时仍执行库容校验', () => {
  rejects(
    () => calculator.assertClaimAllowed(context({ rule: null, capacity: 2, ownedCount: 2 })),
    /库容不足/,
  )
})
