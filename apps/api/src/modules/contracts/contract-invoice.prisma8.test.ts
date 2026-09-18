import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ContractInvoiceService } from './contract-invoice.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ContractInvoice production 路径使用 Prisma 8 保持关系装配、金额聚合、snapshot 与删除语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    const organizationId = `org-${suffix}`.slice(0, 32)
    const actorId = `u${suffix}`.slice(0, 32)
    const user: AuthUser = {
      id: actorId,
      tenantId: organizationId,
      email: `${suffix}@example.com`,
      name: '发票测试成员',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      await fixtureDb.tenant.create({
        data: { id: organizationId, name: '发票专项租户', slug: `invoice-${suffix}` },
      })
      await fixtureDb.user.create({
        data: {
          id: actorId,
          tenantId: organizationId,
          email: user.email,
          passwordHash: 'test',
          name: user.name,
        },
      })
      const now = BigInt(Date.now())
      const customer = await fixtureDb.customer.create({
        data: {
          name: '发票专项客户',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const contract = await fixtureDb.contract.create({
        data: {
          name: '发票专项合同',
          customerId: customer.id,
          owner: actorId,
          amount: 500,
          number: `INV-${suffix.slice(0, 8)}`,
          stage: 'stage-a',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const contracts = {
        ensureInScope: async (_user: AuthUser, contractId: string) => {
          const row = await fixtureDb.contract.findFirst({ where: { id: contractId, organizationId } })
          assert.ok(row)
          return row
        },
      }
      const dataScope = {
        directOwnerFilter: async () => ({}),
        matchesDirectOwner: async () => true,
        resolveScope: async () => ({ hasPermission: true, all: true, deptIds: [] }),
      }
      const forms = {
        listFields: async () => [],
        getConfig: async () => ({ fields: [] }),
      }
      const fieldValues = {
        save: async () => undefined,
        load: async (_tenantId: string, _type: string, ids: string[]) =>
          new Map(ids.map((id) => [id, {}])),
        filterResourceIds: async () => [],
      }
      const approvals = {
        flowRequired: async () => false,
        submit: async () => ({ id: 'unused' }),
        capturePreUpdateSnapshot: async () => null,
        moduleApprovalEnabled: async () => false,
        cancelTarget: async () => undefined,
        instanceForTarget: async () => null,
      }
      const service = new ContractInvoiceService(
        prisma8,
        contracts as never,
        dataScope as never,
        forms as never,
        fieldValues as never,
        {} as never,
        {} as never,
        {} as never,
        approvals as never,
      )

      const created = await service.add(user, {
        name: '首张发票',
        contractId: contract.id,
        amount: 100,
        taxRate: 6,
        moduleFields: [],
      })
      assert.equal(created.contractName, '发票专项合同')
      assert.equal(created.customerId, customer.id)

      const page = await service.page(user, {
        current: 1,
        pageSize: 10,
        keyword: '发票专项合同',
      })
      assert.equal(page.total, 1)
      assert.equal(page.list[0]?.id, created.id)

      const statistic = await service.contractStatistic(user, contract.id)
      assert.equal(statistic.contractAmount, 500)
      assert.equal(statistic.invoicedAmount, 100)
      assert.equal(statistic.uninvoicedAmount, 400)

      const snapshot = (await service.getSnapshot(user, created.id)) as Record<string, unknown>
      assert.equal(snapshot.name, '首张发票')

      const updated = await service.update(user, { id: created.id, amount: 120 })
      assert.equal(updated.amount, 120)
      assert.equal(
        Number((await fixtureDb.contractInvoice.findUniqueOrThrow({ where: { id: created.id } })).amount),
        120,
      )

      const removed = await service.remove(user, created.id)
      assert.equal(removed.pendingApproval, false)
      assert.equal(await fixtureDb.contractInvoice.count({ where: { id: created.id } }), 0)
    } finally {
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
