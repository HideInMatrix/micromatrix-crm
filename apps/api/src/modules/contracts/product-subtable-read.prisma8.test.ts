import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import type { FieldVO } from '@micromatrix/shared'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'
import { createLegacyId32 } from '../../common/legacy-id'
import { openPrismaTestDatabase } from '../../testing/prisma-test-db'
import type { ModuleFormsService } from '../metadata/module-forms.service'
import { OrderFieldsService } from '../orders/order-fields.service'
import { ProductPriceFieldsService } from '../products/product-price-fields.service'
import { QuotationFieldsService } from '../quotes/quotation-fields.service'
import { ContractFieldsService } from './contract-fields.service'

const databaseUrl = process.env['DATABASE_URL']

function id() {
  return createLegacyId32()
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
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prisma8Client = testDb.client
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

    try {
      const org = organizationId
      const foreignOrg = foreignOrganizationId
      const actor = actorId
      const product = await prisma8Client.orm.public.Product.select('id').create({
        id: id(),
        name: 'Prisma 8 产品',
        status: 'ENABLED',
        pos: 1n,
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const price = await prisma8Client.orm.public.ProductPrice.select('id').create({
        id: id(),
        name: '标准价格表',
        status: 'ENABLED',
        pos: 1n,
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const customer = await prisma8Client.orm.public.Customer.select('id').create({
        id: id(),
        name: '合同客户',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const foreignCustomer = await prisma8Client.orm.public.Customer.select('id').create({
        id: id(),
        name: '跨租户客户',
        organizationId: foreignOrg,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const contract = await prisma8Client.orm.public.Contract.select('id').create({
        id: id(),
        name: '合同 A',
        customerId: customer.id,
        owner: actor,
        amount: numericValue(decimalString(200, 14, 2), 14, 2),
        number: `C-${suffix.slice(0, 8)}`,
        stage: 'stage-a',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const foreignContract = await prisma8Client.orm.public.Contract.select('id').create({
        id: id(),
        name: '合同 B',
        customerId: foreignCustomer.id,
        owner: actor,
        amount: numericValue(decimalString(100, 14, 2), 14, 2),
        number: `F-${suffix.slice(0, 8)}`,
        stage: 'stage-b',
        organizationId: foreignOrg,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const order = await prisma8Client.orm.public.SalesOrder.select('id').create({
        id: id(),
        number: `O-${suffix.slice(0, 8)}`,
        name: '订单 A',
        stage: 'stage-a',
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const opportunityStage = await prisma8Client.orm.public.OpportunityStageConfig.select(
        'id',
      ).create({
        id: id(),
        name: '测试阶段',
        _type: 'AFOOT',
        rate: '50',
        pos: 1n,
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const opportunity = await prisma8Client.orm.public.Opportunity.select('id').create({
        id: id(),
        name: '商机 A',
        organizationId: org,
        stage: opportunityStage.id,
        owner: actor,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })
      const quotation = await prisma8Client.orm.public.OpportunityQuotation.select('id').create({
        id: id(),
        name: '报价 A',
        opportunityId: opportunity.id,
        untilTime: now + 86_400_000n,
        amount: numericValue(decimalString(200, 14, 2), 14, 2),
        organizationId: org,
        createTime: now,
        updateTime: now,
        createUser: actor,
        updateUser: actor,
      })

      const contractRow = id()
      await prisma8Client.orm.public.ContractField.createAll(
        [
          {
            id: id(),
            resourceId: contract.id,
            refSubId: contractFields[0]!.id,
            rowId: contractRow,
            bizId: contractRow,
            fieldId: contractFields[1]!.id,
            fieldValue: product.id,
          },
          {
            id: id(),
            resourceId: contract.id,
            refSubId: contractFields[0]!.id,
            rowId: contractRow,
            bizId: contractRow,
            fieldId: contractFields[2]!.id,
            fieldValue: '100',
          },
          {
            id: id(),
            resourceId: contract.id,
            refSubId: contractFields[0]!.id,
            rowId: contractRow,
            bizId: contractRow,
            fieldId: contractFields[3]!.id,
            fieldValue: '2',
          },
          {
            id: id(),
            resourceId: contract.id,
            refSubId: contractFields[0]!.id,
            rowId: contractRow,
            bizId: contractRow,
            fieldId: contractFields[4]!.id,
            fieldValue: '200',
          },
          {
            id: id(),
            resourceId: foreignContract.id,
            refSubId: contractFields[0]!.id,
            rowId: id(),
            bizId: id(),
            fieldId: contractFields[1]!.id,
            fieldValue: product.id,
          },
        ].map((row) => ({
          ...row,
          resourceId: row.resourceId,
          refSubId: row.refSubId,
          rowId: row.rowId,
          bizId: row.bizId,
          fieldId: row.fieldId,
          fieldValue: row.fieldValue,
        })),
      )
      await prisma8Client.orm.public.ContractFieldBlob.create({
        id: id(),
        resourceId: contract.id,
        refSubId: contractFields[0]!.id,
        rowId: contractRow,
        bizId: contractRow,
        fieldId: contractFields[5]!.id,
        fieldValue: '["A","B"]',
      })

      const priceRow = id()
      await prisma8Client.orm.public.ProductPriceField.createAll(
        [
          {
            id: id(),
            resourceId: price.id,
            refSubId: priceFields[0]!.id,
            rowId: priceRow,
            bizId: priceRow,
            fieldId: priceFields[1]!.id,
            fieldValue: product.id,
          },
          {
            id: id(),
            resourceId: price.id,
            refSubId: priceFields[0]!.id,
            rowId: priceRow,
            bizId: priceRow,
            fieldId: priceFields[2]!.id,
            fieldValue: '88.5',
          },
        ].map((row) => ({
          ...row,
          resourceId: row.resourceId,
          refSubId: row.refSubId,
          rowId: row.rowId,
          bizId: row.bizId,
          fieldId: row.fieldId,
          fieldValue: row.fieldValue,
        })),
      )
      await prisma8Client.orm.public.ProductPriceFieldBlob.create({
        id: id(),
        resourceId: price.id,
        refSubId: priceFields[0]!.id,
        rowId: priceRow,
        bizId: priceRow,
        fieldId: priceFields[3]!.id,
        fieldValue: '["VIP"]',
      })

      const orderRow = id()
      await prisma8Client.orm.public.SalesOrderField.createAll(
        [
          {
            id: id(),
            resourceId: order.id,
            refSubId: orderFields[0]!.id,
            rowId: orderRow,
            bizId: orderRow,
            fieldId: orderFields[1]!.id,
            fieldValue: product.id,
          },
          {
            id: id(),
            resourceId: order.id,
            refSubId: orderFields[0]!.id,
            rowId: orderRow,
            bizId: orderRow,
            fieldId: orderFields[2]!.id,
            fieldValue: '90',
          },
          {
            id: id(),
            resourceId: order.id,
            refSubId: orderFields[0]!.id,
            rowId: orderRow,
            bizId: orderRow,
            fieldId: orderFields[3]!.id,
            fieldValue: '2',
          },
          {
            id: id(),
            resourceId: order.id,
            refSubId: orderFields[0]!.id,
            rowId: orderRow,
            bizId: orderRow,
            fieldId: orderFields[4]!.id,
            fieldValue: '180',
          },
        ].map((row) => ({
          ...row,
          resourceId: row.resourceId,
          refSubId: row.refSubId,
          rowId: row.rowId,
          bizId: row.bizId,
          fieldId: row.fieldId,
          fieldValue: row.fieldValue,
        })),
      )
      await prisma8Client.orm.public.SalesOrderFieldBlob.create({
        id: id(),
        resourceId: order.id,
        refSubId: orderFields[0]!.id,
        rowId: orderRow,
        bizId: orderRow,
        fieldId: orderFields[5]!.id,
        fieldValue: '["gift"]',
      })

      const quoteRow = id()
      await prisma8Client.orm.public.OpportunityQuotationField.createAll(
        [
          {
            id: id(),
            resourceId: quotation.id,
            refSubId: quoteFields[0]!.id,
            rowId: quoteRow,
            bizId: quoteRow,
            fieldId: quoteFields[1]!.id,
            fieldValue: product.id,
          },
          {
            id: id(),
            resourceId: quotation.id,
            refSubId: quoteFields[0]!.id,
            rowId: quoteRow,
            bizId: quoteRow,
            fieldId: quoteFields[2]!.id,
            fieldValue: price.id,
          },
          {
            id: id(),
            resourceId: quotation.id,
            refSubId: quoteFields[0]!.id,
            rowId: quoteRow,
            bizId: quoteRow,
            fieldId: quoteFields[3]!.id,
            fieldValue: '2',
          },
          {
            id: id(),
            resourceId: quotation.id,
            refSubId: quoteFields[0]!.id,
            rowId: quoteRow,
            bizId: quoteRow,
            fieldId: quoteFields[4]!.id,
            fieldValue: '95',
          },
          {
            id: id(),
            resourceId: quotation.id,
            refSubId: quoteFields[0]!.id,
            rowId: quoteRow,
            bizId: quoteRow,
            fieldId: quoteFields[5]!.id,
            fieldValue: '6',
          },
          {
            id: id(),
            resourceId: quotation.id,
            refSubId: quoteFields[0]!.id,
            rowId: quoteRow,
            bizId: quoteRow,
            fieldId: quoteFields[6]!.id,
            fieldValue: '190',
          },
        ].map((row) => ({
          ...row,
          resourceId: row.resourceId,
          refSubId: row.refSubId,
          rowId: row.rowId,
          bizId: row.bizId,
          fieldId: row.fieldId,
          fieldValue: row.fieldValue,
        })),
      )
      await prisma8Client.orm.public.OpportunityQuotationFieldBlob.create({
        id: id(),
        resourceId: quotation.id,
        refSubId: quoteFields[0]!.id,
        rowId: quoteRow,
        bizId: quoteRow,
        fieldId: quoteFields[7]!.id,
        fieldValue: '["quoted"]',
      })

      const contractService = new ContractFieldsService(prisma8, forms(contractFields))
      const priceService = new ProductPriceFieldsService(prisma8, forms(priceFields))
      const orderService = new OrderFieldsService(prisma8, forms(orderFields))
      const quoteService = new QuotationFieldsService(prisma8, forms(quoteFields))

      const contractResult = await contractService.loadProductsBatch(organizationId, [
        contract.id,
        foreignContract.id,
      ])
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
      const org = organizationId
      const foreignOrg = foreignOrganizationId
      await prisma8Client.orm.public.OpportunityQuotation.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Opportunity.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.OpportunityStageConfig.where({
        organizationId: org,
      }).deleteAll()
      await prisma8Client.orm.public.SalesOrder.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Contract.where((row) =>
        row.organizationId.in([org, foreignOrg]),
      ).deleteAll()
      await prisma8Client.orm.public.Customer.where((row) =>
        row.organizationId.in([org, foreignOrg]),
      ).deleteAll()
      await prisma8Client.orm.public.ProductPrice.where({ organizationId: org }).deleteAll()
      await prisma8Client.orm.public.Product.where({ organizationId: org }).deleteAll()
      await testDb.close()
    }
  },
)
