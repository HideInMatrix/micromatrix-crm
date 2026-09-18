import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../common/auth-user'
import { createPrismaFixtureClient } from '../testing/prisma-fixture-client'
import type { MetadataService } from '../modules/metadata/metadata.service'
import type { CustomerPoolRepository } from '../modules/pool-rules/customer-pool.repository'
import { createPrisma8Client } from '../prisma/prisma8-client'
import type { Prisma8Service } from '../prisma/prisma8.service'
import { CustomerPoolConfigService } from './customer-pool-config.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CustomerPoolConfig 使用 Prisma 8 保持 noPick、阶段校验与用户名称装配',
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
        data: { name: `Prisma8 customer pool config ${suffix}`, slug: `p8-cpc-${suffix}` },
      })
      tenantId = tenant.id
      const user = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Pool Operator', passwordHash: 'not-used' },
      })
      const now = BigInt(Date.now())
      const pool = await fixtureDb.customerPool.create({
        data: {
          scopeId: JSON.stringify([user.id]),
          organizationId: tenant.id,
          name: 'Shared Pool',
          ownerId: JSON.stringify([user.id]),
          enable: true,
          auto: false,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await fixtureDb.customer.create({
        data: {
          name: 'Pool Customer',
          owner: null,
          poolId: pool.id,
          organizationId: tenant.id,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
          inSharedPool: true,
        },
      })
      const stage = await fixtureDb.opportunityStageConfig.create({
        data: {
          name: '进行中',
          type: 'AFOOT',
          rate: '50',
          pos: 1n,
          organizationId: tenant.id,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })

      let savedFilters: unknown = null
      const repository = {
        listPools: async () => [
          {
            ...pool,
            hiddenFields: [],
            pickRule: null,
            recycleRule: null,
          },
        ],
        listCapacities: async () => [],
        createCapacity: async (
          _tenantId: string,
          _userId: string,
          input: { filters: unknown },
        ) => {
          savedFilters = input.filters
        },
      } as unknown as CustomerPoolRepository
      const metadata = {
        listFields: async () => [],
      } as unknown as MetadataService
      const service = new CustomerPoolConfigService(
        { client: prisma8Client } as Prisma8Service,
        metadata,
        repository,
      )
      const authUser = {
        id: user.id,
        tenantId: tenant.id,
        email: null,
        name: user.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: [],
      } satisfies AuthUser

      assert.equal(await service.noPick(authUser, pool.id), true)

      await service.addCapacity(authUser, {
        scopeIds: [user.id],
        capacity: 10,
        filters: [{ column: 'stage', operator: 'NOT_IN', value: [stage.id] }],
      })
      assert.deepEqual(savedFilters, [
        { column: 'stage', operator: 'NOT_IN', value: [stage.id] },
      ])

      await assert.rejects(
        () =>
          service.addCapacity(authUser, {
            scopeIds: [user.id],
            capacity: 10,
            filters: [{ column: 'stage', operator: 'NOT_IN', value: ['missing-stage'] }],
          }),
        /客户库容排除条件包含不存在的商机阶段/,
      )

      const page = await service.page(authUser, { current: 1, pageSize: 20 })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.createUserName, 'Pool Operator')
      assert.equal(page.list[0]?.updateUserName, 'Pool Operator')
    } finally {
      if (tenantId) {
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.customerPool.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.opportunityStageConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
