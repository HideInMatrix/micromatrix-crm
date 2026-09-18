import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Now } from '../../prisma/prisma8-temporal'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { createLegacyId32 } from '../../common/legacy-id'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import {
  ContractPaymentPlanService,
  ContractPaymentRecordService,
} from './contract-payment.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'ContractPayment Plan/Record production 路径使用 Prisma 8 保持关系、批量状态、流水号与 CRUD 语义',
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
        const row = await prisma8Client.orm.public.Contract.where({
          id: contractId,
          organizationId: organizationId,
        }).first()
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

    try {
      await prisma8Client.orm.public.Tenants.create({
        id: organizationId,
        name: '回款专项租户',
        slug: `payment-${suffix}`,
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
        name: '回款专项客户',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const contract = await prisma8Client.orm.public.Contract.select('id').create({
        id: createLegacyId32(),
        name: '回款专项合同',
        customerId: customer.id,
        owner: actor,
        amount: prisma8Numeric(1000, 14, 2),
        number: `PAY-${suffix.slice(0, 8)}`,
        stage: 'stage-a',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
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
        (
          await prisma8Client.orm.public.ContractPaymentPlan.where({
            id: plan.id,
          })
            .select('planStatus')
            .first()
        )?.planStatus,
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
        Number(
          (
            await prisma8Client.orm.public.ContractPaymentRecord.where({
              id: record.id,
            })
              .select('recordAmount')
              .first()
          )?.recordAmount,
        ),
        180,
      )

      const removedRecord = await recordService.remove(user, record.id)
      assert.equal(removedRecord.id, record.id)
      assert.equal(
        (
          await prisma8Client.orm.public.ContractPaymentRecord.where({
            id: record.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )

      const removedPlan = await planService.remove(user, plan.id)
      assert.equal(removedPlan.id, plan.id)
      assert.equal(
        (
          await prisma8Client.orm.public.ContractPaymentPlan.where({
            id: plan.id,
          })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      const org = organizationId
      await prisma8Client.orm.public.ContractPaymentRecord.where({
        organizationId: org,
      }).deleteAll()
      await prisma8Client.orm.public.ContractPaymentPlan.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Contract.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Customer.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Users.where({ tenantId: organizationId }).deleteAll()
      await prisma8Client.orm.public.Tenants.where({ id: organizationId }).deleteAll()
      await testDb.close()
    }
  },
)
