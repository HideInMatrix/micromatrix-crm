import { BadRequestException, Injectable } from '@nestjs/common'
import type { FieldVO, ProductPriceItemVO } from '@micromatrix/shared'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import type { ProductPriceItemDto } from './dto/product-price.dto'

const FORM_KEY = 'price'

@Injectable()
export class ProductPriceFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleForms: ModuleFormsService,
  ) {}

  async saveProducts(
    organizationId: string,
    resourceId: string,
    products: ProductPriceItemDto[],
    tx: Prisma.TransactionClient,
  ) {
    const fields = await this.moduleForms.listFieldsInTransaction(tx, organizationId, FORM_KEY)
    const { parent, productField, amountField } = this.requiredFields(fields)
    const productIds = [...new Set(products.map((item) => item.product))]
    if (productIds.length) {
      const count = await tx.product.count({
        where: { organizationId, id: { in: productIds } },
      })
      if (count !== productIds.length) throw new BadRequestException('价格表包含不存在的产品')
    }

    await Promise.all([
      tx.productPriceField.deleteMany({ where: { resourceId, refSubId: parent.id } }),
      tx.productPriceFieldBlob.deleteMany({ where: { resourceId, refSubId: parent.id } }),
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
    const where = { resourceId: { in: ids }, refSubId: parent.id, resource: { organizationId } }
    const select = {
      resourceId: true,
      fieldId: true,
      fieldValue: true,
      rowId: true,
      bizId: true,
    }
    const [normal, blob] = await Promise.all([
      this.prisma.productPriceField.findMany({ where, select }),
      this.prisma.productPriceFieldBlob.findMany({ where, select }),
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
      ? await this.prisma.product.findMany({
          where: { organizationId, id: { in: rows.map((row) => row.productId) } },
          select: { id: true, name: true },
        })
      : []
    const nameMap = new Map(products.map((product) => [product.id, product.name]))
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
    tx: Prisma.TransactionClient,
    resourceId: string,
    refSubId: string,
    rowId: string,
    bizId: string,
    field: FieldVO,
    value: unknown,
  ) {
    if (value === undefined || value === null || value === '') return
    const serialized = this.serialize(value)
    const data = {
      resourceId,
      fieldId: field.id,
      fieldValue: serialized,
      refSubId,
      rowId,
      bizId,
    }
    if (this.isBlob(field, serialized)) await tx.productPriceFieldBlob.create({ data })
    else await tx.productPriceField.create({ data })
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
