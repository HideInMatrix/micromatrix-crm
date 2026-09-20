import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { ResourcePoolsService } from './resource-pools.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ResourcePools facade 使用 Prisma 保持 scope token、库容与 owner history 装配语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-resource-pools')
      tenantId = tenant.id
      const root = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: 'Root Department',
      })
      const child = await createPrismaTestDepartment(prismaClient, {
        tenantId: tenant.id,
        name: 'Child Department',
        parentId: root.id,
      })
      const actor = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Pool User',
        deptId: child.id,
      })
      const role = await prismaClient.orm.public.Roles.select('id').create({
        tenantId: tenant.id,
        name: `Pool Role ${suffix}`,
        updatedAt: nowInstant(),
      })
      await prismaClient.orm.public.UserRoles.create({
        tenantId: tenant.id,
        userId: actor.id,
        roleId: role.id,
        updatedAt: nowInstant(),
      })
      const now = BigInt(Date.now())
      const organizationId = tenant.id
      const actorId = actor.id
      const clue = await prismaClient.orm.public.Clue.select('id').create({
        id: createLegacyId32(),
        organizationId,
        name: 'Owned clue',
        owner: actorId,
        stage: 'FOLLOWING',
        inSharedPool: false,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
      await prismaClient.orm.public.Customer.create({
        id: createLegacyId32(),
        organizationId,
        name: 'Owned customer',
        owner: actorId,
        inSharedPool: false,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })

      const pool = {
        id: 'pool-visible',
        enable: true,
        scopeId: JSON.stringify([`dept:${root.id}`]),
        ownerId: JSON.stringify([`role:${role.id}`]),
      }
      const cluePools = {
        listPools: async () => [pool],
        listCapacities: async () => [{ scopeId: JSON.stringify([`dept:${root.id}`]), capacity: 1 }],
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
        listCapacities: async () => [{ scopeId: JSON.stringify([`dept:${root.id}`]), capacity: 1 }],
        listOwnerHistory: async () => [],
      }
      const dictionaries = {
        isEnabled: async () => false,
        reasonNames: async () => new Map<string, string>(),
      }
      const service = new ResourcePoolsService(
        { client: prismaClient } as PrismaService,
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
      assert.deepEqual(
        options.map((item) => item.id),
        ['pool-visible'],
      )
      assert.equal(await service.isPoolManager(user, 'lead', 'pool-visible'), true)
      assert.equal(
        (await service.assertPoolMember(user, 'lead', 'pool-visible')).id,
        'pool-visible',
      )
      assert.equal(
        (await service.resolveMoveTargetPool(tenant.id, 'lead', actor.id)).id,
        'pool-visible',
      )

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
        const organizationId = tenantId
        const clueIds = await prismaClient.orm.public.Clue.where({ organizationId })
          .select('id')
          .all()
        if (clueIds.length) {
          await prismaClient.orm.public.ClueOwner.where((row) =>
            row.clueId.in(clueIds.map((item) => item.id)),
          ).deleteAll()
        }
        await prismaClient.orm.public.Clue.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Customer.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.UserRoles.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Roles.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Departments.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
