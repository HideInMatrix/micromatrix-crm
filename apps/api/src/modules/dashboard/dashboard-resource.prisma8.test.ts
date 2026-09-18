import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { DashboardAccessService } from './dashboard-access.service'
import { DashboardResourceService } from './dashboard-resource.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DashboardResource 使用 Prisma 8 保持 CRUD、收藏、分页与移动事务语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-dashboard-resource')
      tenantId = tenant.id
      const user = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '看板资源管理员',
      })
      const moduleA = await prisma8Client.orm.public.DashboardModule.select('id', 'name').create({
        id: createLegacyId32(),
        organizationId: tenant.id,
        name: '经营目录',
        createTime: 1n,
        updateTime: 1n,
        createUser: user.id,
        updateUser: user.id,
      })
      const moduleB = await prisma8Client.orm.public.DashboardModule.select('id', 'name').create({
        id: createLegacyId32(),
        organizationId: tenant.id,
        name: '销售目录',
        createTime: 1n,
        updateTime: 1n,
        createUser: user.id,
        updateUser: user.id,
      })
      const authUser: AuthUser = {
        id: user.id,
        tenantId: tenant.id,
        email: null,
        name: user.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: ['*'],
      }
      const prisma8Service = { client: prisma8Client } as Prisma8Service
      const access = new DashboardAccessService(prisma8Service)
      const service = new DashboardResourceService(prisma8Service, access)

      const first = await service.add(authUser, {
        name: 'Alpha 看板',
        resourceUrl: 'https://example.com/alpha',
        dashboardModuleId: moduleA.id,
        scopeIds: [],
        description: '第一张看板',
      })
      const second = await service.add(authUser, {
        name: 'Beta 看板',
        resourceUrl: 'https://example.com/beta',
        dashboardModuleId: moduleA.id,
        scopeIds: [],
      })
      assert.equal(first.dashboardModuleName, moduleA.name)
      assert.equal(first.pos, 1024)
      assert.equal(second.pos, 2048)
      assert.equal(first.id.length, 32)
      assert.equal(
        (
          await prisma8Client.orm.public.Dashboard.where({ id: first.id })
            .select('description')
            .first()
        )?.description,
        '第一张看板',
      )

      await assert.rejects(
        () =>
          service.add(authUser, {
            name: 'Alpha 看板',
            resourceUrl: 'https://example.com/duplicate',
            dashboardModuleId: moduleA.id,
            scopeIds: [],
          }),
        /同一文件夹下已存在同名仪表板/,
      )

      const alphaPage = await service.page(authUser, { keyword: 'alpha', current: 1, pageSize: 10 })
      assert.equal(alphaPage.total, 1)
      assert.equal(alphaPage.list[0]?.id, first.id)

      const collected = await service.collect(authUser, first.id)
      assert.equal(collected.collected, true)
      assert.equal((await service.detail(authUser, first.id)).myCollect, true)
      await assert.rejects(() => service.collect(authUser, first.id), /仪表板已收藏/)
      const collectPage = await service.collectPage(authUser, { current: 1, pageSize: 10 })
      assert.equal(collectPage.total, 1)
      assert.equal(collectPage.list[0]?.id, first.id)
      await service.unCollect(authUser, first.id)
      assert.equal((await service.collectPage(authUser, { current: 1, pageSize: 10 })).total, 0)

      const updated = await service.update(authUser, {
        id: first.id,
        name: 'Alpha Updated',
        resourceUrl: 'https://example.com/alpha-updated',
        dashboardModuleId: moduleB.id,
        scopeIds: [],
        description: '更新后的描述',
      })
      assert.equal(updated.dashboardModuleId, moduleB.id)
      assert.equal(updated.dashboardModuleName, moduleB.name)
      const storedFirst = await prisma8Client.orm.public.Dashboard.where({
        id: first.id,
      })
        .select('dashboardModuleId', 'resourceUrl')
        .first()
      assert.ok(storedFirst)
      assert.equal(storedFirst.dashboardModuleId, moduleB.id)
      assert.equal(storedFirst.resourceUrl, 'https://example.com/alpha-updated')

      const renamed = await service.rename(authUser, {
        id: first.id,
        dashboardModuleId: moduleB.id,
        name: 'Alpha Final',
      })
      assert.equal(renamed.name, 'Alpha Final')

      await service.move(authUser, {
        dashboardModuleId: moduleB.id,
        moveId: second.id,
        targetId: first.id,
        moveMode: 'APPEND',
      })
      const movedSecond = await prisma8Client.orm.public.Dashboard.where({
        id: second.id,
      })
        .select('dashboardModuleId')
        .first()
      assert.ok(movedSecond)
      assert.equal(movedSecond.dashboardModuleId, moduleB.id)
      const moduleBRows = await prisma8Client.orm.public.Dashboard.where({
        organizationId: tenant.id,
        dashboardModuleId: moduleB.id,
      })
        .orderBy((row) => row.pos.asc())
        .select('id', 'pos')
        .all()
      assert.deepEqual(
        moduleBRows.map((row) => [row.id, row.pos]),
        [
          [first.id, 1024n],
          [second.id, 2048n],
        ],
      )

      const removed = await service.remove(authUser, second.id)
      assert.equal(removed.id, second.id)
      assert.equal(
        (await prisma8Client.orm.public.Dashboard.where({ id: second.id }).select('id').all())
          .length,
        0,
      )
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        const dashboardIds = await prisma8Client.orm.public.Dashboard.where({ organizationId })
          .select('id')
          .all()
        if (dashboardIds.length) {
          await prisma8Client.orm.public.DashboardCollection.where((row) =>
            row.dashboardId.in(dashboardIds.map((item) => item.id)),
          ).deleteAll()
        }
        await prisma8Client.orm.public.Dashboard.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.DashboardModule.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
