import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { BusinessNotificationsService } from './business-notifications.service'
import { MessageTemplateService } from './message-template.service'
import type { NotificationsService } from './notifications.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  '通知用户查询使用 Prisma 8 保持 email ilike 与 tenant/ACTIVE 收件人过滤',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const tenantIds: string[] = []

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Notify ${suffix}`, slug: `p8-notify-${suffix}` },
      })
      tenantIds.push(tenant.id)
      const otherTenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Notify Other ${suffix}`, slug: `p8-notify-other-${suffix}` },
      })
      tenantIds.push(otherTenant.id)
      const owner = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Owner Name',
          passwordHash: 'not-used',
          email: `Owner-${suffix}@Example.COM`,
          phone: '13800000001',
        },
      })
      const disabled = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Disabled User',
          passwordHash: 'not-used',
          status: 'DISABLED',
        },
      })
      const crossTenant = await fixtureDb.user.create({
        data: {
          tenantId: otherTenant.id,
          name: 'Cross Tenant',
          passwordHash: 'not-used',
        },
      })

      const prisma8 = { client: prisma8Client } as Prisma8Service
      const templates = new MessageTemplateService(prisma8)
      const resolved = await templates.renderText(
        tenant.id,
        '${ownerUser}',
        { ownerUser: owner.email!.toLowerCase() },
      )
      assert.equal(resolved, 'Owner Name')

      const delivered: string[][] = []
      const notifications = {
        notifyMany: async (_tenantId: string, userIds: string[]) => void delivered.push(userIds),
      } as unknown as NotificationsService
      const service = new BusinessNotificationsService(
        prisma8,
        notifications,
        {} as MessageSettingsService,
      )
      const count = await service.send({
        tenantId: tenant.id,
        event: 'CUSTOMER_ADD',
        recipientIds: [owner.id, disabled.id, crossTenant.id],
        type: 'system',
        title: 'Prisma 8 notification',
      })
      assert.equal(count, 1)
      assert.deepEqual(delivered, [[owner.id]])
    } finally {
      if (tenantIds.length) {
        await fixtureDb.user.deleteMany({ where: { tenantId: { in: tenantIds } } })
        await fixtureDb.tenant.deleteMany({ where: { id: { in: tenantIds } } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
