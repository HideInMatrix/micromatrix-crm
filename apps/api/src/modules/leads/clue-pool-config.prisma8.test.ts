import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import type { MetadataService } from '../metadata/metadata.service'
import type { CluePoolRepository } from '../pool-rules/clue-pool.repository'
import type { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { CluePoolConfigService } from './clue-pool-config.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'CluePoolConfig 使用 Prisma 8 保持 noPick、部门 scope 管理员与用户名称装配',
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
        data: { name: `Prisma8 clue pool config ${suffix}`, slug: `p8-clue-pool-${suffix}` },
      })
      tenantId = tenant.id
      const root = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '总部', sort: 0 },
      })
      const child = await fixtureDb.department.create({
        data: { tenantId: tenant.id, name: '销售部', parentId: root.id, sort: 1 },
      })
      const user = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          name: 'Clue Pool Operator',
          passwordHash: 'not-used',
          deptId: child.id,
        },
      })
      const now = BigInt(Date.now())
      const pool = await fixtureDb.cluePool.create({
        data: {
          name: 'Lead Pool',
          scopeId: JSON.stringify([`dept:${root.id}`]),
          organizationId: tenant.id,
          ownerId: JSON.stringify([`dept:${root.id}`]),
          enable: true,
          auto: false,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await fixtureDb.clue.create({
        data: {
          name: 'Pool Lead',
          owner: null,
          stage: 'NEW',
          organizationId: tenant.id,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
          poolId: pool.id,
          inSharedPool: true,
        },
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
        await fixtureDb.clue.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.cluePool.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.department.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
