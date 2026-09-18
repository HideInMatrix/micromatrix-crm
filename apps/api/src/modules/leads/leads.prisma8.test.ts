import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'

import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { LeadsService } from './leads.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'LeadsService production 路径使用 Prisma 8 保持 create/page/findOne/updateStatus/delete 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'leads-p8')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
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
        prisma8,
        dataScope as never,
        metadata as never,
        {} as never,
        fieldValues as never,
        notifications as never,
        {} as never,
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
        name: 'Prisma8 线索',
        contactName: '测试联系人',
        phone: '13800138000',
        ownerId: actor.id,
        customData: {},
      })
      assert.equal(created.name, 'Prisma8 线索')
      assert.equal(created.ownerId, actor.id)
      assert.equal(created.status, 'NEW')

      const page = await service.findAll(user, {
        page: 1,
        pageSize: 10,
        keyword: '13800138000',
      })
      assert.equal(page.total, 1)
      assert.equal(page.items[0]?.id, created.id)

      const detail = await service.findOne(user, created.id)
      assert.equal(detail.name, 'Prisma8 线索')
      assert.equal(detail.phone, '13800138000')

      const status = await service.updateStatus(user, { id: created.id, stage: 'FOLLOWING' })
      assert.equal(status.stage, 'FOLLOWING')
      assert.equal(status.lastStage, 'NEW')
      const oracle = await prisma8Client.orm.public.Clue.where({
        id: created.id,
      })
        .select('stage', 'lastStage')
        .first()
      assert.ok(oracle)
      assert.equal(oracle.stage, 'FOLLOWING')
      assert.equal(oracle.lastStage, 'NEW')

      const removed = await service.remove(user, created.id)
      assert.equal(removed.id, created.id)
      assert.equal(
        (
          await prisma8Client.orm.public.Clue.where({
            id: created.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      if (tenantId) {
        await prisma8Client.orm.public.Clue.where({ organizationId: tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
