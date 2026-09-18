import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import type { BusinessNotificationsService } from './business-notifications.service'
import { MessageExpiryService } from './message-expiry.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'MessageExpiry 由 Prisma raw 读取报价/合同/回款计划并排除 END 阶段合同',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const actor = `u${suffix}`.slice(0, 32)
    const now = new Date(2026, 8, 16, 10, 0, 0, 0)
    const dueAt = BigInt(new Date(2026, 8, 16, 12, 0, 0, 0).getTime())
    const baseTime = BigInt(now.getTime())

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-expiry')
      tenantId = tenant.id
      const organizationId = tenant.id
      const actorId = actor
      const customer = await prismaClient.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: '到期测试客户',
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      const opportunityStage = await prismaClient.orm.public.OpportunityStageConfig.select(
        'id',
      ).create({
        id: createLegacyId32(),
        name: '跟进',
        _type: 'AFOOT',
        rate: '50',
        pos: 1n,
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      const opportunity = await prismaClient.orm.public.Opportunity.select('id').create({
        id: createLegacyId32(),
        customerId: customer.id,
        name: '到期测试商机',
        organizationId,
        stage: opportunityStage.id,
        owner: actorId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      await prismaClient.orm.public.OpportunityQuotation.create({
        id: createLegacyId32(),
        name: '到期测试报价',
        opportunityId: opportunity.id,
        untilTime: dueAt,
        amount: numericValue(decimalString(0, 14, 2), 14, 2),
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })

      const activeStage = await prismaClient.orm.public.ContractStageConfig.select('id').create({
        id: createLegacyId32(),
        name: '履约中',
        _type: 'AFOOT',
        pos: 1n,
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      const endStage = await prismaClient.orm.public.ContractStageConfig.select('id').create({
        id: createLegacyId32(),
        name: '已结束',
        _type: 'END',
        pos: 2n,
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      const contract = await prismaClient.orm.public.Contract.select('id').create({
        id: createLegacyId32(),
        name: '到期测试合同',
        customerId: customer.id,
        owner: actorId,
        amount: numericValue(decimalString(0, 14, 2), 14, 2),
        number: `C-${suffix}`.slice(0, 50),
        stage: activeStage.id,
        endTime: dueAt,
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      await prismaClient.orm.public.Contract.create({
        id: createLegacyId32(),
        name: '不应通知的结束合同',
        customerId: customer.id,
        owner: actorId,
        amount: numericValue(decimalString(0, 14, 2), 14, 2),
        number: `END-${suffix}`.slice(0, 50),
        stage: endStage.id,
        endTime: dueAt,
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
      })
      await prismaClient.orm.public.ContractPaymentPlan.create({
        id: createLegacyId32(),
        name: '到期测试回款计划',
        contractId: contract.id,
        owner: actorId,
        planEndTime: dueAt,
        organizationId,
        createTime: baseTime,
        updateTime: baseTime,
        createUser: actorId,
        updateUser: actorId,
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
        { client: prismaClient } as PrismaService,
        settings,
        notifications,
      )

      assert.equal(await service.runTenant(tenant.id, now), 3)
      assert.deepEqual(
        delivered.map(({ event }) => event),
        ['BUSINESS_QUOTATION_EXPIRED', 'CONTRACT_EXPIRED', 'CONTRACT_PAYMENT_EXPIRED'],
      )
      assert.ok(delivered.every(({ ownerId }) => ownerId === actor))
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prismaClient.orm.public.ContractPaymentPlan.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.OpportunityQuotation.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Contract.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Opportunity.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.ContractStageConfig.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.OpportunityStageConfig.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Customer.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
