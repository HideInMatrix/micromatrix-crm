import { BadRequestException, Injectable } from '@nestjs/common'
import type { FieldVO, QuotationProductVO } from '@micromatrix/shared'
import { randomUUID } from 'node:crypto'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import type { QuotationProductDto } from './dto/quotation.dto'

const FORM_KEY = 'quote'

@Injectable()
export class QuotationFieldsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleForms: ModuleFormsService,
  ) {}

  async saveProducts(
    organizationId: string,
    resourceId: string,
    products: QuotationProductDto[],
    tx: Prisma.TransactionClient,
  ) {
    const fields = await this.moduleForms.listFieldsInTransaction(tx, organizationId, FORM_KEY)
    const required = this.requiredFields(fields)
    const productIds = [...new Set(products.map((item) => item.product))]
    if (productIds.length) {
      const count = await tx.product.count({ where: { organizationId, id: { in: productIds } } })
      if (count !== productIds.length) throw new BadRequestException('报价包含不存在的产品')
    }
    const priceIds = [...new Set(products.map((item) => item.priceId).filter((id): id is string => !!id))]
    if (priceIds.length) {
      const count = await tx.productPrice.count({ where: { organizationId, id: { in: priceIds } } })
      if (count !== priceIds.length) throw new BadRequestException('报价包含不存在的价格表')
    }

    await Promise.all([
      tx.opportunityQuotationField.deleteMany({ where: { resourceId, refSubId: required.parent.id } }),
      tx.opportunityQuotationFieldBlob.deleteMany({ where: { resourceId, refSubId: required.parent.id } }),
    ])

    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const reserved = new Set([
      'products', 'product', 'priceId', 'productAmount', 'discount', 'tax', 'lineAmount', 'amount',
    ])
    for (const item of products) {
      const rowId = item.rowId || this.id()
      const bizId = item.bizId || this.id()
      const cells: Array<[FieldVO, unknown]> = [
        [required.productField, item.product],
        [required.priceField, item.priceId],
        [required.productAmountField, item.productAmount],
        [required.discountField, item.discount],
        [required.taxField, item.tax],
        [required.lineAmountField, item.amount],
      ]
      for (const [field, value] of cells) {
        await this.writeCell(tx, resourceId, required.parent.id, rowId, bizId, field, value)
      }
      for (const [key, value] of Object.entries(item.values ?? {})) {
        if (reserved.has(key)) continue
        const field = fieldMap.get(key)
        if (!field || !field.hidden) throw new BadRequestException(`报价产品子字段不存在：${key}`)
        await this.writeCell(tx, resourceId, required.parent.id, rowId, bizId, field, value)
      }
    }
  }

  async loadProducts(organizationId: string, resourceId: string): Promise<QuotationProductVO[]> {
    return (await this.loadProductsBatch(organizationId, [resourceId])).get(resourceId) ?? []
  }

  async loadProductsBatch(
    organizationId: string,
    resourceIds: string[],
  ): Promise<Map<string, QuotationProductVO[]>> {
    const ids = [...new Set(resourceIds)]
    const result = new Map(ids.map((id) => [id, [] as QuotationProductVO[]]))
    if (!ids.length) return result
    const fields = await this.moduleForms.listFields(organizationId, FORM_KEY)
    const required = this.requiredFields(fields)
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    const where = {
      resourceId: { in: ids },
      refSubId: required.parent.id,
      resource: { organizationId },
    }
    const select = { resourceId: true, fieldId: true, fieldValue: true, rowId: true, bizId: true }
    const [normal, blob] = await Promise.all([
      this.prisma.opportunityQuotationField.findMany({ where, select }),
      this.prisma.opportunityQuotationFieldBlob.findMany({ where, select }),
    ])
    const rows = new Map<string, {
      resourceId: string
      rowId: string
      bizId: string
      productId: string
      priceId: string | null
      productAmount: number
      discount: number
      tax: number
      amount: number
      values: Record<string, unknown>
    }>()
    for (const cell of [...normal, ...blob]) {
      if (!cell.rowId) continue
      const key = `${cell.resourceId}:${cell.rowId}`
      const row = rows.get(key) ?? {
        resourceId: cell.resourceId,
        rowId: cell.rowId,
        bizId: cell.bizId ?? cell.rowId,
        productId: '',
        priceId: null,
        productAmount: 0,
        discount: 100,
        tax: 0,
        amount: 0,
        values: {},
      }
      const field = fieldMap.get(cell.fieldId)
      if (!field) continue
      if (field.id === required.productField.id) row.productId = cell.fieldValue
      else if (field.id === required.priceField.id) row.priceId = cell.fieldValue
      else if (field.id === required.productAmountField.id) row.productAmount = Number(cell.fieldValue)
      else if (field.id === required.discountField.id) row.discount = Number(cell.fieldValue)
      else if (field.id === required.taxField.id) row.tax = Number(cell.fieldValue)
      else if (field.id === required.lineAmountField.id) row.amount = Number(cell.fieldValue)
      else row.values[field.key] = this.deserialize(field, cell.fieldValue)
      rows.set(key, row)
    }

    const validRows = [...rows.values()].filter((row) => row.productId)
    const productIds = [...new Set(validRows.map((row) => row.productId))]
    const priceIds = [...new Set(validRows.map((row) => row.priceId).filter((id): id is string => !!id))]
    const [products, prices] = await Promise.all([
      productIds.length
        ? this.prisma.product.findMany({ where: { organizationId, id: { in: productIds } }, select: { id: true, name: true } })
        : [],
      priceIds.length
        ? this.prisma.productPrice.findMany({ where: { organizationId, id: { in: priceIds } }, select: { id: true, name: true } })
        : [],
    ])
    const productNames = new Map(products.map((item) => [item.id, item.name]))
    const priceNames = new Map(prices.map((item) => [item.id, item.name]))
    for (const row of validRows) {
      result.get(row.resourceId)?.push({
        rowId: row.rowId,
        bizId: row.bizId,
        productId: row.productId,
        productName: productNames.get(row.productId),
        priceId: row.priceId,
        priceName: row.priceId ? priceNames.get(row.priceId) : null,
        productAmount: row.productAmount,
        discount: row.discount,
        tax: row.tax,
        amount: row.amount,
        values: row.values,
      })
    }
    for (const list of result.values()) list.sort((a, b) => a.rowId.localeCompare(b.rowId))
    return result
  }

  private requiredFields(fields: FieldVO[]) {
    const parent = fields.find((field) => field.key === 'products')
    const productField = fields.find((field) => field.key === 'product')
    const priceField = fields.find((field) => field.key === 'priceId')
    const productAmountField = fields.find((field) => field.key === 'productAmount')
    const discountField = fields.find((field) => field.key === 'discount')
    const taxField = fields.find((field) => field.key === 'tax')
    const lineAmountField = fields.find((field) => field.key === 'lineAmount')
    if (!parent || !productField || !priceField || !productAmountField || !discountField || !taxField || !lineAmountField) {
      throw new BadRequestException('报价产品子表字段配置不完整')
    }
    return { parent, productField, priceField, productAmountField, discountField, taxField, lineAmountField }
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
    const data = { resourceId, fieldId: field.id, fieldValue: serialized, refSubId, rowId, bizId }
    if (this.isBlob(field, serialized)) await tx.opportunityQuotationFieldBlob.create({ data })
    else await tx.opportunityQuotationField.create({ data })
  }

  private serialize(value: unknown) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return JSON.stringify(value)
    return String(value)
  }

  private deserialize(field: FieldVO, value: string): unknown {
    if (['number', 'currency', 'percent', 'formula'].includes(field.type)) return Number(value)
    if (field.type === 'switch') return value === 'true'
    if (['multiselect', 'checkbox', 'picture'].includes(field.type)) {
      try {
        return JSON.parse(value) as unknown
      } catch {
        return []
      }
    }
    return value
  }

  private isBlob(field: FieldVO, serialized: string) {
    return ['textarea', 'multiselect', 'checkbox', 'picture'].includes(field.type) || serialized.length > 255
  }

  private id() {
    return randomUUID().replaceAll('-', '').slice(0, 32)
  }
}
