import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import type { NotificationsService } from '../notifications/notifications.service'
import { AnnouncementsService } from './announcements.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Announcements CRUD 使用 Prisma 保持 JSONB 接收快照、Temporal 与名称装配语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    let tenantId: string | null = null
    const removedSources: string[] = []

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-ann-crud')
      tenantId = tenant.id
      const root = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '总部',
      })
      const child = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '销售部',
        parentId: root.id,
        sort: 1,
      })
      const actor = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '公告管理员',
      })
      const departmentUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '销售成员',
        deptId: child.id,
      })
      const directUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '直属成员',
      })
      await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '停用成员',
        deptId: child.id,
        status: 'DISABLED',
      })

      const notifications = {
        notifyManyFromSource: async () => 0,
        removeBySource: async (_tenantId: string, _sourceType: string, sourceId: string) => {
          removedSources.push(sourceId)
          return 0
        },
      } as unknown as NotificationsService
      const service = new AnnouncementsService(
        { client: prismaClient } as PrismaService,
        notifications,
      )
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const now = Date.now()

      const created = await service.create(user, {
        subject: ' Prisma 发布说明 ',
        content: ' JSONB + Temporal ',
        startAt: new Date(now + 10 * 60_000).toISOString(),
        endAt: new Date(now + 60 * 60_000).toISOString(),
        url: 'https://example.com/announcement',
        linkName: '查看详情',
        departmentIds: [root.id],
        userIds: [directUser.id],
      })
      assert.equal(created.subject, 'Prisma 发布说明')
      assert.deepEqual(created.departmentIds, [root.id])
      assert.deepEqual(created.userIds, [directUser.id])
      assert.equal(created.departments[0]?.name, '总部')
      assert.equal(created.users[0]?.name, '直属成员')
      assert.equal(created.createUserName, '公告管理员')
      assert.ok(!Number.isNaN(Date.parse(created.startAt)))

      const persisted = await prismaClient.orm.public.Announcements.where({ id: created.id })
        .select('receiverUserIds', 'startAt', 'updatedAt')
        .first()
      assert.ok(persisted)
      assert.deepEqual(
        new Set(persisted.receiverUserIds as string[]),
        new Set([departmentUser.id, directUser.id]),
      )
      assert.ok(persisted.startAt)
      assert.ok(persisted.updatedAt)

      const listed = await service.list(tenant.id, { page: 1, pageSize: 10, keyword: 'PRISMA 8' })
      assert.equal(listed.total, 1)
      assert.equal(listed.items[0]?.id, created.id)

      const updated = await service.update(user, created.id, {
        subject: '更新后的公告',
        content: '新的内容',
        startAt: new Date(now + 20 * 60_000).toISOString(),
        endAt: new Date(now + 2 * 60 * 60_000).toISOString(),
        departmentIds: [],
        userIds: [directUser.id],
      })
      assert.equal(updated.subject, '更新后的公告')
      assert.deepEqual(updated.departmentIds, [])
      assert.deepEqual(removedSources, [created.id])
      const updatedRow = await prismaClient.orm.public.Announcements.where({ id: created.id })
        .select('receiverUserIds', 'notice')
        .first()
      assert.ok(updatedRow)
      assert.deepEqual(updatedRow.receiverUserIds, [directUser.id])
      assert.equal(updatedRow.notice, false)

      assert.deepEqual(await service.remove(tenant.id, created.id), { id: created.id })
      assert.deepEqual(removedSources, [created.id, created.id])
      assert.equal(
        await prismaClient.orm.public.Announcements.where({ id: created.id }).select('id').first(),
        null,
      )
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.Announcements.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Departments.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
