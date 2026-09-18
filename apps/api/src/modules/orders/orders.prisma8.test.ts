import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { OrderStageService } from './order-stage.service'
import { OrdersService } from './orders.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OrdersService production 路径使用 Prisma 8 保持 CRUD、分页、快照、批量修改与排序语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'orders-p8')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        email: suffix + '@example.com',
        passwordHash: 'test',
        name: '订单测试成员',
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
      const now = BigInt(Date.now())
      const org = prisma8Varchar(tenant.id, 32)
      const actorId = prisma8Varchar(actor.id, 32)
      const customer = await prisma8Client.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('订单专项客户', 255),
          owner: actorId,
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        })
      const orderStages = new OrderStageService(prisma8)
      await orderStages.get(user)

      const systemFields = [
        { id: 'name', key: 'name', label: '订单名称', type: 'text', system: true, hidden: false },
        { id: 'owner', key: 'owner', label: '负责人', type: 'member', system: true, hidden: false },
      ]
      const dataScope = {
        directOwnerFilter: async () => ({}),
        matchesDirectOwner: async () => true,
        resolveScope: async () => ({ all: true, deptIds: [] }),
      }
      const moduleForms = {
        listFields: async () => systemFields,
        listFieldsInTransaction: async () => systemFields,
        getConfig: async () => ({ fields: systemFields }),
      }
      const fieldValues = {
        save: async () => undefined,
        saveBatch: async () => undefined,
        load: async (_tenantId: string, _type: string, ids: string[]) =>
          new Map(ids.map((id) => [id, {}])),
        filterResourceIds: async () => [],
      }
      const orderFields = {
        saveProducts: async () => undefined,
        loadProducts: async () => [],
        loadProductsBatch: async (_tenantId: string, ids: string[]) =>
          new Map(ids.map((id) => [id, []])),
      }
      const approvals = {
        flowRequired: async () => false,
        submit: async () => ({ id: 'unused' }),
        capturePreUpdateSnapshot: async () => null,
        cancelTarget: async () => undefined,
        instanceForTarget: async () => null,
      }
      const service = new OrdersService(
        prisma8,
        dataScope as never,
        moduleForms as never,
        fieldValues as never,
        { resolveFilters: async () => null } as never,
        orderFields as never,
        orderStages,
        {} as never,
        {} as never,
        approvals as never,
      )

      const first = await service.add(user, {
        number: 'DD-' + suffix.slice(0, 12),
        name: 'Prisma8 订单一',
        customerId: customer.id,
        owner: actor.id,
        amount: 120,
        products: [],
        moduleFields: [],
        moduleFormConfigDTO: { fields: [] },
      })
      const second = await service.add(user, {
        number: 'DD2-' + suffix.slice(0, 11),
        name: 'Prisma8 订单二',
        customerId: customer.id,
        owner: actor.id,
        amount: 80,
        products: [],
        moduleFields: [],
        moduleFormConfigDTO: { fields: [] },
      })
      assert.equal(first.customerName, '订单专项客户')
      assert.equal(second.customerName, '订单专项客户')
      assert.equal(first.stage, second.stage)

      const page = await service.page(user, {
        current: 1,
        pageSize: 10,
        keyword: '订单专项客户',
      })
      assert.equal(page.total, 2)
      assert.deepEqual(new Set(page.list.map((item) => item.id)), new Set([first.id, second.id]))

      const snapshot = await service.getSnapshot(user, first.id)
      assert.equal(snapshot.name, 'Prisma8 订单一')
      assert.equal(snapshot.amount, 120)

      const updated = await service.update(user, {
        id: first.id,
        name: 'Prisma8 订单一更新',
        amount: 150,
      })
      assert.equal(updated.name, 'Prisma8 订单一更新')
      assert.equal(updated.amount, 150)
      assert.equal(
        Number(
          (
            await prisma8Client.orm.public.SalesOrder.where({
              id: prisma8Varchar(first.id, 32),
            })
              .select('amount')
              .first()
          )?.amount,
        ),
        150,
      )

      const batch = await service.batchUpdate(user, {
        ids: [second.id],
        fieldId: 'name',
        fieldValue: 'Prisma8 订单二批改',
      })
      assert.deepEqual(batch, { success: 1, fail: 0, skip: 0 })
      assert.equal(
        (
          await prisma8Client.orm.public.SalesOrder.where({
            id: prisma8Varchar(second.id, 32),
          })
            .select('name')
            .first()
        )?.name,
        'Prisma8 订单二批改',
      )

      await service.sort(user, { id: second.id, stage: second.stage, pos: 1 })
      const ordered = await prisma8Client.orm.public.SalesOrder.where({
        organizationId: org,
        stage: prisma8Varchar(second.stage, 50),
      })
        .orderBy((row) => row.pos.asc())
        .select('id')
        .all()
      assert.equal(ordered[0]?.id, second.id)

      const removedFirst = await service.remove(user, first.id)
      const removedSecond = await service.remove(user, second.id)
      assert.equal(removedFirst.pendingApproval, false)
      assert.equal(removedSecond.pendingApproval, false)
      assert.equal(
        (
          await prisma8Client.orm.public.SalesOrder
            .where((row) =>
              row.id.in([prisma8Varchar(first.id, 32), prisma8Varchar(second.id, 32)]),
            )
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      if (tenantId) {
        const org = prisma8Varchar(tenantId, 32)
        await prisma8Client.orm.public.SalesOrder.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.StageAdvancedConfig.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.SalesOrderStageConfig.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.Customer.where({ organizationId: org }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
