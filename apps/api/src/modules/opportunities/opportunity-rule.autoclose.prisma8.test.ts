import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
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

      const organizationId = tenant.id
      const actorId = actor
      const openStage = await prisma8Client.orm.public.OpportunityStageConfig.select('id').create({
        id: createLegacyId32(),
        name: '跟进',
        _type: 'AFOOT',
        rate: '50',
        pos: 1n,
        organizationId,
        createTime: nowMs,
        updateTime: nowMs,
        createUser: actorId,
        updateUser: actorId,
      })
      stageIds.push(openStage.id)
      const failStage = await prisma8Client.orm.public.OpportunityStageConfig.select('id').create({
        id: createLegacyId32(),
        name: '失败',
        _type: 'END',
        rate: '0',
        pos: 2n,
        organizationId,
        createTime: nowMs,
        updateTime: nowMs,
        createUser: actorId,
        updateUser: actorId,
      })
      stageIds.push(failStage.id)

      const opportunity = await prisma8Client.orm.public.Opportunity.select('id').create({
        id: createLegacyId32(),
        name: '应自动关闭商机',
        organizationId,
        stage: openStage.id,
        owner: user.id,
        updateUser: actorId,
        createTime: nowMs,
        updateTime: nowMs,
        createUser: actorId,
      })
      opportunityId = opportunity.id
      const rule = await prisma8Client.orm.public.OpportunityRule.select('id').create({
        id: createLegacyId32(),
        name: 'Prisma8 自动关闭规则',
        organizationId,
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
      if (opportunityId)
        await prisma8Client.orm.public.Opportunity.where({ id: opportunityId }).deleteAll()
      if (ruleId) await prisma8Client.orm.public.OpportunityRule.where({ id: ruleId }).deleteAll()
      if (stageIds.length) {
        await prisma8Client.orm.public.OpportunityStageConfig.where((row) =>
          row.id.in(stageIds.map((id) => id)),
        ).deleteAll()
      }
      if (tenantId) {
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
