import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { HomeDepartmentScopeService } from './home-department-scope.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'HomeDepartmentScope 使用 Prisma 8 保持部门树排序与 ACTIVE 成员范围语义',
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
        data: { name: `Prisma8 Home Scope ${suffix}`, slug: `p8-home-scope-${suffix}` },
      })
      tenantId = tenant.id
      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '总部', sort: 0 },
      })
      const sales = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '销售部', parentId: root.id, sort: 1 },
      })
      const delivery = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '交付部', parentId: root.id, sort: 2 },
      })
      const self = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '当前用户',
          passwordHash: 'not-used',
          deptId: sales.id,
        },
      })
      const active = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '有效成员',
          passwordHash: 'not-used',
          deptId: delivery.id,
          status: 'ACTIVE',
        },
      })
      await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '停用成员',
          passwordHash: 'not-used',
          deptId: delivery.id,
          status: 'DISABLED',
        },
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
