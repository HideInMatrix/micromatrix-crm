import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { ProductPriceService } from './product-price.service'
import { ProductsService } from './products.service'

const databaseUrl = process.env['DATABASE_URL']

function id() {
  return randomUUID().replaceAll('-', '').slice(0, 32)
}

test(
  'Products/ProductPrice production 路径使用 Prisma 8 保持 CRUD、分页、排序与报价关联删除保护',
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
      name: '产品测试成员',
      deptId: null,
      leaderId: null,
      roles: [],
      permissions: ['*'],
    }
    const metadata = {
      listFields: async (_tenantId: string, module: string) =>
        module === 'product'
          ? [
              { id: 'name', key: 'name', label: '产品名称', type: 'text', system: true, hidden: false },
              { id: 'status', key: 'status', label: '状态', type: 'select', system: true, hidden: false },
            ]
          : [
              { id: 'name', key: 'name', label: '价格表名称', type: 'text', system: true, hidden: false },
              { id: 'status', key: 'status', label: '状态', type: 'select', system: true, hidden: false },
            ],
      computeFormulas: () => ({}),
    }
    const fieldValues = {
      save: async () => undefined,
      saveBatch: async (_tenantId: string, _type: string, ids: string[]) => ({ count: ids.length }),
      load: async (_tenantId: string, _type: string, ids: string[]) =>
        new Map(ids.map((resourceId) => [resourceId, {}])),
      filterResourceIds: async () => [],
    }
    const productFields = {
      saveProducts: async () => undefined,
      loadProducts: async () => [],
      loadProductsBatch: async () => new Map(),
    }
    const products = new ProductsService(
      prisma8,
      metadata as never,
      {} as never,
      fieldValues as never,
      {} as never,
      {} as never,
    )
    const prices = new ProductPriceService(
      prisma8,
      metadata as never,
      {} as never,
      fieldValues as never,
      productFields as never,
      {} as never,
      {} as never,
    )

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const first = await products.add(user, { name: '产品 A', price: 12.5, status: '1' })
      const second = await products.add(user, { name: '产品 B', price: 20, status: '2' })
      const page = await products.page(user, { current: 1, pageSize: 10, keyword: '产品' })
      assert.equal(page.total, 2)
      assert.deepEqual(page.list.map((item) => item.name), ['产品 A', '产品 B'])
      await products.editPos(user, {
        dragNodeId: second.id,
        dropNodeId: first.id,
        dropPosition: -1,
      })
      assert.deepEqual((await products.listOption(user)).map((item) => String(item.id)), [second.id, first.id])
      await products.batchUpdate(user, { ids: [first.id], fieldId: 'status', fieldValue: '2' })
      assert.equal((await fixtureDb.product.findUniqueOrThrow({ where: { id: first.id } })).status, '2')

      const price = await prices.add(user, { name: '标准价格表', status: '1', products: [] })
      assert.equal((await prices.page(user, { current: 1, pageSize: 10, keyword: '标准' })).total, 1)

      const now = BigInt(Date.now())
      const stage = await fixtureDb.opportunityStageConfig.create({
        data: {
          name: '产品专项阶段',
          type: 'AFOOT',
          rate: '50',
          pos: 1n,
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const opportunity = await fixtureDb.opportunity.create({
        data: {
          name: '产品专项商机',
          organizationId,
          stage: stage.id,
          owner: actorId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const quotation = await fixtureDb.opportunityQuotation.create({
        data: {
          name: '产品专项报价',
          opportunityId: opportunity.id,
          untilTime: now + 86_400_000n,
          amount: 100,
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const quotationFieldId = id()
      await fixtureDb.opportunityQuotationField.create({
        data: {
          id: quotationFieldId,
          resourceId: quotation.id,
          fieldId: id(),
          fieldValue: price.id,
        },
      })
      await assert.rejects(() => prices.delete(user, price.id), /价格表已被报价单关联/)
      await fixtureDb.opportunityQuotationField.delete({ where: { id: quotationFieldId } })
      await prices.delete(user, price.id)
      assert.equal(await fixtureDb.productPrice.count({ where: { id: price.id } }), 0)

      await products.delete(user, first.id)
      await products.delete(user, second.id)
      assert.equal(await fixtureDb.product.count({ where: { organizationId } }), 0)
    } finally {
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
