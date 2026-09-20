import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import type { EnterpriseIntegrationsService } from '../enterprise-integrations/enterprise-integrations.service'
import type { WeComClient } from '../enterprise-integrations/wecom.client'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant, instantFromDate } from '../../prisma/temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { MessageDeliveryService } from './message-delivery.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'MessageDelivery outbox 通过 Prisma createAll 保持 fixture readback 与 PENDING/DEAD 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const testDb2 = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const prismaClient2 = testDb2.client
    const suffix = randomUUID().replaceAll('-', '')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-outbox')
      tenantId = tenant.id
      const mappedUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Primary Recipient',
      })
      const unmappedUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Unmapped User',
      })
      const integration = await prismaClient.orm.public.EnterpriseIntegrations.select('id').create({
        tenantId: tenant.id,
        provider: 'WECOM',
        corpId: `corp-${suffix}`,
        agentId: '1000001',
        secretCiphertext: 'ciphertext',
        secretIv: 'iv',
        secretAuthTag: 'tag',
        createdById: mappedUser.id,
        updatedById: mappedUser.id,
        updatedAt: nowInstant(),
      })
      await prismaClient.orm.public.ExternalUserMappings.create({
        tenantId: tenant.id,
        provider: 'WECOM',
        externalId: `external-${suffix}`,
        externalKey: `key-${suffix}`,
        userId: mappedUser.id,
        updatedAt: nowInstant(),
      })

      const settings = {
        isWeComEnabled: async () => true,
        isDingTalkEnabled: async () => false,
        isLarkEnabled: async () => false,
        getWeComChannelGate: async () => ({ available: true }),
      } as unknown as MessageSettingsService
      const service = new MessageDeliveryService(
        { client: prismaClient } as PrismaService,
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

      const rows = await prismaClient.orm.public.MessageDeliveries.where({
        tenantId: tenant.id,
        integrationId: integration.id,
      })
        .orderBy((row) => row.userId.asc())
        .all()
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
        assert.ok(row.createdAt)
        assert.ok(row.updatedAt)
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
        { client: prismaClient2 } as PrismaService,
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
      const claimedOnce = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(claimedOnce)
      assert.equal(claimedOnce.status, 'SENDING')
      assert.equal(claimedOnce.attempts, 1)
      assert.equal(claimedOnce.nextAttemptAt, null)

      await prismaClient.orm.public.MessageDeliveries.where({ id: pending.id }).update({
        status: 'FAILED',
        nextAttemptAt: instantFromDate(new Date(Date.now() - 1_000)),
        errorCode: 'RETRY',
        errorMessage: 'retry',
        updatedAt: nowInstant(),
      })
      assert.equal(await secondClaim.claimDelivery(pending.id), true)
      const claimedTwice = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(claimedTwice)
      assert.equal(claimedTwice.status, 'SENDING')
      assert.equal(claimedTwice.attempts, 2)
      assert.equal(claimedTwice.errorCode, null)
      assert.equal(claimedTwice.errorMessage, null)

      await prismaClient.orm.public.MessageDeliveries.where({ id: pending.id }).update({
        status: 'FAILED',
        nextAttemptAt: instantFromDate(new Date(Date.now() + 60_000)),
        updatedAt: nowInstant(),
      })
      assert.equal(await firstClaim.claimDelivery(pending.id), false)
      const notDue = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(notDue)
      assert.equal(notDue.status, 'FAILED')
      assert.equal(notDue.attempts, 2)

      await firstClaim.completeDelivery(pending.id, 'provider-message-1')
      const succeeded = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(succeeded)
      assert.equal(succeeded.status, 'SUCCEEDED')
      assert.equal(succeeded.providerMessageId, 'provider-message-1')
      assert.ok(succeeded.sentAt)
      assert.equal(succeeded.errorCode, null)
      assert.equal(succeeded.errorMessage, null)

      const retrySource = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).update({
        status: 'SENDING',
        attempts: 1,
        providerMessageId: null,
        sentAt: null,
        updatedAt: nowInstant(),
      })
      assert.ok(retrySource)
      await firstClaim.fail(retrySource, 'WECOM_45009', 'temporary failure', true)
      const failed = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(failed)
      assert.equal(failed.status, 'FAILED')
      assert.equal(failed.errorCode, 'WECOM_45009')
      assert.equal(failed.errorMessage, 'temporary failure')
      assert.ok(failed.nextAttemptAt)
      assert.ok(failed.nextAttemptAt.epochMilliseconds > Date.now())

      const exhaustedSource = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).update({
        status: 'SENDING',
        attempts: 3,
        nextAttemptAt: null,
        updatedAt: nowInstant(),
      })
      assert.ok(exhaustedSource)
      await firstClaim.fail(exhaustedSource, 'WECOM_500', 'permanent after retries', true)
      const deadAfterRetries = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(deadAfterRetries)
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
      const retried = await prismaClient.orm.public.MessageDeliveries.where({
        id: pending.id,
      }).first()
      assert.ok(retried)
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
      if (tenantId) {
        await prismaClient.orm.public.MessageDeliveries.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.ExternalUserMappings.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.EnterpriseIntegrations.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb2.close()
      await testDb.close()
    }
  },
)
