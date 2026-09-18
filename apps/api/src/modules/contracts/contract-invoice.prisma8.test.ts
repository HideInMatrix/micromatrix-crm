import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { ContractInvoiceService } from './contract-invoice.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ContractInvoice production 路径使用 Prisma 8 保持关系装配、金额聚合、snapshot 与删除语义',
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
      name: '发票测试成员',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }

    try {
      await prisma8Client.orm.public.Tenants.create({
        id: organizationId,
        name: '发票专项租户',
        slug: `invoice-${suffix}`,
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
      const org = organizationId
      const actor = actorId
      const customer = await prisma8Client.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: '发票专项客户',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const contract = await prisma8Client.orm.public.Contract.select('id').create({
        id: createLegacyId32(),
        name: '发票专项合同',
        customerId: customer.id,
        owner: actor,
        amount: numericValue(decimalString(500, 14, 2), 14, 2),
        number: `INV-${suffix.slice(0, 8)}`,
        stage: 'stage-a',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const contracts = {
        ensureInScope: async (_user: AuthUser, contractId: string) => {
          const row = await prisma8Client.orm.public.Contract.where({
            id: contractId,
            organizationId: org,
          }).first()
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
        Number(
          (
            await prisma8Client.orm.public.ContractInvoice.where({
              id: created.id,
            })
              .select('amount')
              .first()
          )?.amount,
        ),
        120,
      )

      const removed = await service.remove(user, created.id)
      assert.equal(removed.pendingApproval, false)
      assert.equal(
        (
          await prisma8Client.orm.public.ContractInvoice.where({
            id: created.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      const org = organizationId
      await prisma8Client.orm.public.ContractInvoice.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Contract.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Customer.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Users.where({ tenantId: organizationId }).deleteAll()
      await prisma8Client.orm.public.Tenants.where({ id: organizationId }).deleteAll()
      await testDb.close()
    }
  },
)
