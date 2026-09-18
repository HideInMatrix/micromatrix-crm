import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { createLegacyId32 } from '../../common/legacy-id'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { QuotesService } from './quotes.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Quotes production 路径使用 Prisma 保持 create/list/get/snapshot/void/delete 语义',
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
      name: '报价测试成员',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }
    const approvals = {
      flowRequired: async () => false,
      submit: async () => ({ id: 'unused' }),
      cancelTarget: async () => undefined,
      handleTargetApproval: async () => undefined,
      capturePreUpdateSnapshot: async () => null,
    }
    const dataScope = {
      directCreatorFilter: async () => ({}),
      matchesDirectCreator: async () => true,
      resolveScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
    }
    const moduleForms = {
      listFields: async () => [],
      getConfig: async () => ({}),
    }
    const fieldValues = {
      save: async () => undefined,
      saveBatch: async (_tenantId: string, _type: string, ids: string[]) => ({ count: ids.length }),
      load: async (_tenantId: string, _type: string, ids: string[]) =>
        new Map(ids.map((id) => [id, {}])),
      filterResourceIds: async () => [],
    }
    const quotationFields = {
      saveProducts: async () => undefined,
      loadProducts: async () => [],
      loadProductsBatch: async () => new Map(),
    }
    const service = new QuotesService(
      prisma,
      approvals as never,
      dataScope as never,
      moduleForms as never,
      fieldValues as never,
      quotationFields as never,
      {} as never,
    )

    try {
      const now = BigInt(Date.now())
      const org = organizationId
      const actor = actorId
      const stage = await prismaClient.orm.public.OpportunityStageConfig.select('id').create({
        id: createLegacyId32(),
        name: '报价专项阶段',
        _type: 'AFOOT',
        rate: '50',
        pos: 1n,
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const opportunity = await prismaClient.orm.public.Opportunity.select('id').create({
        id: createLegacyId32(),
        name: '报价专项商机',
        organizationId: org,
        stage: stage.id,
        owner: actor,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })

      const created = await service.create(user, {
        name: 'Prisma 报价',
        opportunityId: opportunity.id,
        untilTime: Date.now() + 86_400_000,
        amount: 128.5,
        moduleFields: [],
        moduleFormConfigDTO: { version: 1 },
        products: [],
      })
      assert.equal(created.opportunityName, '报价专项商机')
      assert.equal(created.amount, 128.5)

      const page = await service.list(user, {
        current: 1,
        pageSize: 10,
        keyword: '报价专项商机',
      })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.id, created.id)

      const snapshot = (await service.getSnapshot(user, created.id)) as Record<string, unknown>
      assert.equal(snapshot.name, 'Prisma 报价')
      assert.equal(snapshot.approvalStatus, 'NONE')

      const invalid = await service.setInvalid(user, created.id, true)
      assert.equal(invalid.invalid, true)
      assert.equal(
        (
          await prismaClient.orm.public.OpportunityQuotation.where({
            id: created.id,
          })
            .select('invalid')
            .first()
        )?.invalid,
        true,
      )

      const removed = await service.remove(user, created.id)
      assert.equal(removed.pendingApproval, false)
      assert.equal(
        (
          await prismaClient.orm.public.OpportunityQuotation.where({
            id: created.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      const org = organizationId
      await prismaClient.orm.public.OpportunityQuotation.where({ organizationId: org }).deleteAll()
      await prismaClient.orm.public.Opportunity.where({ organizationId: org }).deleteAll()
      await prismaClient.orm.public.OpportunityStageConfig.where({
        organizationId: org,
      }).deleteAll()
      await testDb.close()
    }
  },
)
