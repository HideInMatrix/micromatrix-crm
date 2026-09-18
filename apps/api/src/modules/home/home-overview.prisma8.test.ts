import assert from 'node:assert/strict'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { ConfigService } from '@nestjs/config'
import type { AuthUser } from '../../common/auth-user'
import type { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { HomeOverviewService } from './home-overview.service'

const id32 = () => randomUUID().replaceAll('-', '')

test('HomeOverview 使用 Prisma 8 保持 owner scope、阶段聚合、排行、趋势与转化语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const config = { getOrThrow: () => databaseUrl } as unknown as ConfigService
  const fixtureDb = createPrismaFixtureClient(databaseUrl)
  const prisma8 = new Prisma8Service(config)
  await fixtureDb.$connect()
  await prisma8.onModuleInit()

  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await fixtureDb.tenant.create({
    data: { name: `p8-home-overview-${suffix}`, slug: `p8-home-overview-${suffix}` },
  })
  const owner = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `owner-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '首页负责人',
      defaultPwd: false,
    },
  })
  const other = await fixtureDb.user.create({
    data: {
      tenantId: tenant.id,
      email: `other-${suffix}@example.com`,
      passwordHash: 'test-only',
      name: '其它负责人',
      defaultPwd: false,
    },
  })
  const actor: AuthUser = {
    id: owner.id,
    tenantId: tenant.id,
    email: owner.email,
    name: owner.name,
    deptId: null,
    leaderId: null,
    roles: [],
    permissions: ['menu:dashboard'],
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const eventAt = BigInt(Math.max(monthStart.getTime() + 60_000, now.getTime() - 60_000))
  const stageAfoot = id32()
  const stageWon = id32()
  const stageLost = id32()
  const stageBase = {
    organizationId: tenant.id,
    afootRollBack: false,
    endRollBack: false,
    createTime: eventAt,
    updateTime: eventAt,
    createUser: owner.id,
    updateUser: owner.id,
  }

  try {
    await fixtureDb.opportunityStageConfig.createMany({
      data: [
        { ...stageBase, id: stageAfoot, name: '推进', type: 'AFOOT', rate: '50', pos: 1n },
        { ...stageBase, id: stageWon, name: '赢单', type: 'END', rate: '100', pos: 2n },
        { ...stageBase, id: stageLost, name: '输单', type: 'END', rate: '0', pos: 3n },
      ],
    })

    await fixtureDb.clue.createMany({
      data: [
        {
          id: id32(), name: '线索一', owner: owner.id, stage: 'NEW', organizationId: tenant.id,
          createTime: eventAt, updateTime: eventAt, createUser: owner.id, updateUser: owner.id,
          transitionId: id32(),
        },
        {
          id: id32(), name: '线索二', owner: owner.id, stage: 'NEW', organizationId: tenant.id,
          createTime: eventAt, updateTime: eventAt, createUser: owner.id, updateUser: owner.id,
        },
        {
          id: id32(), name: '跨 scope 线索', owner: other.id, stage: 'NEW', organizationId: tenant.id,
          createTime: eventAt, updateTime: eventAt, createUser: other.id, updateUser: other.id,
          transitionId: id32(),
        },
      ],
    })

    await fixtureDb.customer.createMany({
      data: [
        {
          id: id32(), name: '客户一', owner: owner.id, organizationId: tenant.id,
          createTime: eventAt, updateTime: eventAt, createUser: owner.id, updateUser: owner.id,
        },
        {
          id: id32(), name: '跨 scope 客户', owner: other.id, organizationId: tenant.id,
          createTime: eventAt, updateTime: eventAt, createUser: other.id, updateUser: other.id,
        },
      ],
    })

    await fixtureDb.opportunity.createMany({
      data: [
        {
          id: id32(), name: '推进商机', owner: owner.id, stage: stageAfoot, amount: 20,
          organizationId: tenant.id, createTime: eventAt, updateTime: eventAt,
          createUser: owner.id, updateUser: owner.id,
        },
        {
          id: id32(), name: '赢单商机', owner: owner.id, stage: stageWon, amount: 100,
          organizationId: tenant.id, createTime: eventAt, updateTime: eventAt,
          actualEndTime: eventAt, createUser: owner.id, updateUser: owner.id,
        },
        {
          id: id32(), name: '输单商机', owner: owner.id, stage: stageLost, amount: 50,
          organizationId: tenant.id, createTime: eventAt, updateTime: eventAt,
          actualEndTime: eventAt, failureReason: '价格', createUser: owner.id, updateUser: owner.id,
        },
        {
          id: id32(), name: '跨 scope 赢单', owner: other.id, stage: stageWon, amount: 999,
          organizationId: tenant.id, createTime: eventAt, updateTime: eventAt,
          actualEndTime: eventAt, createUser: other.id, updateUser: other.id,
        },
      ],
    })

    const dataScope = {
      directOwnerFilter: async () => ({ owner: owner.id }),
    } as unknown as DataScopeService
    const service = new HomeOverviewService(prisma8, dataScope)

    const summary = await service.summary(actor)
    assert.equal(summary.newLeads, 2)
    assert.equal(summary.newCustomers, 1)
    assert.equal(summary.newOpportunities, 3)
    assert.equal(summary.wonAmount, 100)
    assert.equal(summary.receivedAmount, 0)

    const funnel = await service.funnel(actor)
    assert.deepEqual(
      funnel.map((item) => [item.name, item.count, item.amount]),
      [
        ['推进', 1, 20],
        ['赢单', 1, 100],
      ],
    )

    const ranking = await service.ranking(actor)
    assert.deepEqual(ranking.won, [{ name: owner.name, amount: 100, count: 1 }])

    const trend = await service.trend(actor)
    assert.equal(trend.won.at(-1), 100)
    assert.equal(trend.received.at(-1), 0)

    const conversion = await service.conversion(actor)
    assert.equal(conversion.totalLeads, 2)
    assert.equal(conversion.convertedLeads, 1)
    assert.equal(conversion.conversionRate, 50)
    assert.deepEqual(conversion.lostReasons, [{ reason: '价格', count: 1 }])
  } finally {
    await fixtureDb.opportunity.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.clue.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.customer.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.opportunityStageConfig.deleteMany({ where: { organizationId: tenant.id } })
    await fixtureDb.user.deleteMany({ where: { tenantId: tenant.id } })
    await fixtureDb.tenant.delete({ where: { id: tenant.id } })
    await prisma8.onModuleDestroy()
    await fixtureDb.$disconnect()
  }
})
