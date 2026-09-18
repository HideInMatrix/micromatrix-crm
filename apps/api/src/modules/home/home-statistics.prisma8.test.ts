import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import type { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomeOpportunityStatisticQuery } from './home-opportunity-statistic.query'
import type { HomePeriodService } from './home-period.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Home statistics 使用 Prisma 8 保持线索过滤与商机阶段/金额聚合语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const range = {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-09-30T23:59:59.999Z'),
      previousStart: new Date('2026-08-01T00:00:00.000Z'),
      previousEnd: new Date('2026-08-31T23:59:59.999Z'),
    }

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-home')
      tenantId = tenant.id
      const actorId = prisma8Varchar(suffix.slice(0, 32), 32)
      const organizationId = prisma8Varchar(tenant.id, 32)
      const inRange = BigInt(new Date('2026-09-16T08:00:00.000Z').getTime())
      const now = inRange

      await prisma8Client.orm.public.Clue.createAll([
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Visible clue', 255),
          owner: actorId,
          stage: prisma8Varchar('NEW', 30),
          organizationId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
          transitionId: null,
          inSharedPool: false,
        },
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Transitioned clue', 255),
          owner: actorId,
          stage: prisma8Varchar('NEW', 30),
          organizationId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
          transitionId: prisma8Varchar(suffix.slice(0, 32), 32),
          inSharedPool: false,
        },
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Pool clue', 255),
          owner: actorId,
          stage: prisma8Varchar('NEW', 30),
          organizationId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
          transitionId: prisma8Varchar('', 32),
          inSharedPool: true,
        },
      ])

      const stageBase = {
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      }
      const afootStage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          ...stageBase,
          id: prisma8Id32(),
          name: prisma8Varchar('进行中', 16),
          _type: prisma8Varchar('AFOOT', 50),
          rate: prisma8Varchar('50', 10),
          pos: 1n,
        })
      const successStage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          ...stageBase,
          id: prisma8Id32(),
          name: prisma8Varchar('赢单', 16),
          _type: prisma8Varchar('END', 50),
          rate: prisma8Varchar('100', 10),
          pos: 2n,
        })
      const failedStage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          ...stageBase,
          id: prisma8Id32(),
          name: prisma8Varchar('输单', 16),
          _type: prisma8Varchar('END', 50),
          rate: prisma8Varchar('0', 10),
          pos: 3n,
        })

      await prisma8Client.orm.public.Opportunity.createAll([
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Underway 1', 255),
          amount: prisma8Numeric('100.5000000000', 20, 10),
          organizationId,
          stage: afootStage.id,
          owner: actorId,
          updateUser: actorId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          expectedEndTime: inRange,
        },
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Underway 2', 255),
          amount: prisma8Numeric('49.5000000000', 20, 10),
          organizationId,
          stage: afootStage.id,
          owner: actorId,
          updateUser: actorId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          expectedEndTime: inRange,
        },
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Won', 255),
          amount: prisma8Numeric('200.0000000000', 20, 10),
          organizationId,
          stage: successStage.id,
          owner: actorId,
          updateUser: actorId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          expectedEndTime: inRange,
        },
        {
          id: prisma8Id32(),
          name: prisma8Varchar('Lost', 255),
          amount: prisma8Numeric('999.0000000000', 20, 10),
          organizationId,
          stage: failedStage.id,
          owner: actorId,
          updateUser: actorId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          expectedEndTime: inRange,
        },
      ])

      const prisma8 = { client: prisma8Client } as Prisma8Service
      const scopes = {
        resolve: async () => ({ all: true, self: false, deptIds: [], userIds: null }),
      } as unknown as HomeDepartmentScopeService
      const periods = { range: () => range } as unknown as HomePeriodService
      const user = {
        id: actorId,
        tenantId: tenant.id,
        email: null,
        name: 'Actor',
        deptId: null,
        leaderId: null,
        roles: [],
        permissions: [],
      } satisfies AuthUser
      const request = {
        searchType: 'ALL',
        deptIds: [],
        userField: 'OWNER',
        priorPeriodEnable: false,
      } satisfies HomeStatisticRequest

      const clueQuery = new HomeClueStatisticQuery(prisma8, scopes, periods)
      const clues = await clueQuery.execute(user, request)
      assert.equal(clues.todayClue.value, 1)
      assert.equal(clues.thisMonthClue.value, 1)

      const opportunityQuery = new HomeOpportunityStatisticQuery(prisma8, scopes, periods)
      const underway = await opportunityQuery.execute(user, request, 'UNDERWAY')
      assert.equal(underway.todayOpportunity.value, 2)
      assert.equal(underway.todayOpportunityAmount.value, 150)

      const success = await opportunityQuery.execute(user, request, 'SUCCESS')
      assert.equal(success.todayOpportunity.value, 1)
      assert.equal(success.todayOpportunityAmount.value, 200)
    } finally {
      if (tenantId) {
        const organizationId = prisma8Varchar(tenantId, 32)
        await prisma8Client.orm.public.Opportunity.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Clue.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
