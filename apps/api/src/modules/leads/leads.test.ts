import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma.service'

import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { LeadsService } from './leads.service'

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
        matchesDirectOwner: async () => true,
        resolveScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
      }
      const metadata = {
        listFields: async () => [],
        computeFormulas: () => ({}),
      }
      const moduleForms = {
        getConfig: async () => ({
          formKey: 'lead',
          formProp: {
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
        {} as never,
        {} as never,
        changeLog as never,
        { resolveFilters: async () => null } as never,
        {} as never,
        {} as never,
        {} as never,
        homeFilters as never,
        {} as never,
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
        await prismaClient.orm.public.Clue.where({ organizationId: tenantId }).deleteAll()
        await prismaClient.orm.public.Users.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
