import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { FieldVO } from '@micromatrix/shared'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import type { ModuleFormsService } from '../metadata/module-forms.service'
import { OrderFieldsService } from '../orders/order-fields.service'
import { ProductPriceFieldsService } from '../products/product-price-fields.service'
import { QuotationFieldsService } from '../quotes/quotation-fields.service'
import { ContractFieldsService } from './contract-fields.service'

const databaseUrl = process.env['DATABASE_URL']

function id() {
  return randomUUID().replaceAll('-', '').slice(0, 32)
}

function field(idValue: string, key: string, type = 'text'): FieldVO {
  return {
    id: idValue,
    module: 'test',
    key,
    label: key,
    type,
    required: false,
    system: false,
    hidden: true,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
  } as FieldVO
}

function forms(fields: FieldVO[]) {
  return { listFields: async () => fields } as unknown as ModuleFormsService
}

test(
  '产品子表 batch reader 使用 Prisma 8 保持租户隔离、normal/blob 合并与名称装配',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const prisma8 = { client: prisma8Client } as Prisma8Service
    const suffix = randomUUID().replaceAll('-', '')
    const organizationId = `org-${suffix}`.slice(0, 32)
    const foreignOrganizationId = `other-${suffix}`.slice(0, 32)
    const actorId = `u${suffix}`.slice(0, 32)
    const now = BigInt(Date.now())

    const contractFields = [
      field(id(), 'products'),
      field(id(), 'product'),
      field(id(), 'productAmount', 'currency'),
      field(id(), 'productNumber', 'number'),
      field(id(), 'sumAmount', 'currency'),
      field(id(), 'contractExtra', 'multiselect'),
    ]
    const priceFields = [
      field(id(), 'products'),
      field(id(), 'product'),
      field(id(), 'amount', 'currency'),
      field(id(), 'priceExtra', 'multiselect'),
    ]
    const orderFields = [
      field(id(), 'orderProducts'),
      field(id(), 'orderProduct'),
      field(id(), 'orderProductPrice', 'currency'),
      field(id(), 'orderProductNumber', 'number'),
      field(id(), 'orderProductAmount', 'currency'),
      field(id(), 'orderExtra', 'multiselect'),
    ]
    const quoteFields = [
      field(id(), 'products'),
      field(id(), 'product'),
      field(id(), 'priceId'),
      field(id(), 'productAmount', 'currency'),
      field(id(), 'discount', 'number'),
      field(id(), 'tax', 'number'),
      field(id(), 'lineAmount', 'currency'),
      field(id(), 'quoteExtra', 'multiselect'),
    ]

    await fixtureDb.$connect()
    await prisma8Client.connect()
    try {
      const product = await fixtureDb.product.create({
        data: {
          name: 'Prisma 8 产品',
          status: 'ENABLED',
          pos: 1n,
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const price = await fixtureDb.productPrice.create({
        data: {
          name: '标准价格表',
          status: 'ENABLED',
          pos: 1n,
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const customer = await fixtureDb.customer.create({
        data: {
          name: '合同客户',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const foreignCustomer = await fixtureDb.customer.create({
        data: {
          name: '跨租户客户',
          organizationId: foreignOrganizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const contract = await fixtureDb.contract.create({
        data: {
          name: '合同 A',
          customerId: customer.id,
          owner: actorId,
          amount: 200,
          number: `C-${suffix.slice(0, 8)}`,
          stage: 'stage-a',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const foreignContract = await fixtureDb.contract.create({
        data: {
          name: '合同 B',
          customerId: foreignCustomer.id,
          owner: actorId,
          amount: 100,
          number: `F-${suffix.slice(0, 8)}`,
          stage: 'stage-b',
          organizationId: foreignOrganizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const order = await fixtureDb.order.create({
        data: {
          number: `O-${suffix.slice(0, 8)}`,
          name: '订单 A',
          stage: 'stage-a',
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const opportunityStage = await fixtureDb.opportunityStageConfig.create({
        data: {
          name: '测试阶段',
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
          name: '商机 A',
          organizationId,
          stage: opportunityStage.id,
          owner: actorId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })
      const quotation = await fixtureDb.opportunityQuotation.create({
        data: {
          name: '报价 A',
          opportunityId: opportunity.id,
          untilTime: now + 86_400_000n,
          amount: 200,
          organizationId,
          createTime: now,
          updateTime: now,
          createUser: actorId,
          updateUser: actorId,
        },
      })

      const contractRow = id()
      await fixtureDb.contractField.createMany({
        data: [
          { id: id(), resourceId: contract.id, refSubId: contractFields[0]!.id, rowId: contractRow, bizId: contractRow, fieldId: contractFields[1]!.id, fieldValue: product.id },
          { id: id(), resourceId: contract.id, refSubId: contractFields[0]!.id, rowId: contractRow, bizId: contractRow, fieldId: contractFields[2]!.id, fieldValue: '100' },
          { id: id(), resourceId: contract.id, refSubId: contractFields[0]!.id, rowId: contractRow, bizId: contractRow, fieldId: contractFields[3]!.id, fieldValue: '2' },
          { id: id(), resourceId: contract.id, refSubId: contractFields[0]!.id, rowId: contractRow, bizId: contractRow, fieldId: contractFields[4]!.id, fieldValue: '200' },
          { id: id(), resourceId: foreignContract.id, refSubId: contractFields[0]!.id, rowId: id(), bizId: id(), fieldId: contractFields[1]!.id, fieldValue: product.id },
        ],
      })
      await fixtureDb.contractFieldBlob.create({
        data: { resourceId: contract.id, refSubId: contractFields[0]!.id, rowId: contractRow, bizId: contractRow, fieldId: contractFields[5]!.id, fieldValue: '["A","B"]' },
      })

      const priceRow = id()
      await fixtureDb.productPriceField.createMany({
        data: [
          { id: id(), resourceId: price.id, refSubId: priceFields[0]!.id, rowId: priceRow, bizId: priceRow, fieldId: priceFields[1]!.id, fieldValue: product.id },
          { id: id(), resourceId: price.id, refSubId: priceFields[0]!.id, rowId: priceRow, bizId: priceRow, fieldId: priceFields[2]!.id, fieldValue: '88.5' },
        ],
      })
      await fixtureDb.productPriceFieldBlob.create({
        data: { resourceId: price.id, refSubId: priceFields[0]!.id, rowId: priceRow, bizId: priceRow, fieldId: priceFields[3]!.id, fieldValue: '["VIP"]' },
      })

      const orderRow = id()
      await fixtureDb.orderField.createMany({
        data: [
          { id: id(), resourceId: order.id, refSubId: orderFields[0]!.id, rowId: orderRow, bizId: orderRow, fieldId: orderFields[1]!.id, fieldValue: product.id },
          { id: id(), resourceId: order.id, refSubId: orderFields[0]!.id, rowId: orderRow, bizId: orderRow, fieldId: orderFields[2]!.id, fieldValue: '90' },
          { id: id(), resourceId: order.id, refSubId: orderFields[0]!.id, rowId: orderRow, bizId: orderRow, fieldId: orderFields[3]!.id, fieldValue: '2' },
          { id: id(), resourceId: order.id, refSubId: orderFields[0]!.id, rowId: orderRow, bizId: orderRow, fieldId: orderFields[4]!.id, fieldValue: '180' },
        ],
      })
      await fixtureDb.orderFieldBlob.create({
        data: { resourceId: order.id, refSubId: orderFields[0]!.id, rowId: orderRow, bizId: orderRow, fieldId: orderFields[5]!.id, fieldValue: '["gift"]' },
      })

      const quoteRow = id()
      await fixtureDb.opportunityQuotationField.createMany({
        data: [
          { id: id(), resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[1]!.id, fieldValue: product.id },
          { id: id(), resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[2]!.id, fieldValue: price.id },
          { id: id(), resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[3]!.id, fieldValue: '2' },
          { id: id(), resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[4]!.id, fieldValue: '95' },
          { id: id(), resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[5]!.id, fieldValue: '6' },
          { id: id(), resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[6]!.id, fieldValue: '190' },
        ],
      })
      await fixtureDb.opportunityQuotationFieldBlob.create({
        data: { resourceId: quotation.id, refSubId: quoteFields[0]!.id, rowId: quoteRow, bizId: quoteRow, fieldId: quoteFields[7]!.id, fieldValue: '["quoted"]' },
      })

      const contractService = new ContractFieldsService(prisma8, forms(contractFields))
      const priceService = new ProductPriceFieldsService(prisma8, forms(priceFields))
      const orderService = new OrderFieldsService(prisma8, forms(orderFields))
      const quoteService = new QuotationFieldsService(prisma8, forms(quoteFields))

      const contractResult = await contractService.loadProductsBatch(organizationId, [contract.id, foreignContract.id])
      assert.deepEqual(contractResult.get(foreignContract.id), [])
      assert.deepEqual(contractResult.get(contract.id)?.[0], {
        rowId: contractRow,
        bizId: contractRow,
        productId: product.id,
        productName: 'Prisma 8 产品',
        productAmount: 100,
        productNumber: 2,
        amount: 200,
        values: { contractExtra: ['A', 'B'] },
      })

      assert.deepEqual((await priceService.loadProducts(organizationId, price.id))[0], {
        rowId: priceRow,
        bizId: priceRow,
        productId: product.id,
        productName: 'Prisma 8 产品',
        amount: 88.5,
        values: { priceExtra: ['VIP'] },
      })
      assert.deepEqual((await orderService.loadProducts(organizationId, order.id))[0], {
        rowId: orderRow,
        bizId: orderRow,
        productId: product.id,
        productName: 'Prisma 8 产品',
        productPrice: 90,
        productNumber: 2,
        amount: 180,
        values: { orderExtra: ['gift'] },
      })
      assert.deepEqual((await quoteService.loadProducts(organizationId, quotation.id))[0], {
        rowId: quoteRow,
        bizId: quoteRow,
        productId: product.id,
        productName: 'Prisma 8 产品',
        priceId: price.id,
        priceName: '标准价格表',
        productAmount: 2,
        discount: 95,
        tax: 6,
        amount: 190,
        values: { quoteExtra: ['quoted'] },
      })
    } finally {
      await fixtureDb.opportunityQuotation.deleteMany({ where: { organizationId } })
      await fixtureDb.opportunity.deleteMany({ where: { organizationId } })
      await fixtureDb.opportunityStageConfig.deleteMany({ where: { organizationId } })
      await fixtureDb.order.deleteMany({ where: { organizationId } })
      await fixtureDb.contract.deleteMany({ where: { organizationId: { in: [organizationId, foreignOrganizationId] } } })
      await fixtureDb.customer.deleteMany({ where: { organizationId: { in: [organizationId, foreignOrganizationId] } } })
      await fixtureDb.productPrice.deleteMany({ where: { organizationId } })
      await fixtureDb.product.deleteMany({ where: { organizationId } })
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
