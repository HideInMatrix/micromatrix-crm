import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import type { BusinessNotificationsService } from './business-notifications.service'
import { MessageExpiryService } from './message-expiry.service'

type QueryKind = 'quotation' | 'payment' | 'contract'

interface RawQueryHarness {
  sql: string
  values: unknown[]
  returnsRow: () => RawQueryHarness
  build: () => RawQueryHarness
}

function prisma8Fixture(options: {
  quotation?: (values: unknown[], sql: string) => unknown[]
  payment?: (values: unknown[], sql: string) => unknown[]
  contract?: (values: unknown[], sql: string) => unknown[]
  onQuery?: (kind: QueryKind, values: unknown[], sql: string) => void
} = {}) {
  const columns = {
    opportunity_quotation: {
      columns: { id: {}, name: {}, create_user: {}, until_time: {} },
    },
    contract_payment_plan: {
      columns: { id: {}, name: {}, owner: {}, create_user: {}, plan_end_time: {} },
    },
    contract: { columns: { id: {}, name: {}, owner: {}, create_user: {}, end_time: {} } },
    customer: { columns: { name: {} } },
  }
  return {
    client: {
      orm: {
        public: {
          Tenants: {
            select() {
              return this
            },
            all: async () => [],
          },
        },
      },
      raw: {
        sql(strings: TemplateStringsArray, ...values: unknown[]) {
          const query: RawQueryHarness = {
            sql: strings.join('?'),
            values,
            returnsRow() {
              return this
            },
            build() {
              return this
            },
          }
          return query
        },
      },
      sql: { public: columns },
      runtime: () => ({
        query: async function* (query: RawQueryHarness) {
          let kind: QueryKind
          let rows: unknown[]
          if (query.sql.includes('FROM opportunity_quotation AS quotation')) {
            kind = 'quotation'
            rows = options.quotation?.(query.values, query.sql) ?? []
          } else if (query.sql.includes('FROM contract_payment_plan AS plan')) {
            kind = 'payment'
            rows = options.payment?.(query.values, query.sql) ?? []
          } else {
            kind = 'contract'
            rows = options.contract?.(query.values, query.sql) ?? []
          }
          options.onQuery?.(kind, query.values, query.sql)
          yield* rows
        },
      }),
    },
  } as unknown as Prisma8Service
}

test('到期执行器按配置提前天数发送并过滤已足额回款', async () => {
  const events: string[] = []
  const day = (value: Date) => value.getDate()
  const prisma = prisma8Fixture({
    quotation: (values) =>
      day(new Date(Number(values[1]))) === 27
        ? [
            {
              id: 'quote-a',
              name: '年度报价',
              createUser: 'owner-a',
              untilTime: BigInt(new Date(2026, 7, 27).getTime()),
              customerName: '示例客户',
            },
          ]
        : [],
    payment: (values) =>
      day(new Date(Number(values[1]))) === 24
        ? [
            {
              id: 'plan-a',
              name: '年度合同回款计划',
              owner: 'owner-a',
              createUser: 'owner-a',
              planEndTime: BigInt(new Date(2026, 7, 24).getTime()),
              contractName: '年度合同',
              customerName: '示例客户',
            },
          ]
        : [],
  })
  const settings = {
    getEffectiveSetting: async (_tenantId: string, event: string) => ({
      systemEnabled: true,
      config: event.endsWith('_EXPIRING')
        ? { timeList: [{ timeValue: 3, timeUnit: 'DAY' }] }
        : { timeList: [] },
    }),
  } as unknown as MessageSettingsService
  const notifications = {
    sendConfigured: async ({ event }: { event: string }) => {
      events.push(event)
      return 1
    },
  } as unknown as BusinessNotificationsService
  const service = new MessageExpiryService(prisma, settings, notifications)

  const delivered = await service.runTenant('tenant-a', new Date(2026, 7, 24, 10))

  assert.equal(delivered, 2)
  assert.deepEqual(events, ['BUSINESS_QUOTATION_EXPIRING', 'CONTRACT_PAYMENT_EXPIRED'])
})

test('关闭事件或清空提前时间时不查询业务数据', async () => {
  let queried = false
  const prisma = prisma8Fixture({ onQuery: () => (queried = true) })
  const settings = {
    getEffectiveSetting: async (_tenantId: string, event: string) => ({
      systemEnabled: event.endsWith('_EXPIRING'),
      config: { timeList: [] },
    }),
  } as unknown as MessageSettingsService
  const service = new MessageExpiryService(prisma, settings, {} as BusinessNotificationsService)

  assert.equal(await service.runTenant('tenant-a', new Date(2026, 7, 24, 10)), 0)
  assert.equal(queried, false)
})

test('到期执行器严格保持 Cordys 六个事件且不增加发票到期分支', async () => {
  const events: string[] = []
  const settings = {
    getEffectiveSetting: async (_tenantId: string, event: string) => {
      events.push(event)
      return { systemEnabled: false, config: { timeList: [] } }
    },
  } as unknown as MessageSettingsService
  const service = new MessageExpiryService(
    prisma8Fixture(),
    settings,
    {} as BusinessNotificationsService,
  )

  assert.equal(await service.runTenant('tenant-a', new Date(2026, 7, 24, 10)), 0)
  assert.deepEqual(events, [
    'BUSINESS_QUOTATION_EXPIRING',
    'BUSINESS_QUOTATION_EXPIRED',
    'CONTRACT_EXPIRING',
    'CONTRACT_EXPIRED',
    'CONTRACT_PAYMENT_EXPIRING',
    'CONTRACT_PAYMENT_EXPIRED',
  ])
  assert.equal(
    events.some((event) => event.includes('INVOICE')),
    false,
  )
})

