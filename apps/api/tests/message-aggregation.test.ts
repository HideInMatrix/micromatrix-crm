import assert from 'node:assert/strict'
import {
  DEFAULT_NOTIFICATION_AGGREGATION_MODE,
  MESSAGE_TASK_DEFINITIONS,
  notificationAggregationIdentity,
  resolveNotificationAggregationPolicy,
  type NotificationAggregationScope,
} from '@micromatrix/shared'

const resolve = (event: string, type?: string) =>
  resolveNotificationAggregationPolicy({ event, type })
assert.equal(DEFAULT_NOTIFICATION_AGGREGATION_MODE, 'SAME_CATEGORY')
for (const definition of MESSAGE_TASK_DEFINITIONS) {
  const policy = resolve(definition.event)
  assert.notEqual(policy.category, 'UNKNOWN', definition.event)
  if (definition.event.endsWith('_MENTIONED')) {
    assert.equal(policy.aggregationMode, 'NONE')
    assert.equal(policy.priority, 'HIGH')
    assert.equal(policy.aggregationWindowMs, 0)
  } else {
    assert.equal(policy.aggregationMode, 'SAME_CATEGORY')
    assert.equal(policy.aggregationWindowMs, 5000)
    assert.equal(policy.maxItems, 500)
  }
}

const lead = resolve('CLUE_ADD')
assert.deepEqual(resolve('CLUE_CONVERT_CUSTOMER', 'system'), lead)
assert.equal(resolve('CUSTOMER_ADD', 'system').category, 'CUSTOMER_ACTIVITY')
assert.equal(resolve('CLUE_FOLLOW_UP_OVERDUE').category, 'BUSINESS_TODO')
assert.equal(resolve('CUSTOMER_FOLLOW_UP_PLAN_DUE').category, 'BUSINESS_TODO')
assert.equal(resolve('CUSTOMER_COLLABORATION_ADD').category, 'INTERACTION')
assert.equal(resolve('CLUE_ADD', 'announcement').aggregationMode, 'NONE')
for (const event of [
  'PERMISSION_CHANGED',
  'ROLE_CHANGED',
  'SECURITY_ALERT',
  'FINANCE_APPROVAL',
  'CLUE_FUTURE_EVENT',
  '__proto__',
  'constructor',
]) {
  assert.equal(resolve(event).aggregationMode, 'NONE', event)
}
assert.equal(resolveNotificationAggregationPolicy({ type: 'system' }).category, 'SYSTEM_SECURITY')
assert.equal(resolveNotificationAggregationPolicy({ type: 'announcement' }).category, 'IMPORTANT')
assert.equal(resolveNotificationAggregationPolicy({ type: 'assign' }).aggregationMode, 'NONE')

const scope = {
  tenantId: 'tenant-a',
  recipientId: 'recipient-a',
  channel: 'SYSTEM',
  language: 'zh-CN',
  event: 'CLUE_ADD',
  receivedAtMs: 10_001,
} satisfies NotificationAggregationScope
const identity = notificationAggregationIdentity(scope, lead)!
assert.equal(identity.windowStartMs, 10_000)
assert.equal(identity.windowEndMs, 15_000)
const same = (patch: Partial<typeof scope>) =>
  notificationAggregationIdentity({ ...scope, ...patch }, lead)?.key
assert.equal(same({ event: 'CLUE_CONVERT_CUSTOMER', receivedAtMs: 14_999 }), identity.key)
for (const patch of [
  { tenantId: 'tenant-b' },
  { recipientId: 'recipient-b' },
  { language: 'en-US' as const },
  { receivedAtMs: 15_000 },
]) {
  assert.notEqual(same(patch), identity.key)
}
assert.notEqual(
  notificationAggregationIdentity({ ...scope, event: 'CUSTOMER_ADD' }, resolve('CUSTOMER_ADD'))
    ?.key,
  identity.key,
)
const perEvent = { ...lead, aggregationMode: 'SAME_EVENT' as const }
assert.notEqual(
  notificationAggregationIdentity(scope, perEvent)?.key,
  notificationAggregationIdentity({ ...scope, event: 'CLUE_CONVERT_CUSTOMER' }, perEvent)?.key,
)
assert.notEqual(notificationAggregationIdentity(scope, perEvent)?.key, identity.key)
assert.equal(notificationAggregationIdentity(scope, resolve('PERMISSION_CHANGED')), null)
assert.equal(notificationAggregationIdentity({ ...scope, receivedAtMs: NaN }, lead), null)
assert.equal(notificationAggregationIdentity({ ...scope, tenantId: '' }, lead), null)
assert.equal(notificationAggregationIdentity({ ...scope, channel: 'LARK' }, lead), null)
assert.equal(notificationAggregationIdentity({ ...scope, channel: 'DINGTALK' }, lead), null)
const wecom = {
  ...scope,
  channel: 'WECOM' as const,
  integrationId: 'app-a',
  credentialVersion: 1,
  externalSubject: 'member-a',
}
const wecomKey = notificationAggregationIdentity(wecom, lead)?.key
assert.ok(wecomKey && wecomKey !== identity.key)
for (const patch of [
  { integrationId: 'app-b' },
  { credentialVersion: 2 },
  { externalSubject: 'member-b' },
]) {
  assert.notEqual(notificationAggregationIdentity({ ...wecom, ...patch }, lead)?.key, wecomKey)
}
assert.equal(notificationAggregationIdentity({ ...wecom, externalSubject: '' }, lead), null)
assert.equal(notificationAggregationIdentity({ ...wecom, credentialVersion: -1 }, lead), null)
console.log(
  'Message aggregation: all registered events, safe default, priority, fixed window and scope isolation passed.',
)
