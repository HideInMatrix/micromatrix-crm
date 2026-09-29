import assert from 'node:assert/strict'
import test from 'node:test'
import { MODULE_SYSTEM_FIELDS } from './system-fields'

test('FollowPlan 创建表单 metadata 对齐 datetime/method/status 边界', () => {
  const fields = MODULE_SYSTEM_FIELDS.followPlan ?? []
  assert.equal(fields.find((field) => field.key === 'estimatedAt')?.type, 'datetime')
  assert.equal(fields.find((field) => field.key === 'method')?.type, 'select')
  assert.equal(fields.find((field) => field.key === 'status')?.hidden, true)
})
