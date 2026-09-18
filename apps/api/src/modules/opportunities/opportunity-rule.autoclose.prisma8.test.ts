import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { OpportunityRuleService } from './opportunity-rule.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Opportunity auto-close 由 Prisma 8 展开 scope 并回写失败阶段',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const actor = `u${suffix}`.slice(0, 32)
    const nowMs = BigInt(Date.now())

    let tenantId: string | null = null
    let ruleId: string | null = null
    let opportunityId: string | null = null
    const stageIds: string[] = []
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-opp-auto-close')
      tenantId = tenant.id
      const user = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        email: `p8-opp-${suffix}@example.com`,
        passwordHash: 'integration-test',
        name: 'Prisma8 Auto Close Owner',
      })

      const organizationId = prisma8Varchar(tenant.id, 32)
      const actorId = prisma8Varchar(actor, 32)
      const openStage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('跟进', 16),
          _type: prisma8Varchar('AFOOT', 50),
          rate: prisma8Varchar('50', 10),
          pos: 1n,
          organizationId,
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actorId,
          updateUser: actorId,
      })
      stageIds.push(openStage.id)
      const failStage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('失败', 16),
          _type: prisma8Varchar('END', 50),
          rate: prisma8Varchar('0', 10),
          pos: 2n,
          organizationId,
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actorId,
          updateUser: actorId,
      })
      stageIds.push(failStage.id)

      const opportunity = await prisma8Client.orm.public.Opportunity
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('应自动关闭商机', 255),
          organizationId,
          stage: openStage.id,
          owner: prisma8Varchar(user.id, 32),
          updateUser: actorId,
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actorId,
      })
      opportunityId = opportunity.id
      const rule = await prisma8Client.orm.public.OpportunityRule
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('Prisma8 自动关闭规则', 255),
          organizationId,
          ownerId: JSON.stringify([user.id]),
          scopeId: JSON.stringify(['*']),
          enable: true,
          auto: true,
          operator: prisma8Varchar('AND', 10),
          condition: JSON.stringify([
            { column: 'opportunityStage', operator: 'IN', value: openStage.id },
          ]),
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actorId,
          updateUser: actorId,
      })
      ruleId = rule.id

      const service = new OpportunityRuleService({ client: prisma8Client } as Prisma8Service)
      assert.deepEqual(await service.executeAutoClose(new Date(), [rule.id]), {
        rules: 1,
        affected: 1,
      })

      const persisted = await prisma8Client.orm.public.Opportunity.where({ id: opportunity.id })
        .select('stage', 'lastStage', 'failureReason')
        .first()
      assert.ok(persisted)
      assert.equal(persisted.stage, failStage.id)
      assert.equal(persisted.lastStage, openStage.id)
      assert.equal(persisted.failureReason, 'system')
    } finally {
      if (opportunityId) await prisma8Client.orm.public.Opportunity.where({ id: prisma8Varchar(opportunityId, 32) }).deleteAll()
      if (ruleId) await prisma8Client.orm.public.OpportunityRule.where({ id: prisma8Varchar(ruleId, 32) }).deleteAll()
      if (stageIds.length) {
        await prisma8Client.orm.public.OpportunityStageConfig
          .where((row) => row.id.in(stageIds.map((id) => prisma8Varchar(id, 32))))
          .deleteAll()
      }
      if (tenantId) {
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
