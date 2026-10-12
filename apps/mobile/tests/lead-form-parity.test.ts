import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeAlertFields, type FieldVO, type ModuleFormProp } from '@micromatrix/shared'
import { visibleMobileFormFields } from '../src/utils/mobile-form-fields'
import { firstMissingRequiredLeadField, leadFormToPayload } from '../src/utils/lead-form'

function field(key: string, type: FieldVO['type'] = 'text', extra: Partial<FieldVO> = {}): FieldVO {
  return {
    id: key,
    key,
    module: 'lead',
    label: key,
    type,
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: {},
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    ...extra,
  }
}

const fields = [
  field('name', 'text', { required: true }),
  field('channel', 'select', {
    config: { showControlRules: [{ value: 'online', fieldIds: ['phone'] }] },
  }),
  field('phone', 'phone', { required: true }),
  field('calc', 'formula', { config: { formula: '1 + 2' } }),
  field('table', 'sub_product', { subFields: [field('cell')] }),
  field('hidden', 'text', { hidden: true }),
  field('pcOnly', 'text', { mobile: false }),
]
const formProp: ModuleFormProp = {
  alerts: [
    {
      id: 'notice',
      position: 0,
      icon: 'info',
      text: '手机号查重提醒',
      color: '#409eff',
      backgroundColor: '#e6f7ff',
      fontSize: 14,
    },
  ],
  labelStyle: { fontSize: 20, color: '#ff0000' },
  labelPos: 'left',
  viewSize: 'large',
}

test('PC 与移动端使用同一表单项配置和排序，移动端不使用 PC 布局', () => {
  const values = { name: '学员', channel: 'online', phone: '13300000000' }
  const expected = mergeAlertFields(fields, formProp)
    .filter((f) => !f.hidden && f.mobile !== false)
    .map((f) => f.key)
  const actual = visibleMobileFormFields(fields, formProp, values)
  assert.deepEqual(
    actual.map((f) => f.key),
    expected,
  )
  assert.deepEqual(actual.map((f) => f.type).slice(0, 2), ['alert', 'text'])
  assert.ok(actual.some((f) => f.type === 'formula'))
  assert.ok(actual.some((f) => f.type === 'sub_product'))
  assert.equal(actual[0]?.config?.alertBackgroundColor, '#e6f7ff')
  assert.equal(actual.find((f) => f.key === 'name')?.span, 12)
})

test('移动端遵循 PC 条件显隐和显式移动端显示开关，隐藏必填不拦截保存', () => {
  const values = { name: '学员', channel: 'offline' }
  const visible = visibleMobileFormFields(fields, formProp, values)
  assert.equal(
    visible.some((f) => f.key === 'phone'),
    false,
  )
  assert.equal(
    visible.some((f) => f.key === 'pcOnly'),
    false,
  )
  assert.equal(firstMissingRequiredLeadField(values, fields, formProp), undefined)
  assert.equal(
    firstMissingRequiredLeadField({ ...values, channel: 'online' }, fields, formProp)?.key,
    'phone',
  )
})

test('展示组件不会进入提交数据，业务字段值保持原样', () => {
  const values = { name: '学员', channel: 'online', phone: '13300000000' }
  const payload = leadFormToPayload(values, fields)
  assert.equal(payload.name, '学员')
  assert.equal(payload.phone, '13300000000')
  assert.equal(JSON.stringify(payload).includes('alert:'), false)
})
