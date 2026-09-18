import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { OpportunitiesService } from './opportunities.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OpportunitiesService production 路径使用 Prisma 8 保持阶段、CRUD、分页、流转与批量删除语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'opp-p8')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        email: suffix + '@example.com',
        passwordHash: 'test',
        name: '商机测试成员',
      })
      const user: AuthUser = {
        id: actor.id,
        tenantId: tenant.id,
        email: actor.email,
        name: actor.name,
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: ['*'],
      }
      const now = BigInt(Date.now())
      const org = prisma8Varchar(tenant.id, 32)
      const actorId = prisma8Varchar(actor.id, 32)
      const customer = await prisma8Client.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('商机专项客户', 255),
          owner: actorId,
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        })

      const fields = [
        { id: 'name', key: 'name', label: '商机名称', type: 'text', system: true, hidden: false },
      ]
      const service = new OpportunitiesService(
        prisma8,
        {
          directOwnerFilter: async () => ({}),
          resolveScope: async () => ({ all: true, deptIds: [] }),
        } as never,
        {
          listFields: async () => fields,
          computeFormulas: () => ({}),
        } as never,
        {} as never,
        {
          save: async () => undefined,
          saveBatch: async () => ({ count: 0 }),
          load: async (_tenantId: string, _type: string, ids: string[]) =>
            new Map(ids.map((id) => [id, {}])),
          filterResourceIds: async () => [],
        } as never,
        { send: async () => undefined } as never,
        { parse: () => null } as never,
        { resolveFilters: async () => null } as never,
        {} as never,
        {} as never,
        {
          config: async () => ({ dictList: [] }),
          validateReason: async () => null,
        } as never,
      )

      const stages = await service.listStages(tenant.id)
      assert.equal(stages.length, 7)
      assert.equal(stages[0]?.isWon, false)

      const created = await service.create(user, {
        name: 'Prisma8 商机',
        customerId: customer.id,
        amount: 120,
        ownerId: actor.id,
        customData: {},
        items: [],
      })
      assert.equal(created.name, 'Prisma8 商机')
      assert.equal(created.customerName, '商机专项客户')
      assert.equal(created.amount, 120)

      const page = await service.findAll(user, {
        page: 1,
        pageSize: 10,
        keyword: 'Prisma8 商机',
      })
      assert.equal(page.total, 1)
      assert.equal(page.items[0]?.id, created.id)

      const updated = await service.update(user, created.id, {
        name: 'Prisma8 商机更新',
        amount: 180,
      })
      assert.equal(updated.name, 'Prisma8 商机更新')
      assert.equal(updated.amount, 180)

      const targetStage = stages.find((stage) => !stage.system && stage.id !== created.stageId)
      assert.ok(targetStage)
      const changed = await service.changeStage(user, created.id, { stageId: targetStage.id })
      assert.equal(changed.id, created.id)
      const oracle = await prisma8Client.orm.public.Opportunity.where({
        id: prisma8Varchar(created.id, 32),
      }).first()
      assert.ok(oracle)
      assert.equal(oracle.stage, targetStage.id)
      assert.equal(Number(oracle.amount), 180)

      const batch = await service.batchUpdate(user, {
        ids: [created.id],
        fieldId: 'name',
        fieldValue: 'Prisma8 商机批改',
      })
      assert.equal(batch.count, 1)
      assert.equal(
        (
          await prisma8Client.orm.public.Opportunity.where({
            id: prisma8Varchar(created.id, 32),
          })
            .select('name')
            .first()
        )?.name,
        'Prisma8 商机批改',
      )

      const deleted = await service.batchDelete(user, [created.id])
      assert.equal(deleted.count, 1)
      assert.equal(
        (
          await prisma8Client.orm.public.Opportunity.where({
            id: prisma8Varchar(created.id, 32),
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      if (tenantId) {
        const org = prisma8Varchar(tenantId, 32)
        await prisma8Client.orm.public.Opportunity.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.Customer.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
