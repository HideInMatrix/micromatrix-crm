import { BadRequestException, Injectable } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import { randomUUID } from 'node:crypto'
import type { Prisma8Client } from '../../prisma/prisma8-client.js'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
import { ModuleFormsService } from '../metadata/module-forms.service'

const FORM_KEY = 'contract'
type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

export interface ContractProductInput {
  product: string
  productAmount: number
  productNumber?: number
  amount?: number
  rowId?: string
  bizId?: string
  values?: Record<string, unknown>
}

export interface ContractProductValue {
  rowId: string
  bizId: string
  productId: string
  productName?: string
  productAmount: number
  productNumber: number
  amount: number
  values: Record<string, unknown>
}

@Injectable()
export class ContractFieldsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly moduleForms: ModuleFormsService,
  ) {}

  async saveProducts(
    organizationId: string,
    resourceId: string,
    products: ContractProductInput[],
    tx: Prisma8Transaction,
  ) {
    const fields = await this.moduleForms.listFieldsInTransaction(tx, organizationId, FORM_KEY)
    const required = this.requiredFields(fields)
    const productIds = [...new Set(products.map((item) => item.product))]
    if (productIds.length) {
      const count = await tx.orm.public.Product.where({
        organizationId: organizationId,
      })
        .where((row) => row.id.in(productIds))
        .aggregate((aggregate) => ({ count: aggregate.count() }))
      if (count.count !== productIds.length) throw new BadRequestException('合同包含不存在的产品')
    }
    await Promise.all([
      tx.orm.public.ContractField.where({
        resourceId: resourceId,
        refSubId: required.parent.id,
      }).deleteAll(),
      tx.orm.public.ContractFieldBlob.where({
        resourceId: resourceId,
        refSubId: required.parent.id,
      }).deleteAll(),
    ])
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const reserved = new Set([
      'products',
      'product',
      'productAmount',
      'productNumber',
      'sumAmount',
      'amount',
    ])
    for (const item of products) {
      const rowId = item.rowId || this.id()
      const bizId = item.bizId || this.id()
      const quantity = item.productNumber ?? 1
      const amount = item.amount ?? this.lineAmount(item.productAmount, quantity)
      const cells: Array<[FieldVO, unknown]> = [
        [required.productField, item.product],
        [required.productAmountField, item.productAmount],
        [required.productNumberField, quantity],
        [required.sumAmountField, amount],
      ]
      for (const [field, value] of cells)
        await this.writeCell(tx, resourceId, required.parent.id, rowId, bizId, field, value)
      for (const [key, value] of Object.entries(item.values ?? {})) {
        if (reserved.has(key)) continue
        const field = fieldMap.get(key)
        if (!field || !field.hidden) throw new BadRequestException(`合同产品子字段不存在：${key}`)
        await this.writeCell(tx, resourceId, required.parent.id, rowId, bizId, field, value)
      }
    }
  }

  async loadProducts(organizationId: string, resourceId: string): Promise<ContractProductValue[]> {
    return (await this.loadProductsBatch(organizationId, [resourceId])).get(resourceId) ?? []
  }

  async loadProductsBatch(organizationId: string, resourceIds: string[]) {
    const ids = [...new Set(resourceIds)]
    const result = new Map(ids.map((id) => [id, [] as ContractProductValue[]]))
    if (!ids.length) return result
    const fields = await this.moduleForms.listFields(organizationId, FORM_KEY)
    const required = this.requiredFields(fields)
    const fieldMap = new Map(fields.map((field) => [field.id, field]))
    const allowedResources = await this.prisma8.client.orm.public.Contract.where({
      organizationId: organizationId,
    })
      .where((row) => row.id.in(ids))
      .select('id')
      .all()
    const allowedIds = allowedResources.map((row) => String(row.id))
    if (!allowedIds.length) return result
    const refSubId = required.parent.id
    const resourceIdFilter = allowedIds
    const [normal, blob] = await Promise.all([
      this.prisma8.client.orm.public.ContractField.where({ refSubId })
        .where((row) => row.resourceId.in(resourceIdFilter))
        .select('resourceId', 'fieldId', 'fieldValue', 'rowId', 'bizId')
        .all(),
      this.prisma8.client.orm.public.ContractFieldBlob.where({ refSubId })
        .where((row) => row.resourceId.in(resourceIdFilter))
        .select('resourceId', 'fieldId', 'fieldValue', 'rowId', 'bizId')
        .all(),
    ])
    const rows = new Map<string, ContractProductValue & { resourceId: string }>()
    for (const cell of [...normal, ...blob]) {
      if (!cell.rowId) continue
      const key = `${cell.resourceId}:${cell.rowId}`
      const row = rows.get(key) ?? {
        resourceId: cell.resourceId,
        rowId: cell.rowId,
        bizId: cell.bizId ?? cell.rowId,
        productId: '',
        productAmount: 0,
        productNumber: 1,
        amount: 0,
        values: {},
      }
      const field = fieldMap.get(cell.fieldId)
      if (!field) continue
      if (field.id === required.productField.id) row.productId = cell.fieldValue
      else if (field.id === required.productAmountField.id)
        row.productAmount = Number(cell.fieldValue)
      else if (field.id === required.productNumberField.id)
        row.productNumber = Number(cell.fieldValue)
      else if (field.id === required.sumAmountField.id) row.amount = Number(cell.fieldValue)
      else row.values[field.key] = this.deserialize(field, cell.fieldValue)
      rows.set(key, row)
    }
    const validRows = [...rows.values()].filter((row) => row.productId)
    const productIds = [...new Set(validRows.map((row) => row.productId))]
    const products = productIds.length
      ? await this.prisma8.client.orm.public.Product.where({
          organizationId: organizationId,
        })
          .where((row) => row.id.in(productIds))
          .select('id', 'name')
          .all()
      : []
    const names = new Map(products.map((item) => [String(item.id), String(item.name)]))
    for (const row of validRows) {
      const { resourceId, ...value } = row
      result.get(resourceId)?.push({ ...value, productName: names.get(row.productId) })
    }
    for (const list of result.values()) list.sort((a, b) => a.rowId.localeCompare(b.rowId))
    return result
  }

  private requiredFields(fields: FieldVO[]) {
    const parent = fields.find((field) => field.key === 'products')
    const productField = fields.find((field) => field.key === 'product')
    const productAmountField = fields.find((field) => field.key === 'productAmount')
    const productNumberField = fields.find((field) => field.key === 'productNumber')
    const sumAmountField = fields.find((field) => field.key === 'sumAmount')
    if (!parent || !productField || !productAmountField || !productNumberField || !sumAmountField)
      throw new BadRequestException('合同产品子表字段配置不完整')
    return { parent, productField, productAmountField, productNumberField, sumAmountField }
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
    const data = {
      id: createLegacyId32(),
      resourceId: resourceId,
      fieldId: field.id,
      fieldValue: serialized,
      refSubId: refSubId,
      rowId: rowId,
      bizId: bizId,
    }
    if (this.isBlob(field, serialized)) await tx.orm.public.ContractFieldBlob.create(data)
    else {
      await tx.orm.public.ContractField.create({
        ...data,
        fieldValue: serialized,
      })
    }
  }

  private serialize(value: unknown) {
    if (Array.isArray(value) || (typeof value === 'object' && value !== null))
      return JSON.stringify(value)
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
    return (
      ['textarea', 'multiselect', 'checkbox', 'picture'].includes(field.type) ||
      serialized.length > 255
    )
  }

  private lineAmount(price: number, quantity: number) {
    return Math.round(price * quantity * 100) / 100
  }
  private id() {
    return randomUUID().replaceAll('-', '').slice(0, 32)
  }
}
