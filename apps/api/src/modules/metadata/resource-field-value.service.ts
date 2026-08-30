import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  filterOpsForType,
  type FieldType,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ModuleFormsService } from './module-forms.service'

export type ResourceFieldType =
  | 'clue'
  | 'customer'
  | 'customerContact'
  | 'opportunity'
  | 'product'
  | 'productPrice'
  | 'quotation'
  | 'contract'
  | 'contractPaymentPlan'
  | 'contractPaymentRecord'
  | 'invoice'
  | 'order'
export type ResourceFieldSaveMode = 'create' | 'update'

interface ResourceConfig {
  formKey:
    | 'lead'
    | 'customer'
    | 'contact'
    | 'opportunity'
    | 'product'
    | 'price'
    | 'quote'
    | 'contract'
    | 'contractPaymentPlan'
    | 'contractPaymentRecord'
    | 'invoice'
    | 'order'
  resourceTable:
    | 'clue'
    | 'customer'
    | 'customer_contact'
    | 'opportunity'
    | 'product'
    | 'product_price'
    | 'opportunity_quotation'
    | 'contract'
    | 'contract_payment_plan'
    | 'contract_payment_record'
    | 'contract_invoice'
    | 'sales_order'
  normalTable:
    | 'clue_field'
    | 'customer_field'
    | 'customer_contact_field'
    | 'opportunity_field'
    | 'product_field'
    | 'product_price_field'
    | 'opportunity_quotation_field'
    | 'contract_field'
    | 'contract_payment_plan_field'
    | 'contract_payment_record_field'
    | 'contract_invoice_field'
    | 'sales_order_field'
  blobTable:
    | 'clue_field_blob'
    | 'customer_field_blob'
    | 'customer_contact_field_blob'
    | 'opportunity_field_blob'
    | 'product_field_blob'
    | 'product_price_field_blob'
    | 'opportunity_quotation_field_blob'
    | 'contract_field_blob'
    | 'contract_payment_plan_field_blob'
    | 'contract_payment_record_field_blob'
    | 'contract_invoice_field_blob'
    | 'sales_order_field_blob'
}

interface ValidatedFieldValue {
  field: FieldVO
  value: unknown
  serialized: string | null
  storage: 'normal' | 'blob'
}

const RESOURCE_CONFIG: Record<ResourceFieldType, ResourceConfig> = {
  clue: {
    formKey: 'lead',
    resourceTable: 'clue',
    normalTable: 'clue_field',
    blobTable: 'clue_field_blob',
  },
  customer: {
    formKey: 'customer',
    resourceTable: 'customer',
    normalTable: 'customer_field',
    blobTable: 'customer_field_blob',
  },
  customerContact: {
    formKey: 'contact',
    resourceTable: 'customer_contact',
    normalTable: 'customer_contact_field',
    blobTable: 'customer_contact_field_blob',
  },
  opportunity: {
    formKey: 'opportunity',
    resourceTable: 'opportunity',
    normalTable: 'opportunity_field',
    blobTable: 'opportunity_field_blob',
  },
  product: {
    formKey: 'product',
    resourceTable: 'product',
    normalTable: 'product_field',
    blobTable: 'product_field_blob',
  },
  productPrice: {
    formKey: 'price',
    resourceTable: 'product_price',
    normalTable: 'product_price_field',
    blobTable: 'product_price_field_blob',
  },
  quotation: {
    formKey: 'quote',
    resourceTable: 'opportunity_quotation',
    normalTable: 'opportunity_quotation_field',
    blobTable: 'opportunity_quotation_field_blob',
  },
  contract: {
    formKey: 'contract',
    resourceTable: 'contract',
    normalTable: 'contract_field',
    blobTable: 'contract_field_blob',
  },
  contractPaymentPlan: {
    formKey: 'contractPaymentPlan',
    resourceTable: 'contract_payment_plan',
    normalTable: 'contract_payment_plan_field',
    blobTable: 'contract_payment_plan_field_blob',
  },
  contractPaymentRecord: {
    formKey: 'contractPaymentRecord',
    resourceTable: 'contract_payment_record',
    normalTable: 'contract_payment_record_field',
    blobTable: 'contract_payment_record_field_blob',
  },
  invoice: {
    formKey: 'invoice',
    resourceTable: 'contract_invoice',
    normalTable: 'contract_invoice_field',
    blobTable: 'contract_invoice_field_blob',
  },
  order: {
    formKey: 'order',
    resourceTable: 'sales_order',
    normalTable: 'sales_order_field',
    blobTable: 'sales_order_field_blob',
  },
}

