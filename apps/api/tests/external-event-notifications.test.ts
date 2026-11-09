import assert from 'node:assert/strict'
import { hasSerializedFieldValueChanges } from '../src/common/field-value-changes'
import { MESSAGE_TEMPLATE_RESOURCES } from '../src/modules/notifications/message-template.resources'
import { MESSAGE_TASK_DEFINITIONS } from '@micromatrix/shared'

const definitions = new Map(MESSAGE_TASK_DEFINITIONS.map((item) => [item.event, item]))
assert.deepEqual(
  [...new Set(MESSAGE_TASK_DEFINITIONS.map((item) => item.module))],
  ['CLUE', 'CUSTOMER'],
  '消息通知模块展示顺序应为线索在前、客户在后',
)

assert.equal(definitions.get('CLUE_ADD')?.defaultSystemEnabled, true)
assert.equal(
  definitions.get('EXTERNAL_EVENT_LEAD_UPDATED')?.defaultSystemEnabled,
  false,
  '外部事件更新线索通知默认关闭，管理员可在消息设置中开启',
)
assert.equal(
  definitions.get('EXTERNAL_EVENT_CUSTOMER_UPDATED')?.defaultSystemEnabled,
  false,
  '外部事件更新客户通知默认关闭，管理员可在消息设置中开启',
)
assert.equal(definitions.get('EXTERNAL_EVENT_LEAD_UPDATED')?.module, 'CLUE')
assert.equal(definitions.get('EXTERNAL_EVENT_CUSTOMER_UPDATED')?.module, 'CUSTOMER')

for (const language of ['zh-CN', 'en-US'] as const) {
  assert.ok(MESSAGE_TEMPLATE_RESOURCES[language].EXTERNAL_EVENT_LEAD_UPDATED)
  assert.ok(MESSAGE_TEMPLATE_RESOURCES[language].EXTERNAL_EVENT_CUSTOMER_UPDATED)
}

assert.equal(
  hasSerializedFieldValueChanges(new Map([['source-id', 'A']]), [
    { fieldId: 'source-id', serialized: 'A' },
  ]),
  false,
)
assert.equal(
  hasSerializedFieldValueChanges(new Map([['source-id', 'A']]), [
    { fieldId: 'source-id', serialized: 'B' },
  ]),
  true,
)
assert.equal(
  hasSerializedFieldValueChanges(new Map(), [{ fieldId: 'source-id', serialized: null }]),
  false,
  '缺失值和空值视为相同',
)
assert.equal(
  hasSerializedFieldValueChanges(new Map([['source-id', 'A']]), [
    { fieldId: 'source-id', serialized: null },
  ]),
  true,
  '清空字段属于真实变更',
)
assert.equal(
  hasSerializedFieldValueChanges(new Map([['tags-id', JSON.stringify(['a', 'b'])]]), [
    { fieldId: 'tags-id', serialized: JSON.stringify(['a', 'b']) },
  ]),
  false,
  '相同的多选值不应重复通知',
)
assert.equal(
  hasSerializedFieldValueChanges(new Map([['date-id', '2026-11-09T00:00:00.000Z']]), [
    { fieldId: 'date-id', serialized: '2026-11-09T00:00:00.000Z' },
  ]),
  false,
  '相同的标准化日期不应重复通知',
)
assert.equal(
  hasSerializedFieldValueChanges(new Map([['number-id', '100']]), [
    { fieldId: 'number-id', serialized: '100' },
  ]),
  false,
  '相同的标准化数字不应重复通知',
)

console.log('External event notification tests passed.')
