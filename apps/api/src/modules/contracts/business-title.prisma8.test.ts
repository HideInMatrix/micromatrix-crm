import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  createPrismaTestTenant,
  createPrismaTestUser,
  openPrismaTestDatabase,
} from '../../testing/prisma-test-db'
import { BusinessTitleService } from './business-title.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'BusinessTitle 使用 Prisma 8 保持高级筛选、审批状态、配置与发票引用保护语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    try {
      const tenant = await createPrismaTestTenant(prisma8Client, 'p8-business-title')
      tenantId = tenant.id
      const actor = await createPrismaTestUser(prisma8Client, {
        tenantId: tenant.id,
        name: 'Business Title User',
      })
      const user = { id: actor.id, tenantId: tenant.id } as AuthUser
      const service = new BusinessTitleService(
        { client: prisma8Client } as Prisma8Service,
        {} as never,
        {} as never,
      )

      const alpha = await service.add(user, {
        name: 'Alpha Technology',
        type: 'CUSTOM',
        identificationNumber: 'TAX-ALPHA',
        province: 'Shanghai',
      })
      const beta = await service.add(user, {
        name: 'Beta Services',
        type: 'THIRD_PARTY',
        identificationNumber: 'TAX-BETA',
        province: 'Beijing',
        remark: 'external partner',
      })
      const gamma = await service.add(user, {
        name: 'Gamma Labs',
        type: 'CUSTOM',
        province: 'Shenzhen',
      })

      assert.equal(alpha.approvalStatus, 'APPROVING')
      assert.equal(beta.approvalStatus, 'APPROVED')
      assert.equal(gamma.identificationNumber, null)

      const keyword = await service.page(user, { keyword: 'tax-alpha' })
      assert.deepEqual(
        keyword.list.map((item) => item.id),
        [alpha.id],
      )

      const andFiltered = await service.page(user, {
        filters: [
          { key: 'name', op: 'contains', value: 'alpha' },
          { key: 'type', op: 'eq', value: 'CUSTOM' },
        ],
        filterMode: 'AND',
      })
      assert.deepEqual(
        andFiltered.list.map((item) => item.id),
        [alpha.id],
      )

      const orFiltered = await service.page(user, {
        filters: [
          { key: 'province', op: 'eq', value: 'Beijing' },
          { key: 'identificationNumber', op: 'isEmpty', value: null },
        ],
        filterMode: 'OR',
      })
      assert.deepEqual(
        new Set(orFiltered.list.map((item) => item.id)),
        new Set([beta.id, gamma.id]),
      )

      const notIn = await service.page(user, {
        filters: [{ key: 'type', op: 'notIn', value: ['THIRD_PARTY'] }],
      })
      assert.deepEqual(new Set(notIn.list.map((item) => item.id)), new Set([alpha.id, gamma.id]))

      const emptyRemark = await service.page(user, {
        filters: [{ key: 'remark', op: 'isEmpty', value: null }],
      })
      assert.deepEqual(
        new Set(emptyRemark.list.map((item) => item.id)),
        new Set([alpha.id, gamma.id]),
      )

      await service.approval(user, { id: alpha.id, approvalStatus: 'APPROVED' })
      const options = await service.options(user)
      assert.deepEqual(new Set(options.map((item) => item.id)), new Set([alpha.id, beta.id]))
      assert.equal((await service.revoke(user, alpha.id)).approvalStatus, 'REVOKED')

      const renamed = await service.update(user, {
        id: beta.id,
        name: 'Beta Services Updated',
        type: 'CUSTOM',
      })
      assert.equal(renamed.name, 'Beta Services Updated')
      assert.equal(renamed.approvalStatus, 'APPROVING')

      const organizationId = tenant.id
      const actorId = actor.id
      const config = await prisma8Client.orm.public.BusinessTitleConfig.select('id').create({
        id: createLegacyId32(),
        field: 'identification_number',
        required: false,
        organizationId,
      })
      const switched = await service.switchRequired(user, config.id)
      assert.ok(switched)
      assert.equal(switched.required, true)
      await assert.rejects(
        () => service.add(user, { name: 'Missing Tax Number', type: 'CUSTOM' }),
        BadRequestException,
      )

      const now = BigInt(Date.now())
      const customer = await prisma8Client.orm.public.Customer.select('id').create({
        id: createLegacyId32(),
        name: 'Business Title Customer',
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
      const contract = await prisma8Client.orm.public.Contract.select('id').create({
        id: createLegacyId32(),
        name: 'Business Title Contract',
        amount: prisma8Numeric(0, 14, 2),
        number: `BT-${suffix}`.slice(0, 50),
        customerId: customer.id,
        owner: actorId,
        stage: 'INIT',
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
      const invoice = await prisma8Client.orm.public.ContractInvoice.select('id').create({
        id: createLegacyId32(),
        name: 'Business Title Invoice',
        contractId: contract.id,
        owner: actorId,
        businessTitleId: alpha.id,
        organizationId,
        createTime: now,
        updateTime: now,
        createUser: actorId,
        updateUser: actorId,
      })
      assert.equal(await service.hasInvoice(user, alpha.id), true)
      await assert.rejects(() => service.remove(user, alpha.id), BadRequestException)

      await prisma8Client.orm.public.ContractInvoice.where({ id: invoice.id }).delete()
      assert.deepEqual(await service.remove(user, alpha.id), { id: alpha.id, name: alpha.name })
      const fixtureReadback = await prisma8Client.orm.public.BusinessTitle.where({
        id: beta.id,
      }).first()
      assert.equal(fixtureReadback?.name, 'Beta Services Updated')
      assert.equal(fixtureReadback?._type, 'CUSTOM')
      assert.equal(fixtureReadback?.approvalStatus, 'APPROVING')
    } finally {
      if (tenantId) {
        const organizationId = tenantId
        await prisma8Client.orm.public.ContractInvoice.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Contract.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.Customer.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.BusinessTitleConfig.where({ organizationId }).deleteAll()
        await prisma8Client.orm.public.BusinessTitle.where({ organizationId: tenantId }).deleteAll()
        await prisma8Client.orm.public.Users.where({ tenantId }).deleteAll()
        await prisma8Client.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