@Injectable()
export class ResourceFieldValueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moduleForms: ModuleFormsService,
  ) {}

  async validate(
    organizationId: string,
    resourceType: ResourceFieldType,
    values: Record<string, unknown>,
    options: { mode: ResourceFieldSaveMode; resourceId?: string },
  ): Promise<Record<string, unknown>> {
    const fields = await this.moduleForms.listFields(
      organizationId,
      RESOURCE_CONFIG[resourceType].formKey,
    )
    const validated = await this.validateWithFields(
      this.prisma,
      organizationId,
      resourceType,
      fields,
      values,
      options,
    )
    return Object.fromEntries(
      validated
        .filter((item) => item.serialized !== null)
        .map((item) => [item.field.key, item.value]),
    )
  }

  async save(
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceId: string,
    values: Record<string, unknown>,
    mode: ResourceFieldSaveMode,
    tx: Prisma.TransactionClient,
  ): Promise<Record<string, unknown>> {
    await this.assertResource(tx, organizationId, resourceType, resourceId)
    const fields = await this.moduleForms.listFieldsInTransaction(
      tx,
      organizationId,
      RESOURCE_CONFIG[resourceType].formKey,
    )
    const validated = await this.validateWithFields(
      tx,
      organizationId,
      resourceType,
      fields,
      values,
      { mode, resourceId },
    )

    for (const item of validated.filter(
      (value) => value.field.config?.unique && value.serialized !== null,
    )) {
      const lockKey = `${organizationId}:${resourceType}:${item.field.id}:${item.serialized}`
      await tx.$queryRaw(
        Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      )
      await this.assertUnique(tx, organizationId, resourceType, item, resourceId)
    }

    const fieldIds = validated.map((item) => item.field.id)
    if (fieldIds.length) await this.deleteValues(tx, resourceType, resourceId, fieldIds)
    const normal = validated.filter((item) => item.serialized !== null && item.storage === 'normal')
    const blob = validated.filter((item) => item.serialized !== null && item.storage === 'blob')
    await this.createValues(tx, resourceType, resourceId, normal, blob)
    return Object.fromEntries(
      validated
        .filter((item) => item.serialized !== null)
        .map((item) => [item.field.key, item.value]),
    )
  }

  async load(
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceIds: string[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const uniqueIds = [...new Set(resourceIds)]
    const result = new Map(uniqueIds.map((id) => [id, {} as Record<string, unknown>]))
    if (!uniqueIds.length) return result
    const fields = await this.moduleForms.listFields(
      organizationId,
      RESOURCE_CONFIG[resourceType].formKey,
    )
    const fieldMap = new Map(
      fields.filter((field) => !field.system).map((field) => [field.id, field]),
    )
    const [normal, blob] = await this.findValues(
      this.prisma,
      organizationId,
      resourceType,
      uniqueIds,
    )
    for (const row of [...normal, ...blob]) {
      const field = fieldMap.get(row.fieldId)
      const values = result.get(row.resourceId)
      if (!field || !values) continue
      values[field.key] = this.deserialize(field.type, row.fieldValue)
    }
    return result
  }

  async saveBatch(
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceIds: string[],
    fieldIdOrKey: string,
    value: unknown,
    tx: Prisma.TransactionClient,
  ): Promise<{ count: number }> {
    const uniqueIds = [...new Set(resourceIds)]
    if (!uniqueIds.length) return { count: 0 }
    for (const resourceId of uniqueIds) {
      await this.assertResource(tx, organizationId, resourceType, resourceId)
    }
    const fields = await this.moduleForms.listFieldsInTransaction(
      tx,
      organizationId,
      RESOURCE_CONFIG[resourceType].formKey,
    )
    const field = fields.find(
      (candidate) => candidate.id === fieldIdOrKey || candidate.key === fieldIdOrKey,
    )
    if (!field || field.system || field.type === 'formula' || field.hidden) {
      throw new BadRequestException('字段不存在或不支持批量修改')
    }
    if (field.config?.unique && uniqueIds.length > 1 && !this.isEmpty(value)) {
      throw new BadRequestException('唯一字段不能批量设置为相同值')
    }

    for (const resourceId of uniqueIds) {
      const validated = await this.validateWithFields(
        tx,
        organizationId,
        resourceType,
        fields,
        { [field.key]: value },
        { mode: 'update', resourceId },
      )
      const item = validated[0]
      if (!item) continue
      if (field.config?.unique && item.serialized !== null) {
        const lockKey = `${organizationId}:${resourceType}:${field.id}:${item.serialized}`
        await tx.$queryRaw(
          Prisma.sql`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
        )
        await this.assertUnique(tx, organizationId, resourceType, item, resourceId)
      }
      await this.deleteValues(tx, resourceType, resourceId, [field.id])
      await this.createValues(
        tx,
        resourceType,
        resourceId,
        item.serialized !== null && item.storage === 'normal' ? [item] : [],
        item.serialized !== null && item.storage === 'blob' ? [item] : [],
      )
    }
    return { count: uniqueIds.length }
  }

  /**
   * 编译为参数化 SQL：调用方可直接执行，也可把结果 ID 合并进自己的 Prisma where。
   * 表名来自固定资源白名单，字段和值始终参数化。
   */
  async buildFilter(
    organizationId: string,
    resourceType: ResourceFieldType,
    conditions: FilterCondition[],
  ): Promise<Prisma.Sql> {
    const config = RESOURCE_CONFIG[resourceType]
    const fields = await this.moduleForms.listFields(organizationId, config.formKey)
    const fieldMap = new Map(
      fields
        .filter((field) => !field.system)
        .flatMap((field) => [
          [field.id, field],
          [field.key, field],
        ]),
    )
    const predicates: Prisma.Sql[] = []
    for (const condition of conditions) {
      const field = fieldMap.get(condition.key)
      if (!field) throw new BadRequestException(`筛选字段不存在：${condition.key}`)
      if (!filterOpsForType(field.type).includes(condition.op)) {
        throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      }
      predicates.push(this.compilePredicate(config, field, condition))
    }
    const combined = predicates.length ? Prisma.join(predicates, ' AND ') : Prisma.sql`TRUE`
    return Prisma.sql`SELECT resource.id FROM ${Prisma.raw(config.resourceTable)} AS resource WHERE resource.organization_id = ${organizationId} AND ${combined}`
  }

  async filterResourceIds(
    organizationId: string,
    resourceType: ResourceFieldType,
    conditions: FilterCondition[],
  ): Promise<string[]> {
    const query = await this.buildFilter(organizationId, resourceType, conditions)
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(query)
    return rows.map((row) => row.id)
  }

  private async validateWithFields(
    client: PrismaService | Prisma.TransactionClient,
    organizationId: string,
    resourceType: ResourceFieldType,
    fields: FieldVO[],
    values: Record<string, unknown>,
    options: { mode: ResourceFieldSaveMode; resourceId?: string },
  ): Promise<ValidatedFieldValue[]> {
    const customFields = fields.filter((field) => !field.system && field.type !== 'formula')
    const fieldMap = new Map(
      customFields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const supplied = new Map<FieldVO, unknown>()
    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap.get(key)
      if (field) {
        supplied.set(field, value)
        continue
      }
      if (
        fields.some(
          (candidate) => candidate.system && (candidate.id === key || candidate.key === key),
        )
      )
        continue
      throw new BadRequestException(`字段不存在或不可写：${key}`)
    }

    if (options.mode === 'create') {
      for (const field of customFields) {
        if (field.required && !field.hidden && this.isEmpty(supplied.get(field))) {
          throw new BadRequestException(`「${field.label}」为必填项`)
        }
      }
    }

    const result: ValidatedFieldValue[] = []
    for (const [field, value] of supplied) {
      const serialized = this.serialize(field, value)
      const item: ValidatedFieldValue = {
        field,
        value,
        serialized,
        storage: this.storageFor(field.type, serialized),
      }
      if (field.required && this.isEmpty(value))
        throw new BadRequestException(`「${field.label}」为必填项`)
      if (field.config?.unique && serialized !== null) {
        await this.assertUnique(client, organizationId, resourceType, item, options.resourceId)
      }
      result.push(item)
    }
    return result
  }

  private serialize(field: FieldVO, value: unknown): string | null {
    if (this.isEmpty(value)) return null
    switch (field.type) {
      case 'number':
      case 'currency':
      case 'percent': {
        const parsed = typeof value === 'number' ? value : Number(value)
        if (!Number.isFinite(parsed))
          throw new BadRequestException(`「${field.label}」必须是有效数字`)
        if (field.config?.min !== undefined && parsed < field.config.min)
          throw new BadRequestException(`「${field.label}」不能小于 ${field.config.min}`)
        if (field.config?.max !== undefined && parsed > field.config.max)
          throw new BadRequestException(`「${field.label}」不能大于 ${field.config.max}`)
        return String(parsed)
      }
      case 'switch':
        if (typeof value !== 'boolean')
          throw new BadRequestException(`「${field.label}」必须是布尔值`)
        return String(value)
      case 'multiselect':
      case 'checkbox':
      case 'picture': {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          throw new BadRequestException(`「${field.label}」必须是字符串数组`)
        }
        if (field.type !== 'picture') this.assertOptions(field, value)
        return JSON.stringify(value)
      }
      case 'select':
      case 'radio':
        if (typeof value !== 'string')
          throw new BadRequestException(`「${field.label}」字段值格式不正确`)
        this.assertOptions(field, [value])
        return value
      case 'date':
      case 'datetime': {
        const date = value instanceof Date ? value : new Date(String(value))
        if (Number.isNaN(date.getTime()))
          throw new BadRequestException(`「${field.label}」日期格式不正确`)
        return date.toISOString()
      }
      case 'email':
        if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          throw new BadRequestException(`「${field.label}」邮箱格式不正确`)
        }
        return value.trim()
      case 'phone':
        if (typeof value !== 'string' || !/^[+\d][\d\s-]{4,29}$/.test(value.trim())) {
          throw new BadRequestException(`「${field.label}」电话格式不正确`)
        }
        return value.replace(/\s+/g, '')
      default:
        if (typeof value !== 'string')
          throw new BadRequestException(`「${field.label}」字段值格式不正确`)
        return value
    }
  }

  private deserialize(type: FieldType, value: string): unknown {
    if (['multiselect', 'checkbox', 'picture'].includes(type)) {
      try {
        const parsed: unknown = JSON.parse(value)
        return Array.isArray(parsed) ? parsed : []
      } catch {
        return []
      }
    }
    if (['number', 'currency', 'percent'].includes(type)) return Number(value)
    if (type === 'switch') return value === 'true'
    return value
  }

  private assertOptions(field: FieldVO, values: string[]): void {
    if (!field.options?.length) return
    const allowed = new Set(field.options.map((option) => option.value))
    if (values.some((value) => !allowed.has(value))) {
      throw new BadRequestException(`「${field.label}」包含无效选项`)
    }
  }

  private storageFor(type: FieldType, serialized: string | null): 'normal' | 'blob' {
    if (['textarea', 'multiselect', 'checkbox', 'picture'].includes(type)) return 'blob'
    return serialized !== null && serialized.length > 255 ? 'blob' : 'normal'
  }

  private async assertResource(
    tx: Prisma.TransactionClient,
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceId: string,
  ): Promise<void> {
    let resource: { id: string } | null
    if (resourceType === 'clue')
      resource = await tx.clue.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'customer')
      resource = await tx.customer.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'customerContact')
      resource = await tx.customerContact.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'opportunity')
      resource = await tx.opportunity.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'product')
      resource = await tx.product.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'productPrice')
      resource = await tx.productPrice.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'quotation')
      resource = await tx.opportunityQuotation.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'contract')
      resource = await tx.contract.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'contractPaymentPlan')
      resource = await tx.contractPaymentPlan.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'contractPaymentRecord')
      resource = await tx.contractPaymentRecord.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else if (resourceType === 'invoice')
      resource = await tx.contractInvoice.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    else
      resource = await tx.order.findFirst({
        where: { id: resourceId, organizationId },
        select: { id: true },
      })
    if (!resource) throw new NotFoundException('业务数据不存在')
  }

  private async assertUnique(
    client: PrismaService | Prisma.TransactionClient,
    organizationId: string,
    resourceType: ResourceFieldType,
    item: ValidatedFieldValue,
    excludeResourceId?: string,
  ): Promise<void> {
    if (item.serialized === null) return
    const where = {
      fieldId: item.field.id,
      fieldValue: item.serialized,
      resourceId: excludeResourceId ? { not: excludeResourceId } : undefined,
      resource: { organizationId },
    }
    let repeated: { id: string } | null
    if (resourceType === 'clue')
      repeated =
        item.storage === 'blob'
          ? await client.clueFieldBlob.findFirst({ where, select: { id: true } })
          : await client.clueField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'customer')
      repeated =
        item.storage === 'blob'
          ? await client.customerFieldBlob.findFirst({ where, select: { id: true } })
          : await client.customerField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'customerContact')
      repeated =
        item.storage === 'blob'
          ? await client.customerContactFieldBlob.findFirst({ where, select: { id: true } })
          : await client.customerContactField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'opportunity')
      repeated =
        item.storage === 'blob'
          ? await client.opportunityFieldBlob.findFirst({ where, select: { id: true } })
          : await client.opportunityField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'product')
      repeated =
        item.storage === 'blob'
          ? await client.productFieldBlob.findFirst({ where, select: { id: true } })
          : await client.productField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'productPrice')
      repeated =
        item.storage === 'blob'
          ? await client.productPriceFieldBlob.findFirst({ where, select: { id: true } })
          : await client.productPriceField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'quotation')
      repeated =
        item.storage === 'blob'
          ? await client.opportunityQuotationFieldBlob.findFirst({ where, select: { id: true } })
          : await client.opportunityQuotationField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'contract')
      repeated =
        item.storage === 'blob'
          ? await client.contractFieldBlob.findFirst({ where, select: { id: true } })
          : await client.contractField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'contractPaymentPlan')
      repeated =
        item.storage === 'blob'
          ? await client.contractPaymentPlanFieldBlob.findFirst({ where, select: { id: true } })
          : await client.contractPaymentPlanField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'contractPaymentRecord')
      repeated =
        item.storage === 'blob'
          ? await client.contractPaymentRecordFieldBlob.findFirst({ where, select: { id: true } })
          : await client.contractPaymentRecordField.findFirst({ where, select: { id: true } })
    else if (resourceType === 'invoice')
      repeated =
        item.storage === 'blob'
          ? await client.contractInvoiceFieldBlob.findFirst({ where, select: { id: true } })
          : await client.contractInvoiceField.findFirst({ where, select: { id: true } })
    else
      repeated =
        item.storage === 'blob'
          ? await client.orderFieldBlob.findFirst({ where, select: { id: true } })
          : await client.orderField.findFirst({ where, select: { id: true } })
    if (repeated) throw new ConflictException(`「${item.field.label}」的值不能重复`)
  }

  private async deleteValues(
    tx: Prisma.TransactionClient,
    resourceType: ResourceFieldType,
    resourceId: string,
    fieldIds: string[],
  ): Promise<void> {
    const where = { resourceId, fieldId: { in: fieldIds } }
    if (resourceType === 'clue')
      await Promise.all([
        tx.clueField.deleteMany({ where }),
        tx.clueFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'customer')
      await Promise.all([
        tx.customerField.deleteMany({ where }),
        tx.customerFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'customerContact')
      await Promise.all([
        tx.customerContactField.deleteMany({ where }),
        tx.customerContactFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'opportunity')
      await Promise.all([
        tx.opportunityField.deleteMany({ where }),
        tx.opportunityFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'product')
      await Promise.all([
        tx.productField.deleteMany({ where }),
        tx.productFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'productPrice')
      await Promise.all([
        tx.productPriceField.deleteMany({ where }),
        tx.productPriceFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'quotation')
      await Promise.all([
        tx.opportunityQuotationField.deleteMany({ where }),
        tx.opportunityQuotationFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'contract')
      await Promise.all([
        tx.contractField.deleteMany({ where }),
        tx.contractFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'contractPaymentPlan')
      await Promise.all([
        tx.contractPaymentPlanField.deleteMany({ where }),
        tx.contractPaymentPlanFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'contractPaymentRecord')
      await Promise.all([
        tx.contractPaymentRecordField.deleteMany({ where }),
        tx.contractPaymentRecordFieldBlob.deleteMany({ where }),
      ])
    else if (resourceType === 'invoice')
      await Promise.all([
        tx.contractInvoiceField.deleteMany({ where }),
        tx.contractInvoiceFieldBlob.deleteMany({ where }),
      ])
    else
      await Promise.all([
        tx.orderField.deleteMany({ where }),
        tx.orderFieldBlob.deleteMany({ where }),
      ])
  }

  private async createValues(
    tx: Prisma.TransactionClient,
    resourceType: ResourceFieldType,
    resourceId: string,
    normal: ValidatedFieldValue[],
    blob: ValidatedFieldValue[],
  ): Promise<void> {
    const normalData = normal.map((item) => ({
      resourceId,
      fieldId: item.field.id,
      fieldValue: item.serialized!,
    }))
    const blobData = blob.map((item) => ({
      resourceId,
      fieldId: item.field.id,
      fieldValue: item.serialized!,
    }))
    if (resourceType === 'clue') {
      if (normalData.length) await tx.clueField.createMany({ data: normalData })
      if (blobData.length) await tx.clueFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'customer') {
      if (normalData.length) await tx.customerField.createMany({ data: normalData })
      if (blobData.length) await tx.customerFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'customerContact') {
      if (normalData.length) await tx.customerContactField.createMany({ data: normalData })
      if (blobData.length) await tx.customerContactFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'opportunity') {
      if (normalData.length) await tx.opportunityField.createMany({ data: normalData })
      if (blobData.length) await tx.opportunityFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'product') {
      if (normalData.length) await tx.productField.createMany({ data: normalData })
      if (blobData.length) await tx.productFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'productPrice') {
      if (normalData.length) await tx.productPriceField.createMany({ data: normalData })
      if (blobData.length) await tx.productPriceFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'quotation') {
      if (normalData.length) await tx.opportunityQuotationField.createMany({ data: normalData })
      if (blobData.length) await tx.opportunityQuotationFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'contract') {
      if (normalData.length) await tx.contractField.createMany({ data: normalData })
      if (blobData.length) await tx.contractFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'contractPaymentPlan') {
      if (normalData.length) await tx.contractPaymentPlanField.createMany({ data: normalData })
      if (blobData.length) await tx.contractPaymentPlanFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'contractPaymentRecord') {
      if (normalData.length) await tx.contractPaymentRecordField.createMany({ data: normalData })
      if (blobData.length) await tx.contractPaymentRecordFieldBlob.createMany({ data: blobData })
    } else if (resourceType === 'invoice') {
      if (normalData.length) await tx.contractInvoiceField.createMany({ data: normalData })
      if (blobData.length) await tx.contractInvoiceFieldBlob.createMany({ data: blobData })
    } else {
      if (normalData.length) await tx.orderField.createMany({ data: normalData })
      if (blobData.length) await tx.orderFieldBlob.createMany({ data: blobData })
    }
  }

  private async findValues(
    client: PrismaService,
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceIds: string[],
  ): Promise<
    [
      Array<{ resourceId: string; fieldId: string; fieldValue: string }>,
      Array<{ resourceId: string; fieldId: string; fieldValue: string }>,
    ]
  > {
    const where = { resourceId: { in: resourceIds }, resource: { organizationId } }
    const select = { resourceId: true, fieldId: true, fieldValue: true }
    if (resourceType === 'clue')
      return Promise.all([
        client.clueField.findMany({ where, select }),
        client.clueFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'customer')
      return Promise.all([
        client.customerField.findMany({ where, select }),
        client.customerFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'customerContact')
      return Promise.all([
        client.customerContactField.findMany({ where, select }),
        client.customerContactFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'opportunity')
      return Promise.all([
        client.opportunityField.findMany({ where, select }),
        client.opportunityFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'product')
      return Promise.all([
        client.productField.findMany({ where, select }),
        client.productFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'productPrice')
      return Promise.all([
        client.productPriceField.findMany({ where, select }),
        client.productPriceFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'quotation')
      return Promise.all([
        client.opportunityQuotationField.findMany({ where, select }),
        client.opportunityQuotationFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'contract')
      return Promise.all([
        client.contractField.findMany({ where, select }),
        client.contractFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'contractPaymentPlan')
      return Promise.all([
        client.contractPaymentPlanField.findMany({ where, select }),
        client.contractPaymentPlanFieldBlob.findMany({ where, select }),
      ])
    if (resourceType === 'contractPaymentRecord') return Promise.all([
      client.contractPaymentRecordField.findMany({ where, select }),
      client.contractPaymentRecordFieldBlob.findMany({ where, select }),
    ])
    if (resourceType === 'invoice')
      return Promise.all([
        client.contractInvoiceField.findMany({ where, select }),
        client.contractInvoiceFieldBlob.findMany({ where, select }),
      ])
    return Promise.all([
      client.orderField.findMany({ where, select }),
      client.orderFieldBlob.findMany({ where, select }),
    ])
  }

  private compilePredicate(
    config: ResourceConfig,
    field: FieldVO,
    condition: FilterCondition,
  ): Prisma.Sql {
    const normalTable = Prisma.raw(config.normalTable)
    const blobTable = Prisma.raw(config.blobTable)
    const exists = (table: Prisma.Sql, predicate: Prisma.Sql = Prisma.sql`TRUE`) =>
      Prisma.sql`EXISTS (SELECT 1 FROM ${table} AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${field.id} AND ${predicate})`
    const absent = Prisma.sql`NOT (${exists(normalTable)}) AND NOT (${exists(blobTable)})`
    if (condition.op === 'isEmpty') return absent
    if (condition.op === 'notEmpty')
      return Prisma.sql`(${exists(normalTable)}) OR (${exists(blobTable)})`

    if (condition.op === 'contains' && ['multiselect', 'checkbox'].includes(field.type)) {
      if (typeof condition.value !== 'string')
        throw new BadRequestException('多选字段筛选值格式不正确')
      this.assertOptions(field, [condition.value])
      const match = Prisma.sql`field_value.field_value::jsonb @> ${JSON.stringify([condition.value])}::jsonb`
      return exists(blobTable, match)
    }

    const serialized =
      condition.op === 'contains'
        ? this.serializeContainsValue(field, condition.value)
        : this.serialize(field, condition.value)
    if (serialized === null) throw new BadRequestException('筛选值不能为空')
    const storage = this.storageFor(field.type, serialized)
    const table = storage === 'blob' ? blobTable : normalTable
    let match: Prisma.Sql
    if (condition.op === 'contains') {
      match = Prisma.sql`field_value.field_value LIKE ${`%${serialized}%`}`
    } else if (['gt', 'gte', 'lt', 'lte'].includes(condition.op)) {
      const operator = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[
        condition.op as 'gt' | 'gte' | 'lt' | 'lte'
      ]
      match = Prisma.sql`field_value.field_value::numeric ${Prisma.raw(operator)} ${Number(serialized)}`
    } else {
      match = Prisma.sql`field_value.field_value = ${serialized}`
    }
    const matched = exists(table, match)
    return condition.op === 'ne' ? Prisma.sql`NOT (${matched})` : matched
  }

  private serializeContainsValue(field: FieldVO, value: unknown): string | null {
    if (this.isEmpty(value)) return null
    if (typeof value !== 'string') {
      throw new BadRequestException(`「${field.label}」筛选值格式不正确`)
    }
    // “包含”是子串搜索，不应套用录入时的完整邮箱/电话格式校验。
    // 例如客户关键字会同时搜索名称、联系电话和邮箱，普通名称关键字必须能安全落到这些字段上。
    return field.type === 'phone' ? value.replace(/\s+/g, '') : value
  }

  private isEmpty(value: unknown): boolean {
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    )
  }
}
