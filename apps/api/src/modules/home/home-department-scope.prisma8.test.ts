import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { HomeDepartmentScopeService } from './home-department-scope.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'HomeDepartmentScope 使用 Prisma 8 保持部门树排序与 ACTIVE 成员范围语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-home-scope')
      tenantId = tenant.id
      const root = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '总部',
      })
      const sales = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '销售部',
        parentId: root.id,
        sort: 1,
      })
      const delivery = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '交付部',
        parentId: root.id,
        sort: 2,
      })
      const self = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '当前用户',
        deptId: sales.id,
      })
      const active = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '有效成员',
        deptId: delivery.id,
      })
      await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: '停用成员',
        deptId: delivery.id,
        status: 'DISABLED',
      })

      const authUser: AuthUser = {
        id: self.id,
        tenantId: tenant.id,
        email: null,
        name: self.name,
        deptId: sales.id,
        leaderId: null,
        permissions: ['menu:lead'],
        roles: [
          {
            id: 'role-all',
            name: '全部数据',
            permissions: ['menu:lead'],
            dataScope: 'ALL',
            scopeDeptIds: [],
          },
        ],
      }
      const dataScope = {
        resolveScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
        collectWithDescendants: async () => [],
        collectManyWithDescendants: async () => [],
      }
      const service = new HomeDepartmentScopeService(
        { client: prisma8Client } as Prisma8Service,
        dataScope as never,
      )

      const tree = await service.tree(authUser)
      assert.deepEqual(tree, [
        {
          id: root.id,
          name: root.name,
          children: [
            { id: sales.id, name: sales.name },
            { id: delivery.id, name: delivery.name },
          ],
        },
      ])

      const resolved = await service.resolve(
        authUser,
        'menu:lead',
        'DEPARTMENT',
        [delivery.id],
      )
      assert.deepEqual(resolved.deptIds, [delivery.id])
      assert.deepEqual(resolved.userIds, [active.id])
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
