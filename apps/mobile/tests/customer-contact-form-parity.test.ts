import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeAlertFields, type FieldVO, type ModuleFormProp } from '@micromatrix/shared'
import { visibleMobileFormFields } from '../src/utils/mobile-form-fields'
import { firstMissingRequiredContactField, contactFormToPayload } from '../src/utils/contact-form'
import {
  firstMissingRequiredCustomerField,
  customerFormToPayload,
} from '../src/utils/customer-form'

function field(
  module: string,
  key: string,
  type: FieldVO['type'] = 'text',
  extra: Partial<FieldVO> = {},
): FieldVO {
  return {
    id: `${module}:${key}`,
    module,
    key,
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

const formProp: ModuleFormProp = {
  alerts: [
    { id: 'notice', position: 1, icon: 'info', text: '提示', color: '#409eff', fontSize: 14 },
  ],
  labelStyle: { color: '#ff0000', fontSize: 20 },
  labelPos: 'left',
}

for (const module of ['customer', 'contact'] as const) {
  test(`${module} 保持 PC 表单字段和 Alert 顺序，忽略 PC 字段宽度样式`, () => {
    const fields = [
      field(module, 'name', 'text', { required: true, span: 24 }),
      field(module, 'phone', 'phone', { span: 6 }),
      field(module, 'hidden', 'text', { hidden: true }),
      field(module, 'pcOnly', 'text', { mobile: false }),
      field(module, 'formula', 'formula', { config: { formula: '1 + 2' } }),
    ]
    const actual = visibleMobileFormFields(fields, formProp, { name: '张三' })
    assert.deepEqual(
      actual.map((item) => item.key),
      mergeAlertFields(fields, formProp)
        .filter((item) => !item.hidden && item.mobile !== false)
        .map((item) => item.key),
    )
    assert.equal(actual[1]?.type, 'alert')
    assert.equal(
      actual.some((item) => item.type === 'formula'),
      true,
    )
  })
}

test('客户隐藏的必填字段不拦截，展示组件不进入提交数据', () => {
  const fields = [
    field('customer', 'name', 'text', { required: true }),
    field('customer', 'phone', 'phone', { required: true, hidden: true }),
  ]
  assert.equal(firstMissingRequiredCustomerField({ name: '客户' }, fields, formProp), undefined)
  const payload = customerFormToPayload({ name: '客户' })
  assert.equal(payload.name, '客户')
  assert.equal(JSON.stringify(payload).includes('alert:'), false)
})

test('联系人关联客户字段遵循设计器顺序与移动端显示开关', () => {
  const fields = [
    field('contact', 'name', 'text', { required: true }),
    field('contact', 'phone', 'phone'),
    field('contact', 'customerId', 'text', { required: true, system: true }),
  ]
  const actual = visibleMobileFormFields(fields, formProp, {
    name: '联系人',
    customerId: 'customer-1',
  })
  assert.deepEqual(
    actual.map((item) => item.key),
    ['name', 'alert:notice', 'phone', 'customerId'],
  )
  assert.equal(
    firstMissingRequiredContactField({ name: '联系人' }, fields, formProp)?.key,
    'customerId',
  )
  assert.equal(
    firstMissingRequiredContactField(
      { name: '联系人', customerId: 'customer-1' },
      fields,
      formProp,
    ),
    undefined,
  )
  assert.deepEqual(contactFormToPayload({ name: '联系人', customerId: 'customer-1' }), {
    name: '联系人',
    customerId: 'customer-1',
  })
  const hidden = fields.map((item) =>
    item.key === 'customerId' ? { ...item, mobile: false } : item,
  )
  assert.equal(
    visibleMobileFormFields(hidden, formProp, { name: '联系人' }).some(
      (item) => item.key === 'customerId',
    ),
    false,
  )
  assert.equal(firstMissingRequiredContactField({ name: '联系人' }, hidden, formProp), undefined)
})
