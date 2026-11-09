import assert from 'node:assert/strict'
import { ResourceRecycleConditionEvaluator } from '../src/modules/pool-rules/resource-recycle-condition-evaluator.service'

const evaluator = new ResourceRecycleConditionEvaluator()
const anchor = new Date('2026-11-09T02:00:00.000Z')
const resource = {
  createdAt: new Date('2026-11-09T01:00:00.000Z'),
  collectedAt: anchor,
  lastFollowedAt: null,
}

const pickedTwoMinutes = [
  {
    column: 'storageTime',
    operator: 'DYNAMICS',
    value: 'CUSTOM,2,BEFORE_MINUTE',
    scope: ['Picked'],
  },
]

assert.equal(
  evaluator.nextDueAt('AND', pickedTwoMinutes, resource, anchor)?.getTime(),
  anchor.getTime() + 120_001,
  '领取后两分钟应生成对应的延迟任务',
)
assert.equal(
  evaluator.matches('AND', pickedTwoMinutes, resource, new Date(anchor.getTime() + 120_000)),
  false,
  '严格早于条件在边界时刻不能提前回收',
)
assert.equal(
  evaluator.matches('AND', pickedTwoMinutes, resource, new Date(anchor.getTime() + 120_002)),
  true,
  '超过两分钟后应命中回收条件',
)

const followedResource = {
  ...resource,
  lastFollowedAt: new Date(anchor.getTime() + 60_000),
}
const lastFollowedTwoMinutes = [
  {
    column: 'followUpTime',
    operator: 'DYNAMICS',
    value: 'CUSTOM,2,BEFORE_MINUTE',
  },
]
assert.equal(
  evaluator.nextDueAt('AND', lastFollowedTwoMinutes, resource, anchor)?.getTime(),
  anchor.getTime() + 120_001,
  '从未跟进时应回退到最近领取时间，确保领取后也会生成延迟任务',
)
assert.equal(
  evaluator.matches('AND', lastFollowedTwoMinutes, resource, new Date(anchor.getTime() + 120_000)),
  false,
  '从未跟进时，领取后两分钟边界不能提前回收',
)
assert.equal(
  evaluator.matches('AND', lastFollowedTwoMinutes, resource, new Date(anchor.getTime() + 120_002)),
  true,
  '从未跟进时，超过领取时间两分钟应命中最后跟进时间规则',
)
assert.equal(
  evaluator.nextDueAt('AND', lastFollowedTwoMinutes, { ...resource, collectedAt: null }, anchor),
  null,
  '领取时间和最后跟进时间都缺失时不能猜测回收时间',
)
assert.equal(
  evaluator.matches(
    'AND',
    lastFollowedTwoMinutes,
    { ...resource, collectedAt: null },
    new Date(anchor.getTime() + 120_002),
  ),
  false,
  '领取时间和最后跟进时间都缺失时不能命中回收条件',
)
assert.equal(
  evaluator.nextDueAt('AND', lastFollowedTwoMinutes, followedResource, anchor)?.getTime(),
  anchor.getTime() + 180_001,
  '最后跟进时间应成为新的计时锚点',
)

const customerResource = {
  createdAt: new Date('2026-11-09T01:00:00.000Z'),
  collectedAt: new Date(anchor.getTime() + 30_000),
  lastFollowedAt: null,
}
assert.equal(
  evaluator.nextDueAt('AND', lastFollowedTwoMinutes, customerResource, anchor)?.getTime(),
  anchor.getTime() + 150_001,
  '客户公海从未跟进时也应使用最近领取时间生成回收计划',
)
assert.equal(
  evaluator.matches(
    'AND',
    lastFollowedTwoMinutes,
    customerResource,
    new Date(anchor.getTime() + 150_002),
  ),
  true,
  '客户公海超过领取时间两分钟后应命中最后跟进时间规则',
)

const orRule = [
  ...pickedTwoMinutes,
  {
    column: 'followUpTime',
    operator: 'FIXED',
    value: `${anchor.getTime() - 1},${anchor.getTime() + 1}`,
  },
]
assert.equal(
  evaluator.nextDueAt('OR', orRule, { ...resource, lastFollowedAt: anchor }, anchor)?.getTime(),
  anchor.getTime() + 1_000,
  'OR 中已有满足条件时应尽快触发重新评估',
)

const createdAndPicked = [
  {
    column: 'storageTime',
    operator: 'DYNAMICS',
    value: 'CUSTOM,2,BEFORE_MINUTE',
    scope: ['Created', 'Picked'],
  },
]
assert.equal(
  evaluator.nextDueAt('AND', createdAndPicked, resource, anchor)?.getTime(),
  anchor.getTime() + 120_001,
  '创建时间与领取时间同时选择时应以较晚的到期边界为准',
)

const legacy = [{ column: 'storageTime', operator: 'DYNAMICS', value: '2,day', scope: ['Picked'] }]
assert.equal(
  evaluator.nextDueAt('AND', legacy, resource, anchor)?.getTime(),
  anchor.getTime() + 2 * 24 * 60 * 60 * 1_000 + 1,
  '旧版天数格式必须保持兼容',
)

console.log('Pool recycle evaluator tests passed (12 assertions groups).')
