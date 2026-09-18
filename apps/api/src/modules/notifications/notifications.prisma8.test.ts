import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { NotificationsService } from './notifications.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'NotificationsService 使用 Prisma 8 保持来源幂等、分页、未读 CAS 与精确删除计数',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `notification-tenant-${suffix}`
    const otherTenantId = `notification-other-${suffix}`
    const userA = `notification-user-a-${suffix}`
    const userB = `notification-user-b-${suffix}`
    const userC = `notification-user-c-${suffix}`
    const sourceId = `announcement-${suffix}`

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const service = new NotificationsService(
        { client: prisma8Client } as Prisma8Service,
        {} as MessageSettingsService,
      )

      await service.notify(tenantId, userA, {
        type: 'system',
        title: 'Prisma 8 direct notification',
        content: 'direct-content',
      })
      await service.notify(otherTenantId, userA, {
        type: 'system',
        title: 'Other tenant notification',
      })

      assert.equal(
        await service.notifyManyFromSource(
          tenantId,
          [userA, userB],
          'announcement',
          sourceId,
          { type: 'announcement', title: 'Prisma 8 source notification' },
        ),
        2,
      )
      assert.equal(
        await service.notifyManyFromSource(
          tenantId,
          [userA, userB, userC],
          'announcement',
          sourceId,
          { type: 'announcement', title: 'Prisma 8 source notification' },
        ),
        1,
      )

      const page = await service.list(tenantId, userA, 1, 10, true)
      assert.equal(page.total, 2)
      assert.equal(page.items.length, 2)
      assert.ok(page.items.every((item) => item.readAt === null))
      assert.ok(page.items.every((item) => !Number.isNaN(Date.parse(item.createdAt))))
      assert.deepEqual(await service.unreadCount(tenantId, userA), { count: 2 })

      const direct = page.items.find((item) => item.title === 'Prisma 8 direct notification')
      assert.ok(direct)
      assert.deepEqual(await service.markRead(tenantId, userA, direct.id), { id: direct.id })
      assert.deepEqual(await service.unreadCount(tenantId, userA), { count: 1 })
      assert.deepEqual(await service.markAllRead(tenantId, userA), { count: 1 })
      assert.deepEqual(await service.unreadCount(tenantId, userA), { count: 0 })

      const directRow = await fixtureDb.notification.findUniqueOrThrow({ where: { id: direct.id } })
      assert.ok(directRow.readAt instanceof Date)
      assert.equal(directRow.tenantId, tenantId)

      assert.equal(await service.removeBySource(tenantId, 'announcement', sourceId), 3)
      assert.equal(
        await fixtureDb.notification.count({ where: { tenantId, sourceType: 'announcement', sourceId } }),
        0,
      )
      assert.equal(await fixtureDb.notification.count({ where: { tenantId } }), 1)
      assert.equal(await fixtureDb.notification.count({ where: { tenantId: otherTenantId } }), 1)
    } finally {
      await fixtureDb.notification.deleteMany({ where: { tenantId: { in: [tenantId, otherTenantId] } } })
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
