import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma.service'
import { createLegacyId32 } from '../../common/legacy-id'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import type { HomeDepartmentScopeService } from './home-department-scope.service'
import type { HomePeriodService } from './home-period.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Home statistics 使用 Prisma 保持线索过滤语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    const range = {
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-09-30T23:59:59.999Z'),
      previousStart: new Date('2026-08-01T00:00:00.000Z'),
      previousEnd: new Date('2026-08-31T23:59:59.999Z'),
    }

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-home')
      tenantId = tenant.id
      const actorId = suffix.slice(0, 32)
      const organizationId = tenant.id
      const inRange = BigInt(new Date('2026-09-16T08:00:00.000Z').getTime())

      await prismaClient.orm.public.Clue.createAll([
        {
          id: createLegacyId32(),
          name: 'Visible clue',
          owner: actorId,
          stage: 'NEW',
          organizationId,
          createTime: inRange,
          updateTime: inRange,
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
          updateTime: inRange,
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
          updateTime: inRange,
          createUser: actorId,
          updateUser: actorId,
          transitionId: '',
          inSharedPool: true,
        },
      ])

      const prisma = { client: prismaClient } as PrismaService
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

      const clueQuery = new HomeClueStatisticQuery(prisma, scopes, periods)
      const clues = await clueQuery.execute(user, request)
      assert.equal(clues.todayClue.value, 1)
      assert.equal(clues.thisMonthClue.value, 1)
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prismaClient.orm.public.Clue.where({ organizationId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
