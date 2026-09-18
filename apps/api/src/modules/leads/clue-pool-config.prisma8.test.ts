import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { MetadataService } from '../metadata/metadata.service'
import type { CluePoolRepository } from '../pool-rules/clue-pool.repository'
import type { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestDepartment,
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { CluePoolConfigService } from './clue-pool-config.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CluePoolConfig 使用 Prisma 8 保持 noPick、部门 scope 管理员与用户名称装配',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-clue-pool')
      tenantId = tenant.id
      const root = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '总部',
      })
      const child = await createPrismaTestDepartment(prisma8Client, {
        tenantId: tenant.id,
        name: '销售部',
        parentId: root.id,
        sort: 1,
      })
      const user = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Clue Pool Operator',
        deptId: child.id,
      })
      const now = BigInt(Date.now())
      const organizationId = tenant.id
      const userId = user.id
      const pool = await prisma8Client.orm.public.CluePool.select(
        'id',
        'name',
        'scopeId',
        'organizationId',
        'ownerId',
        'enable',
        'auto',
        'createTime',
        'updateTime',
        'createUser',
        'updateUser',
      ).create({
        id: createLegacyId32(),
        name: 'Lead Pool',
        scopeId: JSON.stringify([`dept:${root.id}`]),
        organizationId,
        ownerId: JSON.stringify([`dept:${root.id}`]),
        enable: true,
        auto: false,
        createTime: now,
        updateTime: now,
        createUser: userId,
        updateUser: userId,
      })
      await prisma8Client.orm.public.Clue.create({
        id: createLegacyId32(),
        name: 'Pool Lead',
        owner: null,
        stage: 'NEW',
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: userId,
        updateUser: userId,
        poolId: pool.id,
        inSharedPool: true,
      })

      const poolRow = {
        ...pool,
        hiddenFields: [],
        pickRule: null,
        recycleRule: null,
      }
      const repository = {
        listPools: async () => [poolRow],
        listCapacities: async () => [],
      } as unknown as CluePoolRepository
      const metadata = { listFields: async () => [] } as unknown as MetadataService
      const resourcePools = { options: async () => [poolRow] } as unknown as ResourcePoolsService
      const service = new CluePoolConfigService(
        { client: prisma8Client } as Prisma8Service,
        metadata,
        repository,
        resourcePools,
      )
      const authUser = {
        id: user.id,
        tenantId: tenant.id,
        email: null,
        name: user.name,
        deptId: child.id,
        leaderId: null,
        roles: [],
        permissions: [],
      } satisfies AuthUser

      assert.equal(await service.noPick(authUser, pool.id), true)
      const page = await service.page(authUser, { current: 1, pageSize: 20 })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.editable, true)
      assert.equal(page.list[0]?.createUserName, 'Clue Pool Operator')
      assert.equal(page.list[0]?.updateUserName, 'Clue Pool Operator')
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prisma8Client.orm.public.Clue.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.CluePool.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Departments.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
