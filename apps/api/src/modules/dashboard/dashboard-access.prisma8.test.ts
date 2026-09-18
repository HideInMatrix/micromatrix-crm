import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { DashboardAccessService } from './dashboard-access.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DashboardAccess 使用 Prisma 8 保持部门路径、成员范围和 module 装配语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    let otherTenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Dashboard ${suffix}`, slug: `p8-dashboard-${suffix}` },
      })
      tenantId = tenant.id
      const otherTenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Dashboard Other ${suffix}`, slug: `p8-dashboard-other-${suffix}` },
      })
      otherTenantId = otherTenant.id

      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '总部', sort: 0 },
      })
      const child = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '研发部', parentId: root.id, sort: 1 },
      })
      const viewer = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '查看者',
          passwordHash: 'not-used',
          deptId: child.id,
        },
      })
      const member = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: '范围成员', passwordHash: 'not-used' },
      })
      const foreignUser = await fixtureDb.user.create({
        data: { tenantId: otherTenant.id, name: '其他租户成员', passwordHash: 'not-used' },
      })
      const module = await fixtureDb.dashboardModule.create({
        data: {
          organizationId: tenant.id,
          name: '经营看板',
          createTime: 1n,
          updateTime: 1n,
          createUser: viewer.id,
          updateUser: viewer.id,
        },
      })
      const dashboard = await fixtureDb.dashboard.create({
        data: {
          name: '部门可见看板',
          resourceUrl: 'https://example.com/dashboard',
          dashboardModuleId: module.id,
          organizationId: tenant.id,
          scopeId: JSON.stringify([root.id]),
          createTime: 1n,
          updateTime: 1n,
          createUser: member.id,
          updateUser: member.id,
        },
      })

      const service = new DashboardAccessService({ client: prisma8Client } as Prisma8Service)
      const authUser: AuthUser = {
        id: viewer.id,
        tenantId: tenant.id,
        email: null,
        name: viewer.name,
        deptId: child.id,
        leaderId: null,
        roles: [],
        permissions: [],
      }

      assert.deepEqual(await service.departmentPathIds(authUser), [child.id, root.id])
      assert.deepEqual(await service.validateScopeIds(authUser, [member.id, root.id, member.id]), [member.id, root.id])
      await assert.rejects(
        () => service.validateScopeIds(authUser, [foreignUser.id]),
        /仪表板成员范围包含无效 ID/,
      )
      assert.deepEqual(await service.resolveScopeMembers(authUser, [root.id, member.id]), [
        { id: root.id, name: root.name, type: 'DEPARTMENT' },
        { id: member.id, name: member.name, type: 'USER' },
      ])

      const visible = await service.assertVisibleDashboard(authUser, dashboard.id)
      assert.equal(visible.id, dashboard.id)
      assert.equal(visible.module.id, module.id)
      assert.equal(visible.module.name, module.name)
      assert.deepEqual(await service.visibleDashboardIds(authUser, [dashboard]), new Set([dashboard.id]))
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
      if (otherTenantId) {
        await fixtureDb.userRole.deleteMany({ where: { tenantId: otherTenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId: otherTenantId } })
        await fixtureDb.department.deleteMany({ where: { tenantId: otherTenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: otherTenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
