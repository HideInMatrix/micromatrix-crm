import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { ScopeResolverService } from './scope-resolver.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ScopeResolver 使用 Prisma 保持 user/dept token 展开与租户隔离',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client

    let tenantId: string | null = null
    let otherTenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-scope')
      tenantId = tenant.id
      const otherTenant = await createPrismaTestTenant(prismaClient, 'p8-scope-other')
      otherTenantId = otherTenant.id
      const root = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '总部',
      })
      const sales = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '销售部',
        parentId: root.id,
        sort: 1,
      })
      const salesA = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '销售一部',
        parentId: sales.id,
        sort: 1,
      })
      const delivery = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '交付部',
        parentId: root.id,
        sort: 2,
      })
      const salesUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '销售成员',
        deptId: salesA.id,
      })
      const deliveryUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '交付成员',
        deptId: delivery.id,
      })
      const unassignedUser = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '无部门成员',
      })
      const foreignUser = await createPrismaTestUser(prismaClient, {
        tenantId: otherTenant.id,
        name: '其他租户成员',
      })

      const service = new ScopeResolverService({ client: prismaClient } as PrismaService)
      const authUser: AuthUser = {
        id: salesUser.id,
        tenantId: tenant.id,
        email: null,
        name: salesUser.name,
        deptId: salesA.id,
        leaderId: null,
        roles: [],
        permissions: [],
      }

      assert.equal(await service.matchesUser(authUser, [`dept:${sales.id}`]), true)
      assert.equal(await service.matchesUser(authUser, [`dept:${delivery.id}`]), false)
      assert.equal(await service.matchesUser(authUser, [`user:${salesUser.id}`]), true)

      const resolved = await service.resolveUserIds(tenant.id, [
        `dept:${sales.id}`,
        delivery.id,
        `user:${unassignedUser.id}`,
        `user:${foreignUser.id}`,
      ])
      assert.deepEqual(
        new Set(resolved),
        new Set([salesUser.id, deliveryUser.id, unassignedUser.id]),
      )
      assert.equal(resolved.includes(foreignUser.id), false)

      const wildcard = await service.resolveUserIds(tenant.id, ['*'])
      assert.deepEqual(
        new Set(wildcard),
        new Set([salesUser.id, deliveryUser.id, unassignedUser.id]),
      )
    } finally {
      if (tenantId) {
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
