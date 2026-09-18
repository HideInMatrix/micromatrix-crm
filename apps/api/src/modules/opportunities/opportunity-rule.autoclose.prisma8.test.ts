import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { OpportunityRuleService } from './opportunity-rule.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Opportunity auto-close 由 Prisma 8 展开 scope 并回写失败阶段',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const actor = `u${suffix}`.slice(0, 32)
    const nowMs = BigInt(Date.now())

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    let ruleId: string | null = null
    let opportunityId: string | null = null
    const stageIds: string[] = []
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 opportunity ${suffix}`, slug: `p8-opp-${suffix}` },
      })
      tenantId = tenant.id
      const user = await fixtureDb.user.create({
        data: {
          tenantId: tenant.id,
          email: `p8-opp-${suffix}@example.com`,
          passwordHash: 'integration-test',
          name: 'Prisma8 Auto Close Owner',
          status: 'ACTIVE',
        },
      })

      const openStage = await fixtureDb.opportunityStageConfig.create({
        data: {
          name: '跟进',
          type: 'AFOOT',
          rate: '50',
          pos: 1n,
          organizationId: tenant.id,
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actor,
          updateUser: actor,
        },
      })
      stageIds.push(openStage.id)
      const failStage = await fixtureDb.opportunityStageConfig.create({
        data: {
          name: '失败',
          type: 'END',
          rate: '0',
          pos: 2n,
          organizationId: tenant.id,
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actor,
          updateUser: actor,
        },
      })
      stageIds.push(failStage.id)

      const opportunity = await fixtureDb.opportunity.create({
        data: {
          name: '应自动关闭商机',
          organizationId: tenant.id,
          stage: openStage.id,
          owner: user.id,
          updateUser: actor,
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actor,
        },
      })
      opportunityId = opportunity.id
      const rule = await fixtureDb.opportunityRule.create({
        data: {
          name: 'Prisma8 自动关闭规则',
          organizationId: tenant.id,
          ownerId: JSON.stringify([user.id]),
          scopeId: JSON.stringify(['*']),
          enable: true,
          auto: true,
          operator: 'AND',
          condition: JSON.stringify([
            { column: 'opportunityStage', operator: 'IN', value: openStage.id },
          ]),
          createTime: nowMs,
          updateTime: nowMs,
          createUser: actor,
          updateUser: actor,
        },
      })
      ruleId = rule.id

      const service = new OpportunityRuleService({ client: prisma8Client } as Prisma8Service)
      assert.deepEqual(await service.executeAutoClose(new Date(), [rule.id]), {
        rules: 1,
        affected: 1,
      })

      const persisted = await fixtureDb.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })
      assert.equal(persisted.stage, failStage.id)
      assert.equal(persisted.lastStage, openStage.id)
      assert.equal(persisted.failureReason, 'system')
    } finally {
      if (opportunityId) await fixtureDb.opportunity.deleteMany({ where: { id: opportunityId } })
      if (ruleId) await fixtureDb.opportunityRule.deleteMany({ where: { id: ruleId } })
      if (stageIds.length) await fixtureDb.opportunityStageConfig.deleteMany({ where: { id: { in: stageIds } } })
      if (tenantId) {
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
