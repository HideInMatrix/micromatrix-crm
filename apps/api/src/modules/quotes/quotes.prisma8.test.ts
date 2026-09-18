import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { QuotesService } from './quotes.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Quotes production 路径使用 Prisma 8 保持 create/list/get/snapshot/void/delete 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
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
      prisma8,
      approvals as never,
      dataScope as never,
      moduleForms as never,
      fieldValues as never,
      quotationFields as never,
      {} as never,
    )

    try {
      const now = BigInt(Date.now())
      const org = prisma8Varchar(organizationId, 32)
      const actor = prisma8Varchar(actorId, 32)
      const stage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('报价专项阶段', 16),
          _type: prisma8Varchar('AFOOT', 50),
          rate: prisma8Varchar('50', 10),
          pos: 1n,
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })
      const opportunity = await prisma8Client.orm.public.Opportunity
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('报价专项商机', 255),
          organizationId: org,
          stage: stage.id,
          owner: actor,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })

      const created = await service.create(user, {
        name: 'Prisma8 报价',
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
      assert.equal(snapshot.name, 'Prisma8 报价')
      assert.equal(snapshot.approvalStatus, 'NONE')

      const invalid = await service.setInvalid(user, created.id, true)
      assert.equal(invalid.invalid, true)
      assert.equal(
        (
          await prisma8Client.orm.public.OpportunityQuotation.where({
            id: prisma8Varchar(created.id, 32),
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
          await prisma8Client.orm.public.OpportunityQuotation.where({
            id: prisma8Varchar(created.id, 32),
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      const org = prisma8Varchar(organizationId, 32)
      await prisma8Client.orm.public.OpportunityQuotation.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Opportunity.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId: org }).deleteAll()
      await testDb.close()
    }
  },
)
