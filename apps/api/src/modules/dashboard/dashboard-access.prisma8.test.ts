import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { DashboardAccessService } from './dashboard-access.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DashboardAccess 使用 Prisma 8 保持部门路径、成员范围和 module 装配语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client

    let tenantId: string | null = null
    let otherTenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-dashboard')
      tenantId = tenant.id
      const otherTenant = await createPrismaTestTenant(prisma8Client, 'p8-dashboard-other')
      otherTenantId = otherTenant.id

      const root = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '总部',
      })
      const child = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '研发部',
        parentId: root.id,
        sort: 1,
      })
      const viewer = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '查看者',
        deptId: child.id,
      })
      const member = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '范围成员',
      })
      const foreignUser = await createPrismaTestUser(prisma8Client, {
        tenantId: otherTenant.id,
        name: '其他租户成员',
      })
      const module = await prisma8Client.orm.public.DashboardModule
        .select('id', 'name')
        .create({
          id: prisma8Id32(),
          organizationId: prisma8Varchar(tenant.id, 32),
          name: prisma8Varchar('经营看板', 255),
          createTime: 1n,
          updateTime: 1n,
          createUser: prisma8Varchar(viewer.id, 32),
          updateUser: prisma8Varchar(viewer.id, 32),
        })
      const dashboard = await prisma8Client.orm.public.Dashboard
        .select('id', 'scopeId', 'createUser')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('部门可见看板', 255),
          resourceUrl: prisma8Varchar('https://example.com/dashboard', 500),
          dashboardModuleId: module.id,
          organizationId: prisma8Varchar(tenant.id, 32),
          scopeId: JSON.stringify([root.id]),
          createTime: 1n,
          updateTime: 1n,
          createUser: prisma8Varchar(member.id, 32),
          updateUser: prisma8Varchar(member.id, 32),
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
        const organizationId = prisma8Varchar(tenantId, 32)
        const dashboardIds = await prisma8Client.orm.public.Dashboard.where({ organizationId }).select('id').all()
        if (dashboardIds.length) {
          await prisma8Client.orm.public.DashboardCollection
            .where((row) => row.dashboardId.in(dashboardIds.map((item) => item.id)))
            .deleteAll()
        }
        await prisma8Client.orm.public.Dashboard.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.DashboardModule.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      if (otherTenantId) {
        await prisma8Client.orm.public.UserRoles.where({ tenantId: otherTenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId: otherTenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId: otherTenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: otherTenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
