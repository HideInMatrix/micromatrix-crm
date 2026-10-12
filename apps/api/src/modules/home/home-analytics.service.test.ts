import assert from 'node:assert/strict'
import test from 'node:test'
import type { FieldVO } from '@micromatrix/shared'
import { HomeAnalyticsService } from './home-analytics.service'

test('首页阶段漏斗按 Stage Event 去重，并为迁移前无事件 Lead 回退当前阶段', () => {
  const service = Object.create(HomeAnalyticsService.prototype) as unknown as {
    funnel: (
      stages: Array<{
        key: string
        name: string
        kind: 'ACTIVE' | 'SUCCESS' | 'FAILURE'
      }>,
      leads: Array<{ id: string; stage: string }>,
      events: Array<{
        leadId: string
        fromStageKey: string | null
        toStageKey: string
      }>,
    ) => Array<{ stageKey: string; count: number }>
  }
  const stages = [
    { key: 'NEW', name: '新线索', kind: 'ACTIVE' as const },
    { key: 'VISITED', name: '已到访', kind: 'ACTIVE' as const },
    { key: 'SUCCESS', name: '已转化', kind: 'SUCCESS' as const },
  ]
  const leads = [
    { id: 'lead-1', stage: 'SUCCESS' },
    { id: 'lead-2', stage: 'VISITED' },
  ]
  const events = [
    { leadId: 'lead-1', fromStageKey: null, toStageKey: 'NEW' },
    { leadId: 'lead-1', fromStageKey: 'NEW', toStageKey: 'VISITED' },
    { leadId: 'lead-1', fromStageKey: 'VISITED', toStageKey: 'SUCCESS' },
    { leadId: 'lead-1', fromStageKey: 'VISITED', toStageKey: 'SUCCESS' },
  ]

  const result = service.funnel(stages, leads, events)
  assert.deepEqual(
    result.map((item) => [item.stageKey, item.count]),
    [
      ['NEW', 1],
      ['VISITED', 2],
      ['SUCCESS', 1],
    ],
  )
})

function field(key: string): FieldVO {
  return {
    id: key,
    module: 'customer',
    key,
    label: key,
    type: 'text',
    system: false,
    hidden: false,
    required: false,
    showInList: true,
    mobile: true,
    options: null,
    config: null,
    sort: 1,
    span: 12,
    listWidth: null,
  }
}

function analyticsService(customerHomeAnalytics: Record<string, unknown> | undefined) {
  const moduleForms = {
    getConfig: async (_tenantId: string, formKey: string) =>
      formKey === 'lead'
        ? {
            formKey: 'lead',
            formProp: {
              homeAnalytics: {
                customerResultFieldKey: 'cf_legacy_result',
              },
            },
            fields: [],
          }
        : {
            formKey: 'customer',
            formProp:
              customerHomeAnalytics === undefined
                ? {}
                : { homeAnalytics: customerHomeAnalytics },
            fields: [field('cf_legacy_result')],
          },
  }
  const service = new HomeAnalyticsService(
    {} as never,
    { resolve: async () => ({ all: true, userIds: null }) } as never,
    moduleForms as never,
    { load: async () => new Map() } as never,
    { overdue: async () => [] } as never,
  )
  const mutable = service as unknown as Record<string, unknown>
  mutable['loadLeads'] = async () => []
  mutable['loadCustomers'] = async () => []
  mutable['loadStageEvents'] = async () => []
  mutable['ownerNames'] = async () => new Map()
  return service
}

test('Customer 尚无配置时兼容旧 Lead 结果配置，但 Customer 空配置会明确关闭旧回退', async () => {
  const request = { searchType: 'SELF', deptIds: [] } as never
  const user = { tenantId: 'tenant-a', id: 'user-a' } as never

  const legacy = await analyticsService(undefined).overview(user, request)
  assert.equal(legacy.config.customerResultField?.key, 'cf_legacy_result')

  const explicitCustomer = await analyticsService({}).overview(user, request)
  assert.equal(explicitCustomer.config.customerResultField, null)
})

test('动态统计组件按单选字段选项分组，仅计入近7天并正确统计未填写', () => {
  const service = Object.create(HomeAnalyticsService.prototype) as unknown as {
    widgetDistribution: (
      config: { id: string; title: string; module: 'lead'; fieldKey: string; chartType: 'donut'; period: '7d' | 'all' },
      field: FieldVO,
      rows: Array<{ id: string; createTime: bigint }>,
      values: Map<string, Record<string, unknown>>,
      period: '7d' | '30d' | 'all',
      now: number,
    ) => { total: number; period: string; config: { period?: string }; items: Array<{ label: string; value: string; count: number }> }
  }
  const now = Date.UTC(2026, 9, 10, 8)
  const rows = [
    { id: 'a', createTime: BigInt(now - 1_000) },
    { id: 'b', createTime: BigInt(now - 3 * 86_400_000) },
    { id: 'c', createTime: BigInt(now - 2 * 86_400_000) },
    { id: 'old', createTime: BigInt(now - 10 * 86_400_000) },
    { id: 'future', createTime: BigInt(now + 60_000) },
  ]
  const source = { ...field('cf_custom_source'), module: 'lead', label: '自定义来源', type: 'select' as const,
    options: [{ label: '转介绍', value: 'REFERRAL' }, { label: '官网', value: 'WEB' }] }
  const values = new Map([
    ['a', { cf_custom_source: 'WEB' }],
    ['b', { cf_custom_source: 'WEB' }],
    ['old', { cf_custom_source: 'REFERRAL' }],
    ['future', { cf_custom_source: 'WEB' }],
  ])
  const config = { id: 'w-1', title: '自定义来源分析', module: 'lead' as const, fieldKey: 'cf_custom_source', chartType: 'donut' as const, period: '7d' as const }
  const recent = service.widgetDistribution(config, source, rows, values, '7d', now)
  assert.equal(recent.total, 3)
  assert.equal(recent.period, '7d')
  assert.equal(recent.config.period, undefined)
  assert.deepEqual(recent.items.map(({ label, count }) => [label, count]), [
    ['官网', 2],
    ['未填写', 1],
    ['转介绍', 0], // 字段选项未被选中也必须留在图例中
  ])
  const all = service.widgetDistribution(config, source, rows, values, 'all', now)
  assert.equal(all.total, 5)
  assert.equal(all.period, 'all')
  assert.equal(all.items.find((item) => item.label === '转介绍')?.count, 1)
})


test('首页统计拒绝非法临时时间筛选，且不需要读取任何业务数据', async () => {
  const service = Object.create(HomeAnalyticsService.prototype) as HomeAnalyticsService
  const user = { tenantId: 'tenant-a', id: 'user-a' } as never
  const invalid = [
    { 'widget-1': '365d' },
    { 'widget-1': null },
    { 'widget-1': '7d', '../../other': '30d' },
    Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`widget-${i}`, '7d'])),
  ]
  for (const widgetPeriods of invalid) {
    await assert.rejects(
      () => service.overview(user, { searchType: 'SELF', deptIds: [], widgetPeriods } as never),
      { message: '首页统计时间范围无效' },
    )
  }
})
