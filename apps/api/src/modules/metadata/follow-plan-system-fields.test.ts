import assert from 'node:assert/strict'
import test from 'node:test'
import { MODULE_SYSTEM_FIELDS } from './system-fields'

test('FollowPlan FormDesign 模板包含稳定的意向产品多选数据源字段', () => {
  const fields = MODULE_SYSTEM_FIELDS.followPlan ?? []
  const planProduct = fields.find((field) => field.key === 'planProduct')
  assert.ok(planProduct)
  assert.equal(planProduct.type, 'data_source_multiple')
  assert.equal(planProduct.system, false)
  assert.equal(planProduct.mobile, true)
  assert.equal(planProduct.config?.dataSourceType, 'PRODUCT')
})

test('FollowPlan 创建表单 metadata 对齐 datetime/method/status 边界', () => {
  const fields = MODULE_SYSTEM_FIELDS.followPlan ?? []
  assert.equal(fields.find((field) => field.key === 'estimatedAt')?.type, 'datetime')
  assert.equal(fields.find((field) => field.key === 'method')?.type, 'select')
  assert.equal(fields.find((field) => field.key === 'status')?.hidden, true)
})
