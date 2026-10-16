import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma.service'

import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { LeadsService } from './leads.service'
import { CluePoolRepository } from '../pool-rules/clue-pool.repository'
import { PoolRuleCalculator } from '../pool-rules/pool-rule-calculator.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'LeadsService production 路径使用 Prisma 保持 create/page/findOne/updateStatus/delete 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const prisma = { client: prismaClient } as PrismaService
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'leads-p8')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prismaClient, {
        tenantId: tenant.id,
        email: suffix + '@example.com',
        passwordHash: 'test',
        name: '线索测试成员',
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

      const dataScope = {
        directOwnerFilter: async () => ({}),
        businessOwnerFilter: async () => ({}),
        matchesDirectOwner: async () => true,
        matchesBusinessOwner: async () => true,
        resolveScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
        resolveBusinessScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
        businessViewCapabilities: async () => ({ all: true, dept: true }),
      }
      const uniqueSystemFields = new Set<string>()
      const metadata = {
        listFields: async () => [],
        fieldsMap: async () =>
          new Map(
            [
              ['name', '线索名称'],
              ['contact', '联系人'],
              ['phone', '电话'],
            ].map(([key, label]) => [
              key,
              {
                key,
                label,
                system: true,
                type: key === 'phone' ? 'phone' : 'text',
                config: uniqueSystemFields.has(key!) ? { unique: true } : null,
              },
            ]),
          ),
        computeFormulas: () => ({}),
      }
      const moduleForms = {
        getConfig: async () => ({
          formKey: 'lead',
          formProp: {
            leadUniqueScope: 'RESOURCE_POOL',
            leadStages: [
              { key: 'PENDING', name: '待联系', kind: 'ACTIVE', enabled: true },
              { key: 'VISITED', name: '已到访', kind: 'ACTIVE', enabled: true },
              { key: 'PAID', name: '已转化', kind: 'SUCCESS', enabled: true },
            ],
          },
          fields: [],
        }),
      }
      const fieldValues = {
        validate: async () => undefined,
        save: async () => undefined,
        load: async (_tenantId: string, _type: string, ids: string[]) =>
          new Map(ids.map((id) => [id, {}])),
        filterResourceIds: async () => [],
      }
      const notifications = { send: async () => undefined }
      const pools = {
        assertCapacityForOwner: async () => undefined,
        assertPoolMember: async () => undefined,
        options: async () => [],
        resolveTargetPool: async (_user: AuthUser, _resource: string, poolId?: string) => {
          if (poolId === 'not-accessible') throw new ForbiddenException('没有目标线索池访问权限')
          return { id: poolId! }
        },
        resolveMoveTargetPool: async () => {
          throw new BadRequestException('未找到与原负责人范围匹配的可用池')
        },
      }
      const changeLog = { record: async () => undefined }
      const homeFilters = { parse: () => null }
      const service = new LeadsService(
        prisma,
        dataScope as never,
        metadata as never,
        moduleForms as never,
        fieldValues as never,
        notifications as never,
        pools as never,
        new CluePoolRepository(prisma, new PoolRuleCalculator()),
        {} as never,
        changeLog as never,
        { resolveFilters: async () => null } as never,
        {} as never,
        {} as never,
        {} as never,
        homeFilters as never,
        { validateReason: async () => undefined } as never,
      )

      const created = await service.create(user, {
        name: 'Prisma 线索',
        contactName: '测试联系人',
        phone: '13800138000',
        ownerId: actor.id,
        customData: {},
      })
      assert.equal(created.name, 'Prisma 线索')
      assert.equal(created.ownerId, actor.id)
      assert.equal(created.status, 'PENDING')
      const createdEvents = await prismaClient.orm.public.LeadStageEvent.where({
        organizationId: tenant.id,
        leadId: created.id,
      })
        .orderBy((event) => event.occurredAt.asc())
        .all()
      assert.equal(createdEvents.length, 1)
      assert.equal(createdEvents[0]?.fromStageKey, null)
      assert.equal(createdEvents[0]?.toStageKey, 'PENDING')
      assert.equal(createdEvents[0]?.operatorId, actor.id)
      assert.equal(createdEvents[0]?.ownerId, actor.id)
      assert.equal(createdEvents[0]?.source, 'MANUAL')

      const page = await service.findAll(user, {
        page: 1,
        pageSize: 10,
        keyword: '13800138000',
      })
      assert.equal(page.total, 1)
      assert.equal(page.items[0]?.id, created.id)

      const detail = await service.findOne(user, created.id)
      assert.equal(detail.name, 'Prisma 线索')
      assert.equal(detail.phone, '13800138000')

      uniqueSystemFields.add('phone')
      await assert.rejects(
        () =>
          service.create(user, {
            name: '私有重复手机号',
            phone: '13800138000',
            ownerId: actor.id,
          }),
        /「电话」的值不能重复/,
      )

      const now = BigInt(Date.now())
      const poolA = `pa${suffix.slice(0, 30)}`
      const poolB = `pb${suffix.slice(0, 30)}`
      for (const [id, name] of [
        [poolA, '招生池 A'],
        [poolB, '招生池 B'],
      ] as const) {
        await prismaClient.orm.public.CluePool.create({
          id,
          name,
          scopeId: '[]',
          organizationId: tenant.id,
          ownerId: '[]',
          enable: true,
          auto: false,
          createTime: now,
          updateTime: now,
          createUser: actor.id,
          updateUser: actor.id,
        })
      }

      const poolLeadA = await service.create(user, {
        name: '池 A 首条',
        phone: '13800138000',
        toPool: true,
        poolId: poolA,
      })
      assert.equal(poolLeadA.poolId, poolA)
      await assert.rejects(
        () =>
          service.create(user, {
            name: '池 A 重复手机号',
            phone: '13800138000',
            toPool: true,
            poolId: poolA,
          }),
        /「电话」的值不能重复/,
      )
      const poolLeadB = await service.create(user, {
        name: '池 B 同手机号',
        phone: '13800138000',
        toPool: true,
        poolId: poolB,
      })
      assert.equal(poolLeadB.poolId, poolB)

      // 自建线索：负责人自动匹配不到池时，手动选择当前用户有权限的池仍能移入。
      const manual = await service.create(user, {
        name: '自建线索手动移入',
        phone: '18800138021',
        ownerId: actor.id,
      })
      await assert.rejects(
        () => service.moveToPool(user, manual.id),
        /未找到与原负责人范围匹配的可用池/,
      )
      await assert.rejects(
        () => service.moveToPool(user, manual.id, 'not-accessible'),
        /没有目标线索池访问权限/,
      )
      const moved = await service.moveToPool(user, manual.id, poolB)
      assert.equal(moved.poolId, poolB)
      const movedLead = await prismaClient.orm.public.Clue.where({ id: manual.id }).first()
      assert.equal(movedLead?.inSharedPool, true)
      assert.equal(movedLead?.poolId, poolB)
      assert.equal(movedLead?.owner, null)
      const ownerHistory = await prismaClient.orm.public.ClueOwner.where({ clueId: manual.id }).all()
      assert.equal(ownerHistory.length, 1)
      assert.equal(ownerHistory[0]?.owner, actor.id)

      // 批量移入也统一使用手工指定的目标池，失败条目不影响成功条目。
      const batchLeads = await Promise.all([
        service.create(user, { name: '批量移池甲', ownerId: actor.id }),
        service.create(user, { name: '批量移池乙', ownerId: actor.id }),
      ])
      const batchResult = await service.batchMoveToPool(
        user,
        [...batchLeads.map((item) => item.id), 'missing-lead-id'],
        poolA,
      )
      assert.equal(batchResult.success, 2)
      assert.equal(batchResult.fail, 1)
      for (const item of batchLeads) {
        const row = await prismaClient.orm.public.Clue.where({ id: item.id }).first()
        assert.equal(row?.poolId, poolA)
        assert.equal(row?.inSharedPool, true)
        assert.equal(row?.owner, null)
      }

      const status = await service.updateStatus(user, { id: created.id, stage: 'VISITED' })
      assert.equal(status.stage, 'VISITED')
      assert.equal(status.lastStage, 'PENDING')
      const oracle = await prismaClient.orm.public.Clue.where({
        id: created.id,
      })
        .select('stage', 'lastStage')
        .first()
      assert.ok(oracle)
      assert.equal(oracle.stage, 'VISITED')
      assert.equal(oracle.lastStage, 'PENDING')
      const stageEvents = await prismaClient.orm.public.LeadStageEvent.where({
        organizationId: tenant.id,
        leadId: created.id,
      })
        .orderBy((event) => event.occurredAt.asc())
        .all()
      assert.equal(stageEvents.length, 2)
      assert.equal(stageEvents[1]?.fromStageKey, 'PENDING')
      assert.equal(stageEvents[1]?.toStageKey, 'VISITED')
      assert.equal(stageEvents[1]?.source, 'MANUAL')

      const removed = await service.remove(user, created.id)
      assert.equal(removed.id, created.id)
      assert.equal(
        (
          await prismaClient.orm.public.Clue.where({
            id: created.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
      assert.equal(
        (
          await prismaClient.orm.public.LeadStageEvent.where({
            organizationId: tenant.id,
            leadId: created.id,
          }).all()
        ).length,
        2,
      )
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.LeadStageEvent.where({ organizationId: tenantId }).deleteAll()
        const clueIds = await prismaClient.orm.public.Clue.where({ organizationId: tenantId })
          .select('id')
          .all()
        if (clueIds.length) {
          await prismaClient.orm.public.ClueOwner.where((row) =>
            row.clueId.in(clueIds.map((item) => item.id)),
          ).deleteAll()
        }
        await prismaClient.orm.public.Clue.where({ organizationId: tenantId }).deleteAll()
        await prismaClient.orm.public.CluePool.where({ organizationId: tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
