import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { DashboardAccessService } from './dashboard-access.service'
import { DashboardModuleService } from './dashboard-module.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DashboardModule 使用 Prisma 保持目录 CRUD、树统计与移动事务语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-dashboard-module')
      tenantId = tenant.id
      const user = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '看板管理员',
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
      const prismaService = { client: prismaClient } as PrismaService
      const access = new DashboardAccessService(prismaService)
      const service = new DashboardModuleService(prismaService, access)

      const rootA = await service.add(authUser, { name: '经营分析', parentId: 'NONE' })
      const rootB = await service.add(authUser, { name: '销售分析', parentId: 'NONE' })
      const rootC = await service.add(authUser, { name: '财务分析', parentId: 'NONE' })
      assert.equal(rootA.pos, 1024)
      assert.equal(rootB.pos, 2048)
      assert.equal(rootC.pos, 3072)
      assert.equal(
        (
          await prismaClient.orm.public.DashboardModule.where({
            id: rootA.id,
          })
            .select('name')
            .first()
        )?.name,
        '经营分析',
      )

      await assert.rejects(
        () => service.add(authUser, { name: '经营分析', parentId: 'NONE' }),
        /同一级下已存在同名仪表板文件夹/,
      )
      const renamed = await service.rename(authUser, { id: rootB.id, name: '销售驾驶舱' })
      assert.equal(renamed.name, '销售驾驶舱')

      const child = await service.add(authUser, { name: '渠道分析', parentId: rootA.id })
      const dashboard = await prismaClient.orm.public.Dashboard.select('id').create({
        id: createLegacyId32(),
        name: '渠道趋势',
        resourceUrl: 'https://example.com/channel',
        dashboardModuleId: child.id,
        organizationId: tenant.id,
        scopeId: '[]',
        createTime: 1n,
        updateTime: 1n,
        createUser: user.id,
        updateUser: user.id,
      })
      await prismaClient.orm.public.DashboardCollection.create({
        id: createLegacyId32(),
        userId: user.id,
        dashboardId: dashboard.id,
        createTime: 1n,
        updateTime: 1n,
        createUser: user.id,
        updateUser: user.id,
      })

      const treeBeforeMove = await service.tree(authUser)
      const rootANode = treeBeforeMove.find((node) => node.id === rootA.id)
      const childNode = rootANode?.children?.find((node) => node.id === child.id)
      assert.equal(childNode?.children?.[0]?.id, dashboard.id)
      assert.equal(childNode?.children?.[0]?.myCollect, true)
      const countBeforeMove = await service.count(authUser)
      assert.equal(countBeforeMove[rootA.id], 1)
      assert.equal(countBeforeMove[child.id], 1)
      assert.equal(countBeforeMove.myCollect, 1)

      await service.move(authUser, {
        dragNodeId: child.id,
        dropNodeId: rootB.id,
        dropPosition: 0,
      })
      const storedChild = await prismaClient.orm.public.DashboardModule.where({
        id: child.id,
      })
        .select('parentId')
        .first()
      assert.ok(storedChild)
      assert.equal(storedChild.parentId, rootB.id)
      const countAfterMove = await service.count(authUser)
      assert.equal(countAfterMove[rootA.id], 0)
      assert.equal(countAfterMove[rootB.id], 1)

      const removedA = await service.remove(authUser, [rootA.id])
      assert.equal(removedA.deleted, 1)
      await assert.rejects(
        () => service.remove(authUser, [child.id]),
        /文件夹下存在仪表板，不能删除/,
      )

      await prismaClient.orm.public.DashboardCollection.where({
        dashboardId: dashboard.id,
      }).deleteAll()
      await prismaClient.orm.public.Dashboard.where({ id: dashboard.id }).delete()
      const removedChild = await service.remove(authUser, [child.id])
      assert.equal(removedChild.deleted, 1)
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        const dashboardIds = await prismaClient.orm.public.Dashboard.where({ organizationId })
          .select('id')
          .all()
        if (dashboardIds.length) {
          await prismaClient.orm.public.DashboardCollection.where((row) =>
            row.dashboardId.in(dashboardIds.map((item) => item.id)),
          ).deleteAll()
        }
        await prismaClient.orm.public.Dashboard.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.DashboardModule.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Departments.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
