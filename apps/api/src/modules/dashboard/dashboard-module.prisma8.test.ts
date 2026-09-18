import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { DashboardAccessService } from './dashboard-access.service'
import { DashboardModuleService } from './dashboard-module.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DashboardModule 使用 Prisma 8 保持目录 CRUD、树统计与移动事务语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Dashboard Module ${suffix}`, slug: `p8-dashboard-module-${suffix}` },
      })
      tenantId = tenant.id
      const user = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: '看板管理员', passwordHash: 'not-used' },
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
      const service = new DashboardModuleService(prisma8Service, access)

      const rootA = await service.add(authUser, { name: '经营分析', parentId: 'NONE' })
      const rootB = await service.add(authUser, { name: '销售分析', parentId: 'NONE' })
      const rootC = await service.add(authUser, { name: '财务分析', parentId: 'NONE' })
      assert.equal(rootA.pos, 1024)
      assert.equal(rootB.pos, 2048)
      assert.equal(rootC.pos, 3072)
      assert.equal((await fixtureDb.dashboardModule.findUniqueOrThrow({ where: { id: rootA.id } })).name, '经营分析')

      await assert.rejects(
        () => service.add(authUser, { name: '经营分析', parentId: 'NONE' }),
        /同一级下已存在同名仪表板文件夹/,
      )
      const renamed = await service.rename(authUser, { id: rootB.id, name: '销售驾驶舱' })
      assert.equal(renamed.name, '销售驾驶舱')

      const child = await service.add(authUser, { name: '渠道分析', parentId: rootA.id })
      const dashboard = await fixtureDb.dashboard.create({
        data: {
          name: '渠道趋势',
          resourceUrl: 'https://example.com/channel',
          dashboardModuleId: child.id,
          organizationId: tenant.id,
          scopeId: '[]',
          createTime: 1n,
          updateTime: 1n,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await fixtureDb.dashboardCollection.create({
        data: {
          userId: user.id,
          dashboardId: dashboard.id,
          createTime: 1n,
          updateTime: 1n,
          createUser: user.id,
          updateUser: user.id,
        },
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
      const storedChild = await fixtureDb.dashboardModule.findUniqueOrThrow({ where: { id: child.id } })
      assert.equal(storedChild.parentId, rootB.id)
      const countAfterMove = await service.count(authUser)
      assert.equal(countAfterMove[rootA.id], 0)
      assert.equal(countAfterMove[rootB.id], 1)

      const removedA = await service.remove(authUser, [rootA.id])
      assert.equal(removedA.deleted, 1)
      await assert.rejects(() => service.remove(authUser, [child.id]), /文件夹下存在仪表板，不能删除/)

      await fixtureDb.dashboardCollection.deleteMany({ where: { dashboardId: dashboard.id } })
      await fixtureDb.dashboard.delete({ where: { id: dashboard.id } })
      const removedChild = await service.remove(authUser, [child.id])
      assert.equal(removedChild.deleted, 1)
    } finally {
      if (tenantId) {
        await fixtureDb.dashboardCollection.deleteMany({ where: { dashboard: { organizationId: tenantId } } })
        await fixtureDb.dashboard.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.dashboardModule.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.userRole.deleteMany({ where: { tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.department.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
