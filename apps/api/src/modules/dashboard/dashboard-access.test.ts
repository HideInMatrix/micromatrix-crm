import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { DashboardAccessService } from './dashboard-access.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DashboardAccess 使用 Prisma 保持部门路径、成员范围和 module 装配语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client

    let tenantId: string | null = null
    let otherTenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-dashboard')
      tenantId = tenant.id
      const otherTenant = await createPrismaTestTenant(prismaClient, 'p8-dashboard-other')
      otherTenantId = otherTenant.id

      const root = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '总部',
      })
      const child = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '研发部',
        parentId: root.id,
        sort: 1,
      })
      const viewer = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '查看者',
        deptId: child.id,
      })
      const member = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '范围成员',
      })
      const foreignUser = await createPrismaTestUser(prismaClient, {
        tenantId: otherTenant.id,
        name: '其他租户成员',
      })
      const module = await prismaClient.orm.public.DashboardModule.select('id', 'name').create({
        id: createLegacyId32(),
        organizationId: tenant.id,
        name: '经营看板',
        createTime: 1n,
        updateTime: 1n,
        createUser: viewer.id,
        updateUser: viewer.id,
      })
      const dashboard = await prismaClient.orm.public.Dashboard.select(
        'id',
        'scopeId',
        'createUser',
      ).create({
        id: createLegacyId32(),
        name: '部门可见看板',
        resourceUrl: 'https://example.com/dashboard',
        dashboardModuleId: module.id,
        organizationId: tenant.id,
        scopeId: JSON.stringify([root.id]),
        createTime: 1n,
        updateTime: 1n,
        createUser: member.id,
        updateUser: member.id,
      })

      const service = new DashboardAccessService({ client: prismaClient } as PrismaService)
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
      assert.deepEqual(await service.validateScopeIds(authUser, [member.id, root.id, member.id]), [
        member.id,
        root.id,
      ])
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
      assert.deepEqual(
        await service.visibleDashboardIds(authUser, [dashboard]),
        new Set([dashboard.id]),
      )
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
      if (otherTenantId) {
        await prismaClient.orm.public.UserRoles.where({ tenantId: otherTenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId: otherTenantId }).deleteAll()
        await prismaClient.orm.public.Departments.where({ tenantId: otherTenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: otherTenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
