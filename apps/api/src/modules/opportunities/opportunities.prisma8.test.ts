import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { OpportunitiesService } from './opportunities.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OpportunitiesService production 路径使用 Prisma 8 保持阶段、CRUD、分页、流转与批量删除语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: 'Opportunity Prisma8 ' + suffix, slug: 'opp-p8-' + suffix },
      })
      tenantId = tenant.id
      const actor = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          email: suffix + '@example.com',
          passwordHash: 'test',
          name: '商机测试成员',
        },
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
      const customer = await fixtureDb.customer.create({
        data: {
          name: '商机专项客户',
          owner: actor.id,
          organizationId: tenant.id,
          createTime: now,
          updateTime: now,
          createUser: actor.id,
          updateUser: actor.id,
        },
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
      const oracle = await fixtureDb.opportunity.findUniqueOrThrow({ where: { id: created.id } })
      assert.equal(oracle.stage, targetStage.id)
      assert.equal(Number(oracle.amount), 180)

      const batch = await service.batchUpdate(user, {
        ids: [created.id],
        fieldId: 'name',
        fieldValue: 'Prisma8 商机批改',
      })
      assert.equal(batch.count, 1)
      assert.equal(
        (await fixtureDb.opportunity.findUniqueOrThrow({ where: { id: created.id } })).name,
        'Prisma8 商机批改',
      )

      const deleted = await service.batchDelete(user, [created.id])
      assert.equal(deleted.count, 1)
      assert.equal(await fixtureDb.opportunity.count({ where: { id: created.id } }), 0)
    } finally {
      if (tenantId) {
        await fixtureDb.opportunity.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.opportunityStageConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
