import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../common/auth-user'
import type { MetadataService } from '../modules/metadata/metadata.service'
import type { CustomerPoolRepository } from '../modules/pool-rules/customer-pool.repository'
import type { PrismaService } from '../prisma.service'
import { createLegacyId32 } from '../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../testing/prisma-test-db'
import { CustomerPoolConfigService } from './customer-pool-config.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CustomerPoolConfig 使用 Prisma 保持 noPick、库容配置与用户名称装配',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-cpc')
      tenantId = tenant.id
      const user = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        name: 'Pool Operator',
      })
      const now = BigInt(Date.now())
      const organizationId = tenant.id
      const userId = user.id
      const pool = await prismaClient.orm.public.CustomerPool.select(
        'id',
        'scopeId',
        'organizationId',
        'name',
        'ownerId',
        'enable',
        'auto',
        'createTime',
        'updateTime',
        'createUser',
        'updateUser',
      ).create({
        id: createLegacyId32(),
        scopeId: JSON.stringify([user.id]),
        organizationId,
        name: 'Shared Pool',
        ownerId: JSON.stringify([user.id]),
        enable: true,
        auto: false,
        createTime: now,
        updateTime: now,
        createUser: userId,
        updateUser: userId,
      })
      await prismaClient.orm.public.Customer.create({
        id: createLegacyId32(),
        name: 'Pool Customer',
        owner: null,
        poolId: pool.id,
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: userId,
        updateUser: userId,
        inSharedPool: true,
      })
      let savedCapacity: number | null = null
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
        createCapacity: async (_tenantId: string, _userId: string, input: { capacity: number | null }) => {
          savedCapacity = input.capacity
        },
      } as unknown as CustomerPoolRepository
      const metadata = {
        listFields: async () => [],
      } as unknown as MetadataService
      const service = new CustomerPoolConfigService(
        { client: prismaClient } as PrismaService,
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
      })
      assert.equal(savedCapacity, 10)

      const page = await service.page(authUser, { current: 1, pageSize: 20 })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.createUserName, 'Pool Operator')
      assert.equal(page.list[0]?.updateUserName, 'Pool Operator')
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prismaClient.orm.public.Customer.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.CustomerPool.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
