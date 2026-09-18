import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { instantFromDate } from '../../prisma/temporal'
import { jsonValue } from '../../prisma/json-value'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { NotificationsService } from '../notifications/notifications.service'
import { AnnouncementsService } from './announcements.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Announcement Cron 由 Prisma 仅发布当前生效公告并回写 notice',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const tenantId = `p8-ann-${suffix}`
    const actor = `u${suffix}`.slice(0, 32)
    const now = new Date('2026-09-16T12:00:00.000Z')

    const ids: string[] = []
    try {
      const due = await prismaClient.orm.public.Announcements.select('id').create({
        tenantId,
        subject: '当前公告',
        content: '应由 Prisma Cron 发布',
        startAt: instantFromDate(new Date('2026-09-16T11:00:00.000Z')),
        endAt: instantFromDate(new Date('2026-09-16T13:00:00.000Z')),
        departmentIds: jsonValue([]),
        userIds: jsonValue([actor]),
        receiverUserIds: jsonValue([actor]),
        notice: false,
        createUserId: actor,
        updateUserId: actor,
        updatedAt: instantFromDate(now),
      })
      ids.push(due.id)
      const future = await prismaClient.orm.public.Announcements.select('id').create({
        tenantId,
        subject: '未来公告',
        content: '当前不应发布',
        startAt: instantFromDate(new Date('2026-09-16T14:00:00.000Z')),
        endAt: instantFromDate(new Date('2026-09-16T15:00:00.000Z')),
        departmentIds: jsonValue([]),
        userIds: jsonValue([actor]),
        receiverUserIds: jsonValue([actor]),
        notice: false,
        createUserId: actor,
        updateUserId: actor,
        updatedAt: instantFromDate(now),
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
        { client: prismaClient } as PrismaService,
        notifications,
      )

      assert.equal(await service.publishDueAnnouncements(now), 1)
      assert.deepEqual(dispatches, [due.id])
      const persisted = await prismaClient.orm.public.Announcements.where((row) => row.id.in(ids))
        .orderBy((row) => row.startAt.asc())
        .select('id', 'notice')
        .all()
      assert.deepEqual(persisted, [
        { id: due.id, notice: true },
        { id: future.id, notice: false },
      ])
    } finally {
      if (ids.length) {
        await prismaClient.orm.public.Announcements.where((row) => row.id.in(ids)).deleteAll()
      }
      await testDb.close()
    }
  },
)