test('合同到期按 3/7 天和当天窗口分别发送且通过 SQL 排除 END 阶段合同', async () => {
  const windows: number[] = []
  const sqls: string[] = []
  const delivered: Array<{
    event: string
    templateContext?: Record<string, unknown>
  }> = []
  const prisma = prisma8Fixture({
    contract: (values, sql) => {
      const day = new Date(Number(values[1])).getDate()
      windows.push(day)
      sqls.push(sql)
      return [
        {
          id: `contract-${day}`,
          name: `合同-${day}`,
          owner: 'owner-a',
          createUser: 'creator-a',
          endTime: values[1] as bigint,
          customerName: '示例客户',
        },
      ]
    },
  })
  const settings = {
    getEffectiveSetting: async (_tenantId: string, event: string) => ({
      systemEnabled: event.startsWith('CONTRACT_'),
      config:
        event === 'CONTRACT_EXPIRING'
          ? {
              timeList: [
                { timeValue: 3, timeUnit: 'DAY' },
                { timeValue: 7, timeUnit: 'DAY' },
              ],
            }
          : { timeList: [] },
    }),
  } as unknown as MessageSettingsService
  const notifications = {
    sendConfigured: async (input: { event: string; templateContext?: Record<string, unknown> }) => {
      delivered.push(input)
      return 1
    },
  } as unknown as BusinessNotificationsService
  const service = new MessageExpiryService(prisma, settings, notifications)

  assert.equal(await service.runTenant('tenant-a', new Date(2026, 7, 24, 10)), 3)
  assert.deepEqual(windows, [27, 31, 24])
  assert.ok(sqls.every((sql) => sql.includes('NOT EXISTS')))
  assert.ok(sqls.every((sql) => sql.includes("stage.type = 'END'")))
  assert.deepEqual(
    delivered.map((item) => item.event),
    ['CONTRACT_EXPIRING', 'CONTRACT_EXPIRING', 'CONTRACT_EXPIRED'],
  )
  assert.deepEqual(delivered[0]?.templateContext, {
    customerName: '示例客户',
    name: '示例客户',
    expireDays: 3,
  })
  assert.deepEqual(delivered[1]?.templateContext, {
    customerName: '示例客户',
    name: '示例客户',
    expireDays: 7,
  })
  assert.deepEqual(delivered[2]?.templateContext, {
    customerName: '示例客户',
    name: '示例客户',
    expireDays: 0,
  })
})

test('报价/合同/回款计划到期通知携带 direct createUser，且回款计划使用独立负责人', async () => {
  const delivered: Array<{
    event: string
    ownerId?: string | null
    createUserId?: string | null
  }> = []
  const prisma = prisma8Fixture({
    quotation: (values) => [
      {
        id: 'quote-a',
        name: '报价A',
        createUser: 'quote-creator',
        untilTime: values[1] as bigint,
        customerName: '客户A',
      },
    ],
    payment: (values) => [
      {
        id: 'plan-a',
        name: '计划A',
        owner: 'plan-owner',
        createUser: 'plan-creator',
        planEndTime: values[1] as bigint,
        contractName: '合同A',
        customerName: '客户A',
      },
    ],
    contract: (values) => [
      {
        id: 'contract-a',
        name: '合同A',
        owner: 'contract-owner',
        createUser: 'contract-creator',
        endTime: values[1] as bigint,
        customerName: '客户A',
      },
    ],
  })
  const settings = {
    getEffectiveSetting: async (_tenantId: string, event: string) => ({
      systemEnabled: event.endsWith('_EXPIRING'),
      config: event.endsWith('_EXPIRING')
        ? { timeList: [{ timeValue: 1, timeUnit: 'DAY' }] }
        : { timeList: [] },
    }),
  } as unknown as MessageSettingsService
  const notifications = {
    sendConfigured: async (input: {
      event: string
      ownerId?: string | null
      createUserId?: string | null
    }) => {
      delivered.push(input)
      return 1
    },
  } as unknown as BusinessNotificationsService
  const service = new MessageExpiryService(prisma, settings, notifications)

  assert.equal(await service.runTenant('tenant-a', new Date(2026, 7, 24, 10)), 3)
  assert.deepEqual(
    delivered.map(({ event, ownerId, createUserId }) => ({ event, ownerId, createUserId })),
    [
      {
        event: 'BUSINESS_QUOTATION_EXPIRING',
        ownerId: 'quote-creator',
        createUserId: 'quote-creator',
      },
      {
        event: 'CONTRACT_EXPIRING',
        ownerId: 'contract-owner',
        createUserId: 'contract-creator',
      },
      {
        event: 'CONTRACT_PAYMENT_EXPIRING',
        ownerId: 'plan-owner',
        createUserId: 'plan-creator',
      },
    ],
  )
})
