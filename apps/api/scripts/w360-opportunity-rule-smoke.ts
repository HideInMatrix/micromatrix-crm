import 'dotenv/config'
import assert from 'node:assert/strict'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import type { PrismaService } from '../src/prisma/prisma.service'
import { OpportunityRuleService } from '../src/modules/opportunities/opportunity-rule.service'

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! })
const prisma = new PrismaClient({ adapter })
const service = new OpportunityRuleService(prisma as unknown as PrismaService)
const prefix = `W360_RULE_SMOKE_${Date.now()}`

const cleanupRuleIds: string[] = []
let cleanupOpportunityId: string | null = null
const cleanupStageIds: string[] = []

async function main() {
  const actor = await prisma.user.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, tenantId: true },
  })
  assert(actor, '需要至少一个 ACTIVE 用户才能执行商机关闭规则 Smoke')

  let runningStage = await prisma.opportunityStageConfig.findFirst({
    where: { organizationId: actor.tenantId, type: 'AFOOT' },
    orderBy: { pos: 'asc' },
  })
  let failStage = await prisma.opportunityStageConfig.findFirst({
    where: { organizationId: actor.tenantId, type: 'END', rate: '0' },
    orderBy: { pos: 'asc' },
  })
  const now = BigInt(Date.now())
  if (!runningStage) {
    runningStage = await prisma.opportunityStageConfig.create({
      data: {
        name: 'Smoke进行中',
        type: 'AFOOT',
        rate: '50',
        afootRollBack: true,
        endRollBack: false,
        pos: 900001n,
        organizationId: actor.tenantId,
        createTime: now,
        updateTime: now,
        createUser: actor.id,
        updateUser: actor.id,
      },
    })
    cleanupStageIds.push(runningStage.id)
  }
  if (!failStage) {
    failStage = await prisma.opportunityStageConfig.create({
      data: {
        name: 'Smoke失败',
        type: 'END',
        rate: '0',
        afootRollBack: true,
        endRollBack: false,
        pos: 900002n,
        organizationId: actor.tenantId,
        createTime: now,
        updateTime: now,
        createUser: actor.id,
        updateUser: actor.id,
      },
    })
    cleanupStageIds.push(failStage.id)
  }

  const crud = await service.add(actor.tenantId, actor.id, {
    name: `${prefix}_CRUD`,
    scopeIds: [`user:${actor.id}`],
    ownerIds: [`user:${actor.id}`],
    enable: true,
    auto: false,
    operator: 'AND',
    conditions: [],
  })
  cleanupRuleIds.push(crud.id)
  let page = await service.page(actor.tenantId, { current: 1, pageSize: 50, keyword: `${prefix}_CRUD` })
  assert.equal(page.total, 1)
  assert.equal(page.list[0]?.members[0]?.id, `user:${actor.id}`)
  await service.update(actor.tenantId, actor.id, { id: crud.id, name: `${prefix}_CRUD_UPDATED` })
  await service.toggle(actor.tenantId, actor.id, crud.id)
  page = await service.page(actor.tenantId, { current: 1, pageSize: 50, keyword: `${prefix}_CRUD_UPDATED` })
  assert.equal(page.list[0]?.enable, false)
  await service.remove(actor.tenantId, crud.id)
  cleanupRuleIds.splice(cleanupRuleIds.indexOf(crud.id), 1)

  const matching = await service.add(actor.tenantId, actor.id, {
    name: `${prefix}_MATCH`,
    scopeIds: [`user:${actor.id}`],
    ownerIds: [`user:${actor.id}`],
    enable: true,
    auto: true,
    operator: 'AND',
    conditions: [
      { column: 'opportunityStage', operator: 'IN', value: runningStage.id, scope: [] },
    ],
  })
  cleanupRuleIds.push(matching.id)

  const newerNonMatching = await service.add(actor.tenantId, actor.id, {
    name: `${prefix}_NEWER`,
    scopeIds: [`user:${actor.id}`],
    ownerIds: [`user:${actor.id}`],
    enable: true,
    auto: true,
    operator: 'AND',
    conditions: [
      { column: 'opportunityStage', operator: 'NOT_IN', value: runningStage.id, scope: [] },
    ],
  })
  cleanupRuleIds.push(newerNonMatching.id)
  await prisma.opportunityRule.update({
    where: { id: newerNonMatching.id },
    data: { createTime: matching.createTime + 1000n },
  })

  const opportunity = await prisma.opportunity.create({
    data: {
      name: `${prefix}_OPPORTUNITY`,
      organizationId: actor.tenantId,
      stage: runningStage.id,
      owner: actor.id,
      updateUser: actor.id,
      createTime: BigInt(Date.now()),
      updateTime: BigInt(Date.now()),
      createUser: actor.id,
      pos: 900001n,
    },
  })
  cleanupOpportunityId = opportunity.id

  const firstRun = await service.executeAutoClose(new Date(), [matching.id, newerNonMatching.id])
  assert.equal(firstRun.affected, 0, '同 Scope 下应由最新规则优先；最新规则不命中时不能回退到旧规则')
  let current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })
  assert.equal(current.stage, runningStage.id)

  await service.remove(actor.tenantId, newerNonMatching.id)
  cleanupRuleIds.splice(cleanupRuleIds.indexOf(newerNonMatching.id), 1)
  const secondRun = await service.executeAutoClose(new Date(), [matching.id])
  assert.equal(secondRun.affected, 1)
  current = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunity.id } })
  assert.equal(current.lastStage, runningStage.id)
  assert.equal(current.stage, failStage.id)
  assert.equal(current.failureReason, 'system')

  console.log(
    JSON.stringify(
      {
        assertions: {
          crud: true,
          scopeResolution: true,
          latestRuleWins: true,
          autoClose: true,
          failureReasonSystem: true,
        },
        affected: secondRun.affected,
      },
      null,
      2,
    ),
  )
}

async function cleanup() {
  if (cleanupOpportunityId) {
    await prisma.opportunity.deleteMany({ where: { id: cleanupOpportunityId } })
  }
  if (cleanupRuleIds.length) {
    await prisma.opportunityRule.deleteMany({ where: { id: { in: cleanupRuleIds } } })
  }
  if (cleanupStageIds.length) {
    await prisma.opportunityStageConfig.deleteMany({ where: { id: { in: cleanupStageIds } } })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    await prisma.$disconnect()
  })

