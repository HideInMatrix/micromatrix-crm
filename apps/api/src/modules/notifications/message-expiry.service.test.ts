import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import type { BusinessNotificationsService } from './business-notifications.service'
import { MessageExpiryService } from './message-expiry.service'

test('到期执行器按配置提前天数发送并过滤已足额回款', async () => {
  const events: string[] = []
  const day = (value: Date) => value.getDate()
  const prisma = {
    opportunityQuotation: {
      findMany: async ({ where }: { where: { untilTime: { gte: bigint } } }) =>
        day(new Date(Number(where.untilTime.gte))) === 27
          ? [
              {
                id: 'quote-a',
                name: '年度报价',
                createUser: 'owner-a',
                untilTime: BigInt(new Date(2026, 7, 27).getTime()),
              },
            ]
          : [],
    },
    contractStageConfig: { findMany: async () => [] },
    contract: { findMany: async () => [] },
    receivablePlan: {
      findMany: async ({ where }: { where: { dueDate: { gte: Date } } }) =>
        day(where.dueDate.gte) === 24
          ? [
              {
                period: 1,
                amount: 100,
                dueDate: new Date(2026, 7, 24),
                contract: { name: '年度合同', owner: 'owner-a' },
                records: [{ amount: 40, approvalStatus: 'APPROVED' }],
              },
              {
                period: 2,
                amount: 100,
                dueDate: new Date(2026, 7, 24),
                contract: { name: '已回款合同', owner: 'owner-b' },
                records: [{ amount: 100, approvalStatus: 'APPROVED' }],
              },
            ]
          : [],
    },
  } as unknown as PrismaService
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
  const prisma = {
    opportunityQuotation: { findMany: async () => ((queried = true), []) },
    contract: { findMany: async () => ((queried = true), []) },
    receivablePlan: { findMany: async () => ((queried = true), []) },
  } as unknown as PrismaService
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

test('合同到期按 3/7 天和当天窗口分别发送且排除 END 阶段合同', async () => {
  const windows: Array<{ day: number; excludedStages: string[] }> = []
  const delivered: Array<{ event: string; title: string; content?: string }> = []
  const prisma = {
    opportunityQuotation: { findMany: async () => [] },
    receivablePlan: { findMany: async () => [] },
    contractStageConfig: {
      findMany: async () => [{ id: 'stage-end' }],
    },
    contract: {
      findMany: async ({
        where,
      }: {
        where: { stage: { notIn: string[] }; endTime: { gte: bigint } }
      }) => {
        windows.push({
          day: new Date(Number(where.endTime.gte)).getDate(),
          excludedStages: where.stage.notIn,
        })
        return [
          {
            id: `contract-${new Date(Number(where.endTime.gte)).getDate()}`,
            name: `合同-${new Date(Number(where.endTime.gte)).getDate()}`,
            owner: 'owner-a',
            endTime: where.endTime.gte,
          },
        ]
      },
    },
  } as unknown as PrismaService
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
    sendConfigured: async (input: { event: string; title: string; content?: string }) => {
      delivered.push(input)
      return 1
    },
  } as unknown as BusinessNotificationsService
  const service = new MessageExpiryService(prisma, settings, notifications)

  assert.equal(await service.runTenant('tenant-a', new Date(2026, 7, 24, 10)), 3)
  assert.deepEqual(windows, [
    { day: 27, excludedStages: ['stage-end'] },
    { day: 31, excludedStages: ['stage-end'] },
    { day: 24, excludedStages: ['stage-end'] },
  ])
  assert.deepEqual(
    delivered.map((item) => item.event),
    ['CONTRACT_EXPIRING', 'CONTRACT_EXPIRING', 'CONTRACT_EXPIRED'],
  )
  assert.match(delivered[0].content ?? '', /3 天后/)
  assert.match(delivered[1].content ?? '', /7 天后/)
  assert.equal(delivered[2].title, '合同已到期')
})
