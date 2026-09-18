import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { DataScopeService } from '../../common/services/data-scope.service'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { HomeOverviewService } from './home-overview.service'

test('HomeOverview 使用 Prisma 8 保持 owner scope、阶段聚合、排行、趋势与转化语义', async (t) => {
  const databaseUrl = process.env['DATABASE_URL']
  if (!databaseUrl) return t.skip('DATABASE_URL 未配置')

  const testDb = await openPrismaTestDatabase(databaseUrl)
  const prisma8Client = testDb.client
  const prisma8 = { client: prisma8Client } as Prisma8Service
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const tenant = await createPrismaTestTenant(prisma8Client, 'p8-home-overview')
  const owner = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `owner-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: '首页负责人',
  })
  const other = await createPrismaTestUser(prisma8Client, {
    tenantId: tenant.id,
    email: `other-${suffix}@example.com`,
    passwordHash: 'test-only',
    name: '其它负责人',
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
  const organizationId = tenant.id
  const ownerId = owner.id
  const otherId = other.id
  const stageAfoot = createLegacyId32()
  const stageWon = createLegacyId32()
  const stageLost = createLegacyId32()
  const stageBase = {
    organizationId,
    afootRollBack: false,
    endRollBack: false,
    createTime: eventAt,
    updateTime: eventAt,
    createUser: ownerId,
    updateUser: ownerId,
  }

  try {
    await prisma8Client.orm.public.OpportunityStageConfig.createAll([
      {
        ...stageBase,
        id: stageAfoot,
        name: '推进',
        _type: 'AFOOT',
        rate: '50',
        pos: 1n,
      },
      {
        ...stageBase,
        id: stageWon,
        name: '赢单',
        _type: 'END',
        rate: '100',
        pos: 2n,
      },
      {
        ...stageBase,
        id: stageLost,
        name: '输单',
        _type: 'END',
        rate: '0',
        pos: 3n,
      },
    ])

    await prisma8Client.orm.public.Clue.createAll([
      {
        id: createLegacyId32(),
        name: '线索一',
        owner: ownerId,
        stage: 'NEW',
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        createUser: ownerId,
        updateUser: ownerId,
        transitionId: createLegacyId32(),
      },
      {
        id: createLegacyId32(),
        name: '线索二',
        owner: ownerId,
        stage: 'NEW',
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        createUser: ownerId,
        updateUser: ownerId,
      },
      {
        id: createLegacyId32(),
        name: '跨 scope 线索',
        owner: otherId,
        stage: 'NEW',
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        createUser: otherId,
        updateUser: otherId,
        transitionId: createLegacyId32(),
      },
    ])

    await prisma8Client.orm.public.Customer.createAll([
      {
        id: createLegacyId32(),
        name: '客户一',
        owner: ownerId,
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        createUser: ownerId,
        updateUser: ownerId,
      },
      {
        id: createLegacyId32(),
        name: '跨 scope 客户',
        owner: otherId,
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        createUser: otherId,
        updateUser: otherId,
      },
    ])

    await prisma8Client.orm.public.Opportunity.createAll([
      {
        id: createLegacyId32(),
        name: '推进商机',
        owner: ownerId,
        stage: stageAfoot,
        amount: prisma8Numeric(20, 20, 10),
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        createUser: ownerId,
        updateUser: ownerId,
      },
      {
        id: createLegacyId32(),
        name: '赢单商机',
        owner: ownerId,
        stage: stageWon,
        amount: prisma8Numeric(100, 20, 10),
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        actualEndTime: eventAt,
        createUser: ownerId,
        updateUser: ownerId,
      },
      {
        id: createLegacyId32(),
        name: '输单商机',
        owner: ownerId,
        stage: stageLost,
        amount: prisma8Numeric(50, 20, 10),
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        actualEndTime: eventAt,
        failureReason: '价格',
        createUser: ownerId,
        updateUser: ownerId,
      },
      {
        id: createLegacyId32(),
        name: '跨 scope 赢单',
        owner: otherId,
        stage: stageWon,
        amount: prisma8Numeric(999, 20, 10),
        organizationId,
        createTime: eventAt,
        updateTime: eventAt,
        actualEndTime: eventAt,
        createUser: otherId,
        updateUser: otherId,
      },
    ])

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
    await prisma8Client.orm.public.Opportunity.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.Clue.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.Customer.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId }).deleteAll()
    await prisma8Client.orm.public.Users.where({ tenantId: tenant.id }).deleteAll()
    await prisma8Client.orm.public.Tenants.where({ id: tenant.id }).deleteAll()
    await testDb.close()
  }
})
