import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ScopeResolverService } from './scope-resolver.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ScopeResolver 使用 Prisma 8 保持 user/dept token 展开与租户隔离',
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
        data: { name: `Prisma8 Scope ${suffix}`, slug: `p8-scope-${suffix}` },
      })
      tenantId = tenant.id
      const otherTenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 Scope Other ${suffix}`, slug: `p8-scope-other-${suffix}` },
      })
      otherTenantId = otherTenant.id
      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '总部', sort: 0 },
      })
      const sales = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '销售部', parentId: root.id, sort: 1 },
      })
      const salesA = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '销售一部', parentId: sales.id, sort: 1 },
      })
      const delivery = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '交付部', parentId: root.id, sort: 2 },
      })
      const salesUser = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: '销售成员', passwordHash: 'not-used', deptId: salesA.id },
      })
      const deliveryUser = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: '交付成员', passwordHash: 'not-used', deptId: delivery.id },
      })
      const unassignedUser = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: '无部门成员', passwordHash: 'not-used' },
      })
      const foreignUser = await fixtureDb.user.create({
        data: { tenantId: otherTenant.id, name: '其他租户成员', passwordHash: 'not-used' },
      })

      const service = new ScopeResolverService({ client: prisma8Client } as Prisma8Service)
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
      assert.deepEqual(new Set(resolved), new Set([salesUser.id, deliveryUser.id, unassignedUser.id]))
      assert.equal(resolved.includes(foreignUser.id), false)

      const wildcard = await service.resolveUserIds(tenant.id, ['*'])
      assert.deepEqual(new Set(wildcard), new Set([salesUser.id, deliveryUser.id, unassignedUser.id]))
    } finally {
      if (tenantId) {
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
