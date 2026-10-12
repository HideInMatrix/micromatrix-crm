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

test('首页组件支持跨线索和客户选择动态字段，并拒绝无效字段、重复 ID 与隐藏字段', async () => {
  const service = Object.create(ModuleFormsService.prototype) as unknown as {
    listFields: (_org: string, module: string) => Promise<FieldVO[]>
    validateHomeWidgets: (org: string, widgets: Array<{
      id: string; title: string; module: 'lead' | 'customer'; fieldKey: string;
      chartType: 'donut' | 'bar' | 'list'; period?: '7d' | '30d' | 'all'
    }>) => Promise<void>
  }
  service.listFields = async (_org, module) => module === 'lead'
    ? [field('source_a', 'select'), { ...field('hidden', 'radio'), hidden: true }]
    : [field('customer_category', 'radio')]
  const lead = { id: 'source-widget', title: '渠道', module: 'lead' as const, fieldKey: 'source_a', chartType: 'donut' as const }
  const customer = { id: 'customer-widget', title: '客户类型', module: 'customer' as const, fieldKey: 'customer_category', chartType: 'bar' as const }
  await assert.doesNotReject(() => service.validateHomeWidgets('org', [lead, customer]))
  await assert.rejects(() => service.validateHomeWidgets('org', [lead, { ...lead }]), BadRequestException)
  await assert.rejects(() => service.validateHomeWidgets('org', [{ ...lead, fieldKey: 'hidden' }]), BadRequestException)
  await assert.rejects(() => service.validateHomeWidgets('org', [{ ...lead, fieldKey: 'non-existent' }]), BadRequestException)
})
