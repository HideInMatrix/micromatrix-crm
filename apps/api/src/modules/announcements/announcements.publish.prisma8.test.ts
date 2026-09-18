import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { NotificationsService } from '../notifications/notifications.service'
import { AnnouncementsService } from './announcements.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Announcement Cron 由 Prisma 8 仅发布当前生效公告并回写 notice',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `p8-ann-${suffix}`
    const actor = `u${suffix}`.slice(0, 32)
    const now = new Date('2026-09-16T12:00:00.000Z')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    const ids: string[] = []
    try {
      const due = await fixtureDb.announcement.create({
        data: {
          tenantId,
          subject: '当前公告',
          content: '应由 Prisma 8 Cron 发布',
          startAt: new Date('2026-09-16T11:00:00.000Z'),
          endAt: new Date('2026-09-16T13:00:00.000Z'),
          departmentIds: [],
          userIds: [actor],
          receiverUserIds: [actor],
          notice: false,
          createUserId: actor,
          updateUserId: actor,
        },
      })
      ids.push(due.id)
      const future = await fixtureDb.announcement.create({
        data: {
          tenantId,
          subject: '未来公告',
          content: '当前不应发布',
          startAt: new Date('2026-09-16T14:00:00.000Z'),
          endAt: new Date('2026-09-16T15:00:00.000Z'),
          departmentIds: [],
          userIds: [actor],
          receiverUserIds: [actor],
          notice: false,
          createUserId: actor,
          updateUserId: actor,
        },
      })
      ids.push(future.id)

      const dispatches: string[] = []
      const notifications = {
        notifyManyFromSource: async (
          _tenantId: string,
          _userIds: string[],
          _sourceType: string,
          sourceId: string,
        ) => {
          dispatches.push(sourceId)
          return 1
        },
        removeBySource: async () => 0,
      } as unknown as NotificationsService
      const service = new AnnouncementsService(
        { client: prisma8Client } as Prisma8Service,
        notifications,
      )

      assert.equal(await service.publishDueAnnouncements(now), 1)
      assert.deepEqual(dispatches, [due.id])
      const persisted = await fixtureDb.announcement.findMany({
        where: { id: { in: ids } },
        orderBy: { startAt: 'asc' },
        select: { id: true, notice: true },
      })
      assert.deepEqual(persisted, [
        { id: due.id, notice: true },
        { id: future.id, notice: false },
      ])
    } finally {
      await fixtureDb.announcement.deleteMany({ where: { id: { in: ids } } })
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
