import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { BadRequestException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { BusinessTitleService } from './business-title.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'BusinessTitle 使用 Prisma 8 保持高级筛选、审批状态、配置与发票引用保护语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    let tenantId: string | null = null

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 business title ${suffix}`, slug: `p8-business-title-${suffix}` },
      })
      tenantId = tenant.id
      const actor = await fixtureDb.user.create({
        data: { tenantId: tenant.id, name: 'Business Title User', passwordHash: 'not-used' },
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
      assert.deepEqual(keyword.list.map((item) => item.id), [alpha.id])

      const andFiltered = await service.page(user, {
        filters: [
          { key: 'name', op: 'contains', value: 'alpha' },
          { key: 'type', op: 'eq', value: 'CUSTOM' },
        ],
        filterMode: 'AND',
      })
      assert.deepEqual(andFiltered.list.map((item) => item.id), [alpha.id])

      const orFiltered = await service.page(user, {
        filters: [
          { key: 'province', op: 'eq', value: 'Beijing' },
          { key: 'identificationNumber', op: 'isEmpty', value: null },
        ],
        filterMode: 'OR',
      })
      assert.deepEqual(new Set(orFiltered.list.map((item) => item.id)), new Set([beta.id, gamma.id]))

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

      const config = await fixtureDb.businessTitleConfig.create({
        data: {
          field: 'identification_number',
          required: false,
          organizationId: tenant.id,
        },
      })
      const switched = await service.switchRequired(user, config.id)
      assert.ok(switched)
      assert.equal(switched.required, true)
      await assert.rejects(
        () => service.add(user, { name: 'Missing Tax Number', type: 'CUSTOM' }),
        BadRequestException,
      )

      const customer = await fixtureDb.customer.create({
        data: {
          name: 'Business Title Customer',
          organizationId: tenant.id,
          createTime: BigInt(Date.now()),
          updateTime: BigInt(Date.now()),
          createUser: actor.id,
          updateUser: actor.id,
        },
      })
      const contract = await fixtureDb.contract.create({
        data: {
          name: 'Business Title Contract',
          number: `BT-${suffix}`.slice(0, 50),
          customerId: customer.id,
          owner: actor.id,
          stage: 'INIT',
          organizationId: tenant.id,
          createTime: BigInt(Date.now()),
          updateTime: BigInt(Date.now()),
          createUser: actor.id,
          updateUser: actor.id,
        },
      })
      const invoice = await fixtureDb.contractInvoice.create({
        data: {
          name: 'Business Title Invoice',
          contractId: contract.id,
          owner: actor.id,
          businessTitleId: alpha.id,
          organizationId: tenant.id,
          createTime: BigInt(Date.now()),
          updateTime: BigInt(Date.now()),
          createUser: actor.id,
          updateUser: actor.id,
        },
      })
      assert.equal(await service.hasInvoice(user, alpha.id), true)
      await assert.rejects(() => service.remove(user, alpha.id), BadRequestException)

      await fixtureDb.contractInvoice.delete({ where: { id: invoice.id } })
      assert.deepEqual(await service.remove(user, alpha.id), { id: alpha.id, name: alpha.name })
      const fixtureReadback = await fixtureDb.businessTitle.findFirst({ where: { id: beta.id } })
      assert.equal(fixtureReadback?.name, 'Beta Services Updated')
      assert.equal(fixtureReadback?.type, 'CUSTOM')
      assert.equal(fixtureReadback?.approvalStatus, 'APPROVING')
    } finally {
      if (tenantId) {
        await fixtureDb.contractInvoice.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.contract.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.customer.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.businessTitleConfig.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.businessTitle.deleteMany({ where: { organizationId: tenantId } })
        await fixtureDb.user.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
