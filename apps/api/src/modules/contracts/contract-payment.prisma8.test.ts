import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ContractPaymentPlanService, ContractPaymentRecordService } from './contract-payment.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ContractPayment Plan/Record production 路径使用 Prisma 8 保持关系、批量状态、流水号与 CRUD 语义',
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
      name: '回款测试成员',
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
    const moduleForms = {
      listFields: async (_tenantId: string, formKey: string) =>
        formKey === 'contractPaymentPlan'
          ? [{ id: 'planStatus', key: 'planStatus', label: '状态', system: true, hidden: false }]
          : [],
      getConfig: async () => ({ fields: [] }),
    }
    const fieldValues = {
      save: async () => undefined,
      saveBatch: async (_tenantId: string, _type: string, ids: string[]) => ({ count: ids.length }),
      load: async (_tenantId: string, _type: string, ids: string[]) =>
        new Map(ids.map((id) => [id, {}])),
      filterResourceIds: async () => [],
    }
    const userViews = { resolveFilters: async () => null }
    const contracts = {
      ensureInScope: async (_user: AuthUser, contractId: string) => {
        const row = await fixtureDb.contract.findFirst({ where: { id: contractId, organizationId } })
        assert.ok(row)
        return row
      },
    }
    const deps = [
      prisma8,
      contracts as never,
      dataScope as never,
      moduleForms as never,
      fieldValues as never,
      userViews as never,
      {} as never,
      {} as never,
    ] as const
    const planService = new ContractPaymentPlanService(...deps)
    const recordService = new ContractPaymentRecordService(...deps)

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      await fixtureDb.tenant.create({
        data: { id: organizationId, name: '回款专项租户', slug: `payment-${suffix}` },
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
          name: '回款专项客户',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const contract = await fixtureDb.contract.create({
        data: {
          name: '回款专项合同',
          customerId: customer.id,
          owner: actorId,
          amount: 1000,
          number: `PAY-${suffix.slice(0, 8)}`,
          stage: 'stage-a',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })

      const planEndTime = Date.now() + 86400000
      const plan = await planService.add(user, {
        name: '首期回款计划',
        contractId: contract.id,
        owner: actorId,
        planAmount: 300,
        planEndTime,
        moduleFields: [],
      })
      assert.equal(plan.contractName, '回款专项合同')
      assert.equal(plan.customerId, customer.id)
      assert.equal(plan.planStatus, 'PENDING')
      assert.equal(plan.planAmount, 300)

      const planPage = await planService.page(user, {
        current: 1,
        pageSize: 10,
        keyword: '回款专项合同',
      })
      assert.equal(planPage.total, 1)
      assert.equal(planPage.list[0]?.id, plan.id)

      const updatedPlan = await planService.update(user, { id: plan.id, planAmount: 350 })
      assert.equal(updatedPlan.planAmount, 350)
      await planService.batchUpdate(user, {
        ids: [plan.id],
        fieldId: 'planStatus',
        fieldValue: 'COMPLETED',
      })
      assert.equal((await planService.get(user, plan.id)).planStatus, 'COMPLETED')
      assert.equal(
        (await fixtureDb.contractPaymentPlan.findUniqueOrThrow({ where: { id: plan.id } })).planStatus,
        'COMPLETED',
      )

      const recordEndTime = Date.now()
      const record = await recordService.add(user, {
        name: '首笔回款',
        contractId: contract.id,
        paymentPlanId: plan.id,
        owner: actorId,
        recordAmount: 120,
        recordEndTime,
        moduleFields: [],
      })
      assert.equal(record.contractName, '回款专项合同')
      assert.equal(record.customerId, customer.id)
      assert.equal(record.paymentPlanId, plan.id)
      assert.equal(record.paymentPlanName, '首期回款计划')
      assert.match(record.no ?? '', /^PAY-\d{6}-000001$/)

      const recordPage = await recordService.page(user, {
        current: 1,
        pageSize: 10,
        keyword: '回款专项合同',
      })
      assert.equal(recordPage.total, 1)
      assert.equal(recordPage.list[0]?.id, record.id)
      assert.equal(recordPage.list[0]?.paymentPlanName, '首期回款计划')

      const originalNo = record.no
      const updatedRecord = await recordService.update(user, {
        id: record.id,
        name: '首笔回款更新',
        recordAmount: 180,
      })
      assert.equal(updatedRecord.name, '首笔回款更新')
      assert.equal(updatedRecord.recordAmount, 180)
      assert.equal(updatedRecord.no, originalNo)
      assert.equal(
        Number((await fixtureDb.contractPaymentRecord.findUniqueOrThrow({ where: { id: record.id } })).recordAmount),
        180,
      )

      const removedRecord = await recordService.remove(user, record.id)
      assert.equal(removedRecord.id, record.id)
      assert.equal(await fixtureDb.contractPaymentRecord.count({ where: { id: record.id } }), 0)

      const removedPlan = await planService.remove(user, plan.id)
      assert.equal(removedPlan.id, plan.id)
      assert.equal(await fixtureDb.contractPaymentPlan.count({ where: { id: plan.id } }), 0)
    } finally {
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
