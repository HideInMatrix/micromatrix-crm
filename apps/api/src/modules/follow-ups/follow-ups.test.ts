import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { createLegacyId32 } from '../../common/legacy-id'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { FollowUpsService } from './follow-ups.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'FollowUpsService production 路径使用 Prisma 保持 customer target CRUD、分页与 touch 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const prisma = { client: prismaClient } as PrismaService
    const suffix = randomUUID().replaceAll('-', '')
    const organizationId = `org-${suffix}`.slice(0, 32)
    const actorId = `u${suffix}`.slice(0, 32)
    const user: AuthUser = {
      id: actorId,
      tenantId: organizationId,
      email: `${suffix}@example.com`,
      name: '跟进测试成员',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }
    const customerAccess = {
      assertFollowRead: async () => ({ customer: { inSharedPool: false } }),
      assertFollowWrite: async () => ({ customer: { inSharedPool: false } }),
    }
    const fieldValues = {
      save: async () => undefined,
      load: async (_tenantId: string, _type: string, ids: string[]) =>
        new Map(ids.map((id) => [id, {}])),
      filterResourceIds: async () => [],
      buildAttachmentMap: async () => ({}),
      isAttachmentReferenced: async () => false,
    }
    const service = new FollowUpsService(
      prisma,
      customerAccess as never,
      {
        directOwnerFilter: async () => ({}),
        matchesDirectOwner: async () => true,
      } as never,
      { options: async () => [] } as never,
      {
        listFields: async () => [],
        getConfig: async () => ({ fields: [] }),
      } as never,
      fieldValues as never,
      { resolveFilters: async () => null } as never,
      {} as never,
    )

    try {
      await prismaClient.orm.public.Tenants.create({
        id: organizationId,
        name: '跟进专项租户',
        slug: `follow-${suffix}`,
        updatedAt: nowInstant(),
      })
      await prismaClient.orm.public.Users.create({
        id: actorId,
        tenantId: organizationId,
        email: user.email,
        passwordHash: 'test',
        name: user.name,
        updatedAt: nowInstant(),
      })
      const now = BigInt(Date.now())
      const org = organizationId
      const actor = actorId
      const customer = await prismaClient.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: '跟进专项客户',
        owner: actor,
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })

      const created = await service.create(user, {
        targetType: 'customer',
        targetId: customer.id,
        type: '电话',
        content: 'Prisma 真库首次跟进',
        followedAt: '2026-09-17T08:00:00.000Z',
      })
      assert.equal(created.targetId, customer.id)
      assert.equal(created.targetName, '跟进专项客户')
      assert.equal(created.customerId, customer.id)
      assert.equal(created.content, 'Prisma 真库首次跟进')

      const oracleCreated = await prismaClient.orm.public.FollowUpRecords.where({
        id: created.id,
      }).first()
      assert.ok(oracleCreated)
      assert.equal(oracleCreated.tenantId, organizationId)
      assert.equal(oracleCreated.targetType, 'customer')
      assert.equal(oracleCreated.targetId, customer.id)
      assert.equal(oracleCreated.content, 'Prisma 真库首次跟进')
      const touchedCustomer = await prismaClient.orm.public.Customer.where({
        id: customer.id,
      }).first()
      assert.ok(touchedCustomer)
      assert.equal(touchedCustomer.follower, actorId)
      assert.ok(touchedCustomer.followTime)

      const page = await service.page(user, {
        page: 1,
        pageSize: 10,
        targetType: 'customer',
        targetId: customer.id,
        keyword: '首次跟进',
      })
      assert.equal(page.total, 1)
      assert.equal(page.items[0]?.id, created.id)
      assert.equal(page.items[0]?.targetName, '跟进专项客户')

      const detail = await service.get(user, created.id)
      assert.equal(detail.id, created.id)
      assert.equal(detail.content, 'Prisma 真库首次跟进')

      const updated = await service.update(user, created.id, {
        content: 'Prisma 真库更新跟进',
        type: '微信',
      })
      assert.equal(updated.content, 'Prisma 真库更新跟进')
      assert.equal(updated.type, '微信')
      const oracleUpdated = await prismaClient.orm.public.FollowUpRecords.where({
        id: created.id,
      }).first()
      assert.ok(oracleUpdated)
      assert.equal(oracleUpdated.content, 'Prisma 真库更新跟进')
      assert.equal(oracleUpdated._type, '微信')

      const removed = await service.remove(user, created.id)
      assert.equal(removed.id, created.id)
      assert.equal(
        (await prismaClient.orm.public.FollowUpRecords.where({ id: created.id }).select('id').all())
          .length,
        0,
      )
    } finally {
      await prismaClient.orm.public.FollowUpRecords.where({ tenantId: organizationId }).deleteAll()
      await prismaClient.orm.public.Customer.where({ organizationId: organizationId }).deleteAll()
      await prismaClient.orm.public.Users.where({ tenantId: organizationId }).deleteAll()
      await prismaClient.orm.public.Tenants.where({ id: organizationId }).deleteAll()
      await testDb.close()
    }
  },
)
