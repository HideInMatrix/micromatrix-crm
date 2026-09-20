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
import { DataScopeService } from './data-scope.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DataScope 使用 Prisma 保持 CUSTOM 后代展开与 ACTIVE owner/creator 过滤',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-data-scope')
      tenantId = tenant.id
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
      const salesChild = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: '销售一部',
        parentId: sales.id,
        sort: 1,
      })
      const actor = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '当前用户',
        deptId: root.id,
      })
      const activeSales = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '销售成员',
        deptId: salesChild.id,
      })
      const disabledSales = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: '停用销售成员',
        deptId: sales.id,
        status: 'DISABLED',
      })
      const authUser: AuthUser = {
        id: actor.id,
        tenantId: tenant.id,
        email: null,
        name: actor.name,
        deptId: root.id,
        leaderId: null,
        permissions: ['menu:customer'],
        roles: [
          {
            id: 'role-custom',
            name: '销售范围',
            permissions: ['menu:customer'],
            dataScope: 'CUSTOM',
            scopeDeptIds: [sales.id],
          },
        ],
      }

      const service = new DataScopeService({ client: prismaClient } as PrismaService)
      assert.deepEqual(
        new Set(await service.collectWithDescendants(tenant.id, sales.id)),
        new Set([sales.id, salesChild.id]),
      )

      const ownerFilter = await service.directOwnerFilter(authUser, 'menu:customer')
      assert.deepEqual(ownerFilter, { owner: { in: [actor.id, activeSales.id] } })
      assert.equal(
        await service.matchesDirectOwner(authUser, activeSales.id, 'menu:customer'),
        true,
      )
      assert.equal(
        await service.matchesDirectOwner(authUser, disabledSales.id, 'menu:customer'),
        false,
      )

      const creatorFilter = await service.directCreatorFilter(authUser, 'menu:customer')
      assert.deepEqual(creatorFilter, { createUser: { in: [actor.id, activeSales.id] } })
      assert.equal(
        await service.matchesDirectCreator(authUser, activeSales.id, 'menu:customer'),
        true,
      )
      assert.equal(
        await service.matchesDirectCreator(authUser, disabledSales.id, 'menu:customer'),
        false,
      )
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Departments.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
