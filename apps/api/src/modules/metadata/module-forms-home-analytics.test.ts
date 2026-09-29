import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { FieldVO, HomeAnalyticsConfig } from '@micromatrix/shared'
import { ModuleFormsService } from './module-forms.service'

function field(
  key: string,
  type: FieldVO['type'],
  options?: Array<{ label: string; value: string }>,
): FieldVO {
  return {
    id: key,
    module: 'test',
    key,
    label: key,
    type,
    system: false,
    hidden: false,
    required: false,
    showInList: true,
    mobile: true,
    options: options ?? null,
    config: null,
    sort: 1,
    span: 1,
    listWidth: null,
  }
}

function validator() {
  return Object.create(ModuleFormsService.prototype) as unknown as {
    validateHomeAnalyticsModuleFields: (
      formKey: 'lead' | 'customer',
      config: HomeAnalyticsConfig,
      fields: FieldVO[],
    ) => void
  }
}

test('首页分析分别校验 Lead 渠道与 Customer 结果动态字段', () => {
  const service = validator()
  assert.doesNotThrow(() =>
    service.validateHomeAnalyticsModuleFields(
      'lead',
      { leadSourceFieldKey: 'cf_source' },
      [field('cf_source', 'select', [{ label: '官网', value: 'WEB' }])],
    ),
  )
  assert.doesNotThrow(() =>
    service.validateHomeAnalyticsModuleFields(
      'customer',
      {
        customerResultFieldKey: 'cf_status',
        customerResultValues: ['PAID'],
        customerResultTimeFieldKey: 'cf_paid_at',
        customerResultAmountFieldKey: 'cf_amount',
      },
      [
        field('cf_status', 'select', [{ label: '已缴费', value: 'PAID' }]),
        field('cf_paid_at', 'datetime'),
        field('cf_amount', 'currency'),
      ],
    ),
  )
})

test('首页分析拒绝不适合作为渠道的字段类型和不存在的结果命中值', () => {
  const service = validator()
  assert.throws(
    () =>
      service.validateHomeAnalyticsModuleFields(
        'lead',
        { leadSourceFieldKey: 'cf_source' },
        [field('cf_source', 'data_source')],
      ),
    BadRequestException,
  )
  assert.throws(
    () =>
      service.validateHomeAnalyticsModuleFields(
        'customer',
        {
          customerResultFieldKey: 'cf_status',
          customerResultValues: ['UNKNOWN'],
        },
        [field('cf_status', 'select', [{ label: '已缴费', value: 'PAID' }])],
      ),
    BadRequestException,
  )
})
