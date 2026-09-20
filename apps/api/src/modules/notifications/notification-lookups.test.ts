import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
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
  '通知用户查询使用 Prisma 保持 email ilike 与 tenant/ACTIVE 收件人过滤',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantIds: string[] = []

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-notify')
      tenantIds.push(tenant.id)
      const otherTenant = await createPrismaTestTenant(prismaClient, 'p8-notify-other')
      tenantIds.push(otherTenant.id)
      const owner = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Owner Name',
        email: `Owner-${suffix}@Example.COM`,
      })
      await prismaClient.orm.public.Users.where({ id: owner.id }).update({
        phone: '13800000001',
        updatedAt: nowInstant(),
      })
      const disabled = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Disabled User',
        status: 'DISABLED',
      })
      const crossTenant = await createPrismaTestUser(prismaClient, {
        tenantId: otherTenant.id,
        name: 'Cross Tenant',
      })

      const prisma = { client: prismaClient } as PrismaService
      const templates = new MessageTemplateService(prisma)
      const resolved = await templates.renderText(tenant.id, '${ownerUser}', {
        ownerUser: owner.email!.toLowerCase(),
      })
      assert.equal(resolved, 'Owner Name')

      const delivered: string[][] = []
      const notifications = {
        notifyMany: async (_tenantId: string, userIds: string[]) => void delivered.push(userIds),
      } as unknown as NotificationsService
      const service = new BusinessNotificationsService(
        prisma,
        notifications,
        {} as MessageSettingsService,
      )
      const count = await service.send({
        tenantId: tenant.id,
        event: 'CUSTOMER_ADD',
        recipientIds: [owner.id, disabled.id, crossTenant.id],
        type: 'system',
        title: 'Prisma notification',
      })
      assert.equal(count, 1)
      assert.deepEqual(delivered, [[owner.id]])
    } finally {
      if (tenantIds.length) {
        await prismaClient.orm.public.Users.where((row) => row.tenantId.in(tenantIds)).deleteAll()
        await prismaClient.orm.public.Tenants.where((row) => row.id.in(tenantIds)).deleteAll()
      }
      await testDb.close()
    }
  },
)
