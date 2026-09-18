import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import type { BusinessNotificationsService } from './business-notifications.service'
import { MessageExpiryService } from './message-expiry.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'MessageExpiry 由 Prisma 8 raw 读取报价/合同/回款计划并排除 END 阶段合同',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const actor = `u${suffix}`.slice(0, 32)
    const now = new Date(2026, 8, 16, 10, 0, 0, 0)
    const dueAt = BigInt(new Date(2026, 8, 16, 12, 0, 0, 0).getTime())
    const baseTime = BigInt(now.getTime())

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 expiry ${suffix}`, slug: `p8-expiry-${suffix}` },
      })
      tenantId = tenant.id
      const customer = await fixtureDb.customer.create({
        data: {
          name: '到期测试客户',
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      const opportunityStage = await fixtureDb.opportunityStageConfig.create({
        data: {
          name: '跟进',
          type: 'AFOOT',
          rate: '50',
          pos: 1n,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      const opportunity = await fixtureDb.opportunity.create({
        data: {
          customerId: customer.id,
          name: '到期测试商机',
          organizationId: tenant.id,
          stage: opportunityStage.id,
          owner: actor,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      await fixtureDb.opportunityQuotation.create({
        data: {
          name: '到期测试报价',
          opportunityId: opportunity.id,
          untilTime: dueAt,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })

      const activeStage = await fixtureDb.contractStageConfig.create({
        data: {
          name: '履约中',
          type: 'AFOOT',
          pos: 1n,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      const endStage = await fixtureDb.contractStageConfig.create({
        data: {
          name: '已结束',
          type: 'END',
          pos: 2n,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      const contract = await fixtureDb.contract.create({
        data: {
          name: '到期测试合同',
          customerId: customer.id,
          owner: actor,
          number: `C-${suffix}`.slice(0, 50),
          stage: activeStage.id,
          endTime: dueAt,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      await fixtureDb.contract.create({
        data: {
          name: '不应通知的结束合同',
          customerId: customer.id,
          owner: actor,
          number: `END-${suffix}`.slice(0, 50),
          stage: endStage.id,
          endTime: dueAt,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })
      await fixtureDb.contractPaymentPlan.create({
        data: {
          name: '到期测试回款计划',
          contractId: contract.id,
          owner: actor,
          planEndTime: dueAt,
          organizationId: tenant.id,
          createTime: baseTime,
          updateTime: baseTime,
          createUser: actor,
          updateUser: actor,
        },
      })

      const delivered: Array<{ event: string; ownerId: string | null | undefined }> = []
      const settings = {
        getEffectiveSetting: async (_tenantId: string, event: string) => ({
          systemEnabled: event.endsWith('_EXPIRED'),
          config: { timeList: [] },
        }),
      } as unknown as MessageSettingsService
      const notifications = {
        sendConfigured: async (input: { event: string; ownerId?: string | null }) => {
          delivered.push({ event: input.event, ownerId: input.ownerId })
          return 1
        },
      } as unknown as BusinessNotificationsService
      const service = new MessageExpiryService(
        { client: prisma8Client } as Prisma8Service,
        settings,
        notifications,
      )

      assert.equal(await service.runTenant(tenant.id, now), 3)
      assert.deepEqual(
        delivered.map(({ event }) => event),
        [
          'BUSINESS_QUOTATION_EXPIRED',
          'CONTRACT_EXPIRED',
          'CONTRACT_PAYMENT_EXPIRED',
        ],
      )
      assert.ok(delivered.every(({ ownerId }) => ownerId === actor))
    } finally {
      if (tenantId) {
        await fixtureDb.contractPaymentPlan.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.opportunityQuotation.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.contract.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.opportunity.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.contractStageConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.opportunityStageConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
