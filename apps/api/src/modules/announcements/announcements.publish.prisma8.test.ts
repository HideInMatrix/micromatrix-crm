import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8TimestampFromDate } from '../../prisma/prisma8-temporal'
import { prisma8JsonValue } from '../../prisma/prisma8-values'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { NotificationsService } from '../notifications/notifications.service'
import { AnnouncementsService } from './announcements.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Announcement Cron 由 Prisma 8 仅发布当前生效公告并回写 notice',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `p8-ann-${suffix}`
    const actor = `u${suffix}`.slice(0, 32)
    const now = new Date('2026-09-16T12:00:00.000Z')

    const ids: string[] = []
    try {
      const due = await prisma8Client.orm.public.Announcements
        .select('id')
        .create({
          tenantId,
          subject: '当前公告',
          content: '应由 Prisma 8 Cron 发布',
          startAt: prisma8TimestampFromDate(new Date('2026-09-16T11:00:00.000Z')),
          endAt: prisma8TimestampFromDate(new Date('2026-09-16T13:00:00.000Z')),
          departmentIds: prisma8JsonValue([]),
          userIds: prisma8JsonValue([actor]),
          receiverUserIds: prisma8JsonValue([actor]),
          notice: false,
          createUserId: actor,
          updateUserId: actor,
          updatedAt: prisma8TimestampFromDate(now),
      })
      ids.push(due.id)
      const future = await prisma8Client.orm.public.Announcements
        .select('id')
        .create({
          tenantId,
          subject: '未来公告',
          content: '当前不应发布',
          startAt: prisma8TimestampFromDate(new Date('2026-09-16T14:00:00.000Z')),
          endAt: prisma8TimestampFromDate(new Date('2026-09-16T15:00:00.000Z')),
          departmentIds: prisma8JsonValue([]),
          userIds: prisma8JsonValue([actor]),
          receiverUserIds: prisma8JsonValue([actor]),
          notice: false,
          createUserId: actor,
          updateUserId: actor,
          updatedAt: prisma8TimestampFromDate(now),
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
      const persisted = await prisma8Client.orm.public.Announcements
        .where((row) => row.id.in(ids))
        .orderBy((row) => row.startAt.asc())
        .select('id', 'notice')
        .all()
      assert.deepEqual(persisted, [
        { id: due.id, notice: true },
        { id: future.id, notice: false },
      ])
    } finally {
      if (ids.length) {
        await prisma8Client.orm.public.Announcements.where((row) => row.id.in(ids)).deleteAll()
      }
      await testDb.close()
    }
  },
)
