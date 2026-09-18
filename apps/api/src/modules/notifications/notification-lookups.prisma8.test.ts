import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
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
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantIds: string[] = []

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-notify')
      tenantIds.push(tenant.id)
      const otherTenant = await createPrismaTestTenant(prisma8Client, 'p8-notify-other')
      tenantIds.push(otherTenant.id)
      const owner = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Owner Name',
        email: `Owner-${suffix}@Example.COM`,
      })
      await prisma8Client.orm.public.Users.where({ id: owner.id }).update({
        phone: '13800000001',
        updatedAt: prisma8Now(),
      })
      const disabled = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Disabled User',
        status: 'DISABLED',
      })
      const crossTenant = await createPrismaTestUser(prisma8Client, {
        tenantId: otherTenant.id,
        name: 'Cross Tenant',
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
        await prisma8Client.orm.public.Users
          .where((row) => row.tenantId.in(tenantIds))
          .deleteAll()
        await prisma8Client.orm.public.Tenants
          .where((row) => row.id.in(tenantIds))
          .deleteAll()
      }
      await testDb.close()
    }
  },
)
