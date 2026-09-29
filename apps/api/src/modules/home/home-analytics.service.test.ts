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
