import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { prisma8Id32, prisma8Varchar } from '../../prisma/prisma8-varchar'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
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
      const storedProduct = await prisma8Client.orm.public.Product.where({
        id: prisma8Varchar(first.id, 32),
      })
        .select('status')
        .first()
      assert.ok(storedProduct)
      assert.equal(storedProduct.status, '2')

      const price = await prices.add(user, { name: '标准价格表', status: '1', products: [] })
      assert.equal((await prices.page(user, { current: 1, pageSize: 10, keyword: '标准' })).total, 1)

      const now = BigInt(Date.now())
      const org = prisma8Varchar(organizationId, 32)
      const actor = prisma8Varchar(actorId, 32)
      const stage = await prisma8Client.orm.public.OpportunityStageConfig
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('产品专项阶段', 16),
          _type: prisma8Varchar('AFOOT', 50),
          rate: prisma8Varchar('50', 10),
          pos: 1n,
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })
      const opportunity = await prisma8Client.orm.public.Opportunity
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('产品专项商机', 255),
          organizationId: org,
          stage: stage.id,
          owner: actor,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })
      const quotation = await prisma8Client.orm.public.OpportunityQuotation
        .select('id')
        .create({
          id: prisma8Id32(),
          name: prisma8Varchar('产品专项报价', 255),
          opportunityId: opportunity.id,
          untilTime: now + 86_400_000n,
          amount: prisma8Numeric(100, 14, 2),
          organizationId: org,
          createTime: now,
          updateTime: now,
          createUser: actor,
          updateUser: actor,
        })
      const quotationFieldId = id()
      await prisma8Client.orm.public.OpportunityQuotationField.create({
        id: prisma8Varchar(quotationFieldId, 32),
        resourceId: quotation.id,
        fieldId: prisma8Varchar(id(), 32),
        fieldValue: prisma8Varchar(price.id, 255),
      })
      await assert.rejects(() => prices.delete(user, price.id), /价格表已被报价单关联/)
      await prisma8Client.orm.public.OpportunityQuotationField
        .where({ id: prisma8Varchar(quotationFieldId, 32) })
        .delete()
      await prices.delete(user, price.id)
      assert.equal(
        (
          await prisma8Client.orm.public.ProductPrice.where({
            id: prisma8Varchar(price.id, 32),
          })
            .select('id')
            .all()
        ).length,
        0,
      )

      await products.delete(user, first.id)
      await products.delete(user, second.id)
      assert.equal(
        (await prisma8Client.orm.public.Product.where({ organizationId: org }).select('id').all()).length,
        0,
      )
    } finally {
      const org = prisma8Varchar(organizationId, 32)
      const quotationIds = await prisma8Client.orm.public.OpportunityQuotation.where({
        organizationId: org,
      })
        .select('id')
        .all()
      if (quotationIds.length) {
        const ids = quotationIds.map((item) => item.id)
        await prisma8Client.orm.public.OpportunityQuotationField
          .where((row) => row.resourceId.in(ids))
          .deleteAll()
        await prisma8Client.orm.public.OpportunityQuotation.where((row) => row.id.in(ids)).deleteAll()
      }
      await prisma8Client.orm.public.Opportunity.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.OpportunityStageConfig.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.ProductPrice.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Product.where({ organizationId: org }).deleteAll()
      await testDb.close()
    }
  },
)
