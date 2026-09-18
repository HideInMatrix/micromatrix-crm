import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { DataScopeService } from './data-scope.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'DataScope 使用 Prisma 8 保持 CUSTOM 后代展开与 ACTIVE owner/creator 过滤',
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
        data: { name: `Prisma8 Data Scope ${suffix}`, slug: `p8-data-scope-${suffix}` },
      })
      tenantId = tenant.id
      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '总部', sort: 0 },
      })
      const sales = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '销售部', parentId: root.id, sort: 1 },
      })
      const salesChild = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '销售一部', parentId: sales.id, sort: 1 },
      })
      const actor = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: '当前用户', passwordHash: 'not-used', deptId: root.id },
      })
      const activeSales = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '销售成员',
          passwordHash: 'not-used',
          deptId: salesChild.id,
          status: 'ACTIVE',
        },
      })
      const disabledSales = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: '停用销售成员',
          passwordHash: 'not-used',
          deptId: sales.id,
          status: 'DISABLED',
        },
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

      const service = new DataScopeService({ client: prisma8Client } as Prisma8Service)
      assert.deepEqual(new Set(await service.collectWithDescendants(tenant.id, sales.id)), new Set([sales.id, salesChild.id]))

      const ownerFilter = await service.directOwnerFilter(authUser, 'menu:customer')
      assert.deepEqual(ownerFilter, { owner: { in: [actor.id, activeSales.id] } })
      assert.equal(await service.matchesDirectOwner(authUser, activeSales.id, 'menu:customer'), true)
      assert.equal(await service.matchesDirectOwner(authUser, disabledSales.id, 'menu:customer'), false)

      const creatorFilter = await service.directCreatorFilter(authUser, 'menu:customer')
      assert.deepEqual(creatorFilter, { createUser: { in: [actor.id, activeSales.id] } })
      assert.equal(await service.matchesDirectCreator(authUser, activeSales.id, 'menu:customer'), true)
      assert.equal(await service.matchesDirectCreator(authUser, disabledSales.id, 'menu:customer'), false)
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
