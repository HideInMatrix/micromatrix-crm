import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ContractsService } from './contracts.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'Contracts production 路径使用 Prisma 8 保持 add/page/findOne/snapshot/update/delete 语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    const organizationId = `org-${suffix}`.slice(0, 32)
    const actorId = `u${suffix}`.slice(0, 32)
    const user: AuthUser = {
      id: actorId,
      tenantId: organizationId,
      email: `${suffix}@example.com`,
      name: '合同测试成员',
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
    const approvals = {
      flowRequired: async () => false,
      submit: async () => ({ id: 'unused' }),
      capturePreUpdateSnapshot: async () => null,
      handleTargetApproval: async () => undefined,
      cancelTarget: async () => undefined,
    }
    const moduleForms = {
      listFields: async () => [],
      listFieldsInTransaction: async () => [],
      getConfig: async () => ({ fields: [] }),
    }
    const fieldValues = {
      save: async () => undefined,
      saveBatch: async (_tenantId: string, _type: string, ids: string[]) => ({ count: ids.length }),
      load: async (_tenantId: string, _type: string, ids: string[]) =>
        new Map(ids.map((id) => [id, {}])),
      filterResourceIds: async () => [],
    }
    const contractFields = {
      saveProducts: async () => undefined,
      loadProducts: async () => [],
      loadProductsBatch: async () => new Map(),
    }
    const service = new ContractsService(
      prisma8,
      dataScope as never,
      approvals as never,
      moduleForms as never,
      fieldValues as never,
      contractFields as never,
      {} as never,
      { loadProducts: async () => [] } as never,
      {} as never,
      { sendConfigured: async () => undefined } as never,
    )

    try {
      await prisma8Client.orm.public.Tenants.create({
        id: organizationId,
        name: '合同专项租户',
        slug: `contract-${suffix}`,
        updatedAt: prisma8Now(),
      })
      await prisma8Client.orm.public.Users.create({
        id: actorId,
        tenantId: organizationId,
        email: user.email,
        passwordHash: 'test',
        name: user.name,
        updatedAt: prisma8Now(),
      })
      const now = BigInt(Date.now())
      const org = prisma8Varchar(organizationId, 32)
      const actor = prisma8Varchar(actorId, 32)
      const customer = await prisma8Client.orm.public.Customer
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('合同专项客户', 255),
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })
      const stage = await prisma8Client.orm.public.ContractStageConfig
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('执行中', 255),
          _type: prisma8Varchar('AFOOT', 50),
          pos: 1n,
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })

      const created = await service.addDirect(user, {
        name: 'Prisma8 合同',
        customerId: customer.id,
        owner: actorId,
        amount: 300,
        moduleFields: [],
        moduleFormConfigDTO: { fields: [] },
        products: [],
      })
      assert.equal(created.customerName, '合同专项客户')
      assert.equal(created.stage, stage.id)
      assert.equal(created.amount, 300)

      const page = await service.page(user, {
        current: 1,
        pageSize: 10,
        keyword: '合同专项客户',
      })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.id, created.id)

      const snapshot = await service.getSnapshot(user, created.id)
      assert.equal(snapshot.name, 'Prisma8 合同')

      const updated = await service.updateDirect(user, {
        id: created.id,
        name: 'Prisma8 合同更新',
        amount: 350,
      })
      assert.equal(updated.name, 'Prisma8 合同更新')
      assert.equal(updated.amount, 350)
      assert.equal(
        Number(
          (
            await prisma8Client.orm.public.Contract.where({
              id: prisma8Varchar(created.id, 32),
            })
              .select('amount')
              .first()
          )?.amount,
        ),
        350,
      )

      const removed = await service.remove(user, created.id)
      assert.equal(removed.pendingApproval, false)
      assert.equal(
        (
          await prisma8Client.orm.public.Contract.where({ id: prisma8Varchar(created.id, 32) })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      const org = prisma8Varchar(organizationId, 32)
      await prisma8Client.orm.public.Contract.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.ContractStageConfig.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Customer.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Users.where({ tenantId: organizationId }).deleteAll()
      await prisma8Client.orm.public.Tenants.where({ id: organizationId }).deleteAll()
      await testDb.close()
    }
  },
)
