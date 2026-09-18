import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { WeComClient } from '../enterprise-integrations/wecom.client'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { MessageDeliveryService } from './message-delivery.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'MessageDelivery outbox 通过 Prisma 8 createAll 保持 fixture readback 与 PENDING/DEAD 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const prisma8Client2 = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    await prisma8Client2.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 outbox ${suffix}`, slug: `p8-outbox-${suffix}` },
      })
      const mappedUser = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Primary Recipient',
          passwordHash: 'not-used',
        },
      })
      const unmappedUser = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Unmapped User',
          passwordHash: 'not-used',
        },
      })
      const integration = await fixtureDb.enterpriseIntegration.create({
        data: {
          tenantId: tenant.id,
          provider: 'WECOM',
          corpId: `corp-${suffix}`,
          agentId: '1000001',
          secretCiphertext: 'ciphertext',
          secretIv: 'iv',
          secretAuthTag: 'tag',
          createdById: mappedUser.id,
          updatedById: mappedUser.id,
        },
      })
      await fixtureDb.externalUserMapping.create({
        data: {
          tenantId: tenant.id,
          provider: 'WECOM',
          externalId: `external-${suffix}`,
          externalKey: `key-${suffix}`,
          userId: mappedUser.id,
        },
      })

      const settings = {
        isWeComEnabled: async () => true,
        isDingTalkEnabled: async () => false,
        isLarkEnabled: async () => false,
        getWeComChannelGate: async () => ({ available: true }),
      } as unknown as MessageSettingsService
      const service = new MessageDeliveryService(
        { client: prisma8Client } as Prisma8Service,
        settings,
        {} as EnterpriseIntegrationsService,
        {} as WeComClient,
      )
      service.processIds = async () => undefined

      const count = await service.enqueue({
        tenantId: tenant.id,
        event: 'CUSTOMER_ADD',
        recipientIds: [mappedUser.id, unmappedUser.id, mappedUser.id],
        title: 'T'.repeat(520),
        content: 'C'.repeat(4_020),
        link: `/${'L'.repeat(1_020)}`,
      })
      assert.equal(count, 2)

      const rows = await fixtureDb.messageDelivery.findMany({
        where: { tenantId: tenant.id, integrationId: integration.id },
        orderBy: { userId: 'asc' },
      })
      assert.equal(rows.length, 2)
      assert.equal(new Set(rows.map((row) => row.id)).size, 2)
      for (const row of rows) {
        assert.equal(row.channel, 'WECOM')
        assert.equal(row.event, 'CUSTOMER_ADD')
        assert.equal(row.title.length, 500)
        assert.equal(row.content?.length, 4_000)
        assert.equal(row.link?.length, 1_000)
        assert.equal(row.attempts, 0)
        assert.equal(row.maxAttempts, 3)
        assert.ok(row.createdAt instanceof Date)
        assert.ok(row.updatedAt instanceof Date)
      }

      const pending = rows.find((row) => row.userId === mappedUser.id)
      assert.ok(pending)
      assert.equal(pending.status, 'PENDING')
      assert.equal(pending.externalSubject, `external-${suffix}`)
      assert.equal(pending.errorCode, null)

      const listed = await service.list(tenant.id, {
        page: 1,
        pageSize: 10,
        channel: 'WECOM',
        keyword: 'primary recipient',
      })
      assert.equal(listed.total, 1)
      assert.equal(listed.items.length, 1)
      assert.equal(listed.items[0]?.id, pending.id)
      assert.equal(listed.items[0]?.userName, 'Primary Recipient')
      assert.match(listed.items[0]?.createdAt ?? '', /^\d{4}-\d{2}-\d{2}T/)

      const secondService = new MessageDeliveryService(
        { client: prisma8Client2 } as Prisma8Service,
        settings,
        {} as EnterpriseIntegrationsService,
        {} as WeComClient,
      )
      const firstClaim = service as unknown as {
        claimDelivery(id: string): Promise<boolean>
        completeDelivery(id: string, providerMessageId: string | null): Promise<void>
        fail(
          delivery: (typeof rows)[number],
          errorCode: string,
          errorMessage: string,
          transient: boolean,
        ): Promise<void>
      }
      const secondClaim = secondService as unknown as {
        claimDelivery(id: string): Promise<boolean>
      }
      const competingClaims = await Promise.all([
        firstClaim.claimDelivery(pending.id),
        secondClaim.claimDelivery(pending.id),
      ])
      assert.deepEqual([...competingClaims].sort(), [false, true])
      const claimedOnce = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(claimedOnce.status, 'SENDING')
      assert.equal(claimedOnce.attempts, 1)
      assert.equal(claimedOnce.nextAttemptAt, null)

      await fixtureDb.messageDelivery.update({
        where: { id: pending.id },
        data: {
          status: 'FAILED',
          nextAttemptAt: new Date(Date.now() - 1_000),
          errorCode: 'RETRY',
          errorMessage: 'retry',
        },
      })
      assert.equal(await secondClaim.claimDelivery(pending.id), true)
      const claimedTwice = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(claimedTwice.status, 'SENDING')
      assert.equal(claimedTwice.attempts, 2)
      assert.equal(claimedTwice.errorCode, null)
      assert.equal(claimedTwice.errorMessage, null)

      await fixtureDb.messageDelivery.update({
        where: { id: pending.id },
        data: {
          status: 'FAILED',
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      })
      assert.equal(await firstClaim.claimDelivery(pending.id), false)
      const notDue = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(notDue.status, 'FAILED')
      assert.equal(notDue.attempts, 2)

      await firstClaim.completeDelivery(pending.id, 'provider-message-1')
      const succeeded = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(succeeded.status, 'SUCCEEDED')
      assert.equal(succeeded.providerMessageId, 'provider-message-1')
      assert.ok(succeeded.sentAt instanceof Date)
      assert.equal(succeeded.errorCode, null)
      assert.equal(succeeded.errorMessage, null)

      const retrySource = await fixtureDb.messageDelivery.update({
        where: { id: pending.id },
        data: {
          status: 'SENDING',
          attempts: 1,
          providerMessageId: null,
          sentAt: null,
        },
      })
      await firstClaim.fail(retrySource, 'WECOM_45009', 'temporary failure', true)
      const failed = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(failed.status, 'FAILED')
      assert.equal(failed.errorCode, 'WECOM_45009')
      assert.equal(failed.errorMessage, 'temporary failure')
      assert.ok(failed.nextAttemptAt)
      assert.ok(failed.nextAttemptAt.getTime() > Date.now())

      const exhaustedSource = await fixtureDb.messageDelivery.update({
        where: { id: pending.id },
        data: { status: 'SENDING', attempts: 3, nextAttemptAt: null },
      })
      await firstClaim.fail(exhaustedSource, 'WECOM_500', 'permanent after retries', true)
      const deadAfterRetries = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(deadAfterRetries.status, 'DEAD')
      assert.equal(deadAfterRetries.nextAttemptAt, null)
      assert.equal(deadAfterRetries.errorCode, 'WECOM_500')

      const retriedVo = await service.retry(tenant.id, pending.id)
      assert.equal(retriedVo.status, 'PENDING')
      assert.equal(retriedVo.attempts, 0)
      assert.equal(retriedVo.nextAttemptAt, null)
      assert.equal(retriedVo.errorCode, null)
      assert.equal(retriedVo.errorMessage, null)
      assert.equal(retriedVo.providerMessageId, null)
      assert.equal(retriedVo.sentAt, null)
      const retried = await fixtureDb.messageDelivery.findUniqueOrThrow({
        where: { id: pending.id },
      })
      assert.equal(retried.status, 'PENDING')
      assert.equal(retried.attempts, 0)
      assert.equal(retried.nextAttemptAt, null)
      assert.equal(retried.errorCode, null)
      assert.equal(retried.errorMessage, null)
      assert.equal(retried.providerMessageId, null)
      assert.equal(retried.sentAt, null)

      const dead = rows.find((row) => row.userId === unmappedUser.id)
      assert.ok(dead)
      assert.equal(dead.status, 'DEAD')
      assert.equal(dead.externalSubject, null)
      assert.equal(dead.errorCode, 'EXTERNAL_USER_NOT_MAPPED')
      assert.match(dead.errorMessage ?? '', /成员映射/)
    } finally {
      const tenant = await fixtureDb.tenant.findUnique({
        where: { slug: `p8-outbox-${suffix}` },
        select: { id: true },
      })
      if (tenant) {
        await fixtureDb.messageDelivery.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.externalUserMapping.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.enterpriseIntegration.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
        await fixtureDb.tenant.delete({ where: { id: tenant.id } })
      }
      await prisma8Client2.close()
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
