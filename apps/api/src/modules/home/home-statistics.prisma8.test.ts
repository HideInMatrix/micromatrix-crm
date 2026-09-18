import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { createLegacyId32 } from '../../common/legacy-id'
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
      const actorId = suffix.slice(0, 32)
      const organizationId = tenant.id
      const inRange = BigInt(new Date('2026-09-16T08:00:00.000Z').getTime())
      const now = inRange

      await prisma8Client.orm.public.Clue.createAll([
        {
          id: createLegacyId32(),
          name: 'Visible clue',
          owner: actorId,
          stage: 'NEW',
          organizationId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
          transitionId: null,
          inSharedPool: false,
        },
        {
          id: createLegacyId32(),
          name: 'Transitioned clue',
          owner: actorId,
          stage: 'NEW',
          organizationId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
          transitionId: suffix.slice(0, 32),
          inSharedPool: false,
        },
        {
          id: createLegacyId32(),
          name: 'Pool clue',
          owner: actorId,
          stage: 'NEW',
          organizationId,
          createTime: inRange,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
          transitionId: '',
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
      const afootStage = await prisma8Client.orm.public.OpportunityStageConfig.select('id').create({
        ...stageBase,
        id: createLegacyId32(),
        name: '进行中',
        _type: 'AFOOT',
        rate: '50',
        pos: 1n,
      })
      const successStage = await prisma8Client.orm.public.OpportunityStageConfig.select(
        'id',
      ).create({
        ...stageBase,
        id: createLegacyId32(),
        name: '赢单',
        _type: 'END',
        rate: '100',
        pos: 2n,
      })
      const failedStage = await prisma8Client.orm.public.OpportunityStageConfig.select('id').create(
        {
          ...stageBase,
          id: createLegacyId32(),
          name: '输单',
          _type: 'END',
          rate: '0',
          pos: 3n,
        },
      )

      await prisma8Client.orm.public.Opportunity.createAll([
        {
          id: createLegacyId32(),
          name: 'Underway 1',
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
          id: createLegacyId32(),
          name: 'Underway 2',
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
          id: createLegacyId32(),
          name: 'Won',
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
          id: createLegacyId32(),
          name: 'Lost',
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
        const organizationId = tenantId
        await prisma8Client.orm.public.Opportunity.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Clue.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
