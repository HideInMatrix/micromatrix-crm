import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { NotificationsService } from './notifications.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'NotificationsService 使用 Prisma 保持来源幂等、分页、未读 CAS 与精确删除计数',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `notification-tenant-${suffix}`
    const otherTenantId = `notification-other-${suffix}`
    const userA = `notification-user-a-${suffix}`
    const userB = `notification-user-b-${suffix}`
    const userC = `notification-user-c-${suffix}`
    const sourceId = `announcement-${suffix}`

    try {
      const service = new NotificationsService(
        { client: prismaClient } as PrismaService,
        {} as MessageSettingsService,
      )

      await service.notify(tenantId, userA, {
        type: 'system',
        title: 'Prisma direct notification',
        content: 'direct-content',
      })
      await service.notify(otherTenantId, userA, {
        type: 'system',
        title: 'Other tenant notification',
      })

      assert.equal(
        await service.notifyManyFromSource(tenantId, [userA, userB], 'announcement', sourceId, {
          type: 'announcement',
          title: 'Prisma source notification',
        }),
        2,
      )
      assert.equal(
        await service.notifyManyFromSource(
          tenantId,
          [userA, userB, userC],
          'announcement',
          sourceId,
          { type: 'announcement', title: 'Prisma source notification' },
        ),
        1,
      )

      const page = await service.list(tenantId, userA, 1, 10, true)
      assert.equal(page.total, 2)
      assert.equal(page.items.length, 2)
      assert.ok(page.items.every((item) => item.readAt === null))
      assert.ok(page.items.every((item) => !Number.isNaN(Date.parse(item.createdAt))))
      assert.deepEqual(await service.unreadCount(tenantId, userA), { count: 2 })

      const direct = page.items.find((item) => item.title === 'Prisma direct notification')
      assert.ok(direct)
      assert.deepEqual(await service.markRead(tenantId, userA, direct.id), { id: direct.id })
      assert.deepEqual(await service.unreadCount(tenantId, userA), { count: 1 })
      assert.deepEqual(await service.markAllRead(tenantId, userA), { count: 1 })
      assert.deepEqual(await service.unreadCount(tenantId, userA), { count: 0 })

      const directRow = await prismaClient.orm.public.Notifications.where({ id: direct.id })
        .select('readAt', 'tenantId')
        .first()
      assert.ok(directRow)
      assert.ok(directRow.readAt)
      assert.equal(directRow.tenantId, tenantId)

      assert.equal(await service.removeBySource(tenantId, 'announcement', sourceId), 3)
      assert.equal(
        (
          await prismaClient.orm.public.Notifications.where({
            tenantId,
            sourceType: 'announcement',
            sourceId,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
      assert.equal(
        (await prismaClient.orm.public.Notifications.where({ tenantId }).select('id').all()).length,
        1,
      )
      assert.equal(
        (
          await prismaClient.orm.public.Notifications.where({ tenantId: otherTenantId })
            .select('id')
            .all()
        ).length,
        1,
      )
    } finally {
      await prismaClient.orm.public.Notifications.where((row) =>
        row.tenantId.in([tenantId, otherTenantId]),
      ).deleteAll()
      await testDb.close()
    }
  },
)
