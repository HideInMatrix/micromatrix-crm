import { BadRequestException, Injectable } from '@nestjs/common'
import type { FieldVO, ProductPriceItemVO } from '@micromatrix/shared'
import { randomUUID } from 'node:crypto'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { ModuleFormsService } from '../metadata/module-forms.service'
import type { ProductPriceItemDto } from './dto/product-price.dto'

const FORM_KEY = 'price'
type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

@Injectable()
export class ProductPriceFieldsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly moduleForms: ModuleFormsService,
  ) {}

  async saveProducts(
    organizationId: string,
    resourceId: string,
    products: ProductPriceItemDto[],
    tx: Prisma8Transaction,
  ) {
    const fields = await this.moduleForms.listFieldsInTransaction(tx, organizationId, FORM_KEY)
    const { parent, productField, amountField } = this.requiredFields(fields)
    const productIds = [...new Set(products.map((item) => item.product))]
    if (productIds.length) {
      const { count } = await tx.orm.public.Product.where({
        organizationId: prisma8Varchar(organizationId, 32),
      })
        .where((row) => row.id.in(prisma8Varchars(productIds, 32)))
        .aggregate((aggregate) => ({ count: aggregate.count() }))
      if (count !== productIds.length) throw new BadRequestException('价格表包含不存在的产品')
    }

    await Promise.all([
      tx.orm.public.ProductPriceField.where({
        resourceId: prisma8Varchar(resourceId, 32),
        refSubId: prisma8Varchar(parent.id, 32),
      }).deleteAll(),
      tx.orm.public.ProductPriceFieldBlob.where({
        resourceId: prisma8Varchar(resourceId, 32),
        refSubId: prisma8Varchar(parent.id, 32),
      }).deleteAll(),
    ])

    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    for (const item of products) {
      const rowId = item.rowId || this.id()
      const bizId = item.bizId || this.id()
      await this.writeCell(tx, resourceId, parent.id, rowId, bizId, productField, item.product)
      await this.writeCell(tx, resourceId, parent.id, rowId, bizId, amountField, item.amount)
      for (const [key, value] of Object.entries(item.values ?? {})) {
        const field = fieldMap.get(key)
        if (!field || ['name', 'status', 'products', 'product', 'amount'].includes(field.key)) {
          throw new BadRequestException(`价格表子字段不存在：${key}`)
        }
        await this.writeCell(tx, resourceId, parent.id, rowId, bizId, field, value)
      }
    }
  }

  async loadProducts(organizationId: string, resourceId: string): Promise<ProductPriceItemVO[]> {
    return (await this.loadProductsBatch(organizationId, [resourceId])).get(resourceId) ?? []
  }

  async loadProductsBatch(
    organizationId: string,
    resourceIds: string[],
  ): Promise<Map<string, ProductPriceItemVO[]>> {
    const result = new Map<string, ProductPriceItemVO[]>()
    const ids = [...new Set(resourceIds)]
    if (!ids.length) return result
    const fields = await this.moduleForms.listFields(organizationId, FORM_KEY)
    const { parent, productField, amountField } = this.requiredFields(fields)
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    const allowedResources = await this.prisma8.client.orm.public.ProductPrice.where({
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .where((row) => row.id.in(prisma8Varchars(ids, 32)))
      .select('id')
      .all()
    const allowedIds = allowedResources.map((row) => String(row.id))
    if (!allowedIds.length) return result
    const refSubId = prisma8Varchar(parent.id, 32)
    const resourceIdFilter = prisma8Varchars(allowedIds, 32)
    const [normal, blob] = await Promise.all([
      this.prisma8.client.orm.public.ProductPriceField.where({ refSubId })
        .where((row) => row.resourceId.in(resourceIdFilter))
        .select('resourceId', 'fieldId', 'fieldValue', 'rowId', 'bizId')
        .all(),
      this.prisma8.client.orm.public.ProductPriceFieldBlob.where({ refSubId })
        .where((row) => row.resourceId.in(resourceIdFilter))
        .select('resourceId', 'fieldId', 'fieldValue', 'rowId', 'bizId')
        .all(),
    ])
    const groups = new Map<
      string,
      {
        resourceId: string
        rowId: string
        bizId: string
        productId: string
        amount: number
        values: Record<string, unknown>
      }
    >()
    for (const cell of [...normal, ...blob]) {
      if (!cell.rowId) continue
      const groupKey = `${cell.resourceId}:${cell.rowId}`
      const row = groups.get(groupKey) ?? {
        resourceId: cell.resourceId,
        rowId: cell.rowId,
        bizId: cell.bizId ?? cell.rowId,
        productId: '',
        amount: 0,
        values: {},
      }
      const field = fieldMap.get(cell.fieldId)
      if (!field) continue
      if (field.id === productField.id) row.productId = cell.fieldValue
      else if (field.id === amountField.id) row.amount = Number(cell.fieldValue)
      else row.values[field.key] = this.deserialize(field, cell.fieldValue)
      groups.set(groupKey, row)
    }
    const rows = [...groups.values()].filter((row) => row.productId)
    const products = rows.length
      ? await this.prisma8.client.orm.public.Product.where({
          organizationId: prisma8Varchar(organizationId, 32),
        })
          .where((row) =>
            row.id.in(prisma8Varchars([...new Set(rows.map((item) => item.productId))], 32)),
          )
          .select('id', 'name')
          .all()
      : []
    const nameMap = new Map(products.map((product) => [String(product.id), String(product.name)]))
    for (const resourceId of ids) result.set(resourceId, [])
    for (const row of rows) {
      const list = result.get(row.resourceId) ?? []
      list.push({
        rowId: row.rowId,
        bizId: row.bizId,
        productId: row.productId,
        productName: nameMap.get(row.productId),
        amount: row.amount,
        values: row.values,
      })
      result.set(row.resourceId, list)
    }
    for (const list of result.values()) list.sort((a, b) => a.rowId.localeCompare(b.rowId))
    return result
  }

  private requiredFields(fields: FieldVO[]) {
    const parent = fields.find((field) => field.key === 'products')
    const productField = fields.find((field) => field.key === 'product')
    const amountField = fields.find((field) => field.key === 'amount')
    if (!parent || !productField || !amountField) {
      throw new BadRequestException('价格表产品子表字段配置不完整')
    }
    return { parent, productField, amountField }
  }

  private async writeCell(
    tx: Prisma8Transaction,
    resourceId: string,
    refSubId: string,
    rowId: string,
    bizId: string,
    field: FieldVO,
    value: unknown,
  ) {
    if (value === undefined || value === null || value === '') return
    const serialized = this.serialize(value)
    const base = {
      id: prisma8Id32(),
      resourceId: prisma8Varchar(resourceId, 32),
      fieldId: prisma8Varchar(field.id, 32),
      refSubId: prisma8Varchar(refSubId, 32),
      rowId: prisma8Varchar(rowId, 32),
      bizId: prisma8Varchar(bizId, 32),
    }
    if (this.isBlob(field, serialized)) {
      await tx.orm.public.ProductPriceFieldBlob.create({ ...base, fieldValue: serialized })
    } else {
      await tx.orm.public.ProductPriceField.create({
        ...base,
        fieldValue: prisma8Varchar(serialized, 255),
      })
    }
  }

  private serialize(value: unknown) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      return JSON.stringify(value)
    }
    return String(value)
  }

  private deserialize(field: FieldVO, value: string): unknown {
    if (['number', 'currency', 'percent'].includes(field.type)) return Number(value)
    if (field.type === 'switch') return value === 'true'
    if (['multiselect', 'checkbox'].includes(field.type)) {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return []
      }
    }
    return value
  }

  private isBlob(field: FieldVO, serialized: string) {
    return ['textarea', 'multiselect', 'checkbox'].includes(field.type) || serialized.length > 255
  }

  private id() {
    return randomUUID().replaceAll('-', '').slice(0, 32)
  }
}
