import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ResourcePoolsService } from './resource-pools.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ResourcePools facade 使用 Prisma 8 保持 scope token、库容与 owner history 装配语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 resource pools ${suffix}`, slug: `p8-resource-pools-${suffix}` },
      })
      tenantId = tenant.id
      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: 'Root Department' },
      })
      const child = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: 'Child Department', parentId: root.id },
      })
      const actor = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Pool User',
          deptId: child.id,
          passwordHash: 'not-used',
        },
      })
      const role = await fixtureDb.role.create({
        data: { tenantId: tenant.id, name: `Pool Role ${suffix}` },
      })
      await fixtureDb.userRole.create({
        data: { tenantId: tenant.id, userId: actor.id, roleId: role.id },
      })
      const now = BigInt(Date.now())
      const clue = await fixtureDb.clue.create({
        data: {
          organizationId: tenant.id,
          name: 'Owned clue',
          owner: actor.id,
          stage: 'FOLLOWING',
          inSharedPool: false,
          createTime: now,
          updateTime: now,
          createUser: actor.id,
          updateUser: actor.id,
        },
      })
      await fixtureDb.customer.create({
        data: {
          organizationId: tenant.id,
          name: 'Owned customer',
          owner: actor.id,
          inSharedPool: false,
          createTime: now,
          updateTime: now,
          createUser: actor.id,
          updateUser: actor.id,
        },
      })

      const pool = {
        id: 'pool-visible',
        enable: true,
        scopeId: JSON.stringify([`dept:${root.id}`]),
        ownerId: JSON.stringify([`role:${role.id}`]),
      }
      const cluePools = {
        listPools: async () => [pool],
        listCapacities: async () => [
          { scopeId: JSON.stringify([`dept:${root.id}`]), capacity: 1 },
        ],
        listOwnerHistory: async () => [
          {
            id: 'history-1',
            owner: actor.id,
            operator: actor.id,
            reasonId: null,
            collectionTime: now - 1000n,
            endTime: now,
          },
        ],
      }
      const customerPools = {
        listPools: async () => [pool],
        listCapacities: async () => [
          { scopeId: JSON.stringify([`dept:${root.id}`]), capacity: 1 },
        ],
        listOwnerHistory: async () => [],
      }
      const dictionaries = {
        isEnabled: async () => false,
        reasonNames: async () => new Map<string, string>(),
      }
      const service = new ResourcePoolsService(
        { client: prisma8Client } as Prisma8Service,
        cluePools as never,
        customerPools as never,
        dictionaries as never,
      )
      const user = {
        id: actor.id,
        tenantId: tenant.id,
        deptId: child.id,
        permissions: [],
      } as unknown as AuthUser

      const options = await service.options(user, 'lead')
      assert.deepEqual(options.map((item) => item.id), ['pool-visible'])
      assert.equal(await service.isPoolManager(user, 'lead', 'pool-visible'), true)
      assert.equal((await service.assertPoolMember(user, 'lead', 'pool-visible')).id, 'pool-visible')
      assert.equal((await service.resolveMoveTargetPool(tenant.id, 'lead', actor.id)).id, 'pool-visible')

      await assert.rejects(
        () => service.assertCapacityForOwner(tenant.id, 'lead', actor.id, 1),
        BadRequestException,
      )
      await assert.rejects(
        () => service.assertCapacityForOwner(tenant.id, 'customer', actor.id, 1),
        BadRequestException,
      )
      await service.assertCapacityForOwner(tenant.id, 'lead', actor.id, 0)

      const history = await service.ownerHistory(user, 'lead', clue.id)
      assert.equal(history.length, 1)
      assert.equal(history[0]?.ownerName, 'Pool User')
      assert.equal(history[0]?.departmentId, child.id)
      assert.equal(history[0]?.departmentName, 'Child Department')
      assert.equal(history[0]?.operatorName, 'Pool User')
      assert.equal(history[0]?.reasonId, null)
    } finally {
      if (tenantId) {
        await fixtureDb.clueOwner.deleteMany({ where: { clue: { organizationId: tenantId } } })
        await fixtureDb.clue.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.userRole.deleteMany({ where: { tenantId } })
        await fixtureDb.role.deleteMany({ where: { tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.department.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
