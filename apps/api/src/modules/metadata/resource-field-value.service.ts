import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  filterOpsForType,
  type AttachmentVO,
  type FieldType,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import type { PrismaClient } from '../../prisma/prisma-client.js'
import { instantToISOString } from '../../prisma/temporal.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ModuleFormsService } from './module-forms.service'

type PrismaRawExpression = ReturnType<ReturnType<PrismaService['client']['raw']['sql']>['returns']>
type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
type PrismaDatabase = { orm: PrismaService['client']['orm'] }

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
  | 'followRecord'
  | 'followPlan'
export type ResourceFieldSaveMode = 'create' | 'update'

export const RESOURCE_FIELD_TYPES: ResourceFieldType[] = [
  'clue',
  'customer',
  'customerContact',
  'opportunity',
  'product',
  'productPrice',
  'quotation',
  'contract',
  'contractPaymentPlan',
  'contractPaymentRecord',
  'invoice',
  'order',
  'followRecord',
  'followPlan',
]

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
    | 'followRecord'
    | 'followPlan'
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
    | 'follow_up_records'
    | 'follow_up_plans'
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
    | 'follow_up_record_field'
    | 'follow_up_plan_field'
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
    | 'follow_up_record_field_blob'
    | 'follow_up_plan_field_blob'
  organizationColumn?: 'organization_id' | '"tenantId"'
}

interface ValidatedFieldValue {
  field: FieldVO
  value: unknown
  serialized: string | null
  storage: 'normal' | 'blob'
}

const RESOURCE_FIELD_FILE_TYPES = new Set<FieldType>(['attachment', 'picture'])
export const RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX = 'resourceField:'

export function resourceFieldAttachmentTarget(resourceType: ResourceFieldType): string {
  return `${RESOURCE_FIELD_ATTACHMENT_TARGET_PREFIX}${resourceType}`
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
  followPlan: {
    formKey: 'followPlan',
    resourceTable: 'follow_up_plans',
    normalTable: 'follow_up_plan_field',
    blobTable: 'follow_up_plan_field_blob',
    organizationColumn: '"tenantId"',
  },
  followRecord: {
    formKey: 'followRecord',
    resourceTable: 'follow_up_records',
    normalTable: 'follow_up_record_field',
    blobTable: 'follow_up_record_field_blob',
    organizationColumn: '"tenantId"',
  },
}

@Injectable()
export class ResourceFieldValueService {
  constructor(
    private readonly moduleForms: ModuleFormsService,
    private readonly prisma: PrismaService,
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
      this.prisma.client,
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
    tx: PrismaTransaction,
    actorId: string,
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

    await this.claimResourceFieldAttachments(
      tx,
      organizationId,
      resourceType,
      resourceId,
      fields,
      validated,
      actorId,
    )

    for (const item of validated.filter(
      (value) => value.field.config?.unique && value.serialized !== null,
    )) {
      const lockKey = `${organizationId}:${resourceType}:${item.field.id}:${item.serialized}`
      await this.acquireUniqueLock(tx, lockKey)
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
      this.prisma.client,
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

  async isAttachmentReferenced(
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceId: string,
    attachmentId: string,
  ): Promise<boolean> {
    const fields = await this.moduleForms.listFields(
      organizationId,
      RESOURCE_CONFIG[resourceType].formKey,
    )
    const fileFieldIds = new Set(
      fields.filter((field) => RESOURCE_FIELD_FILE_TYPES.has(field.type)).map((field) => field.id),
    )
    if (!fileFieldIds.size) return false
    const [normal, blob] = await this.findValues(this.prisma.client, organizationId, resourceType, [
      resourceId,
    ])
    return [...normal, ...blob].some(
      (row) =>
        fileFieldIds.has(row.fieldId) && this.decodeFileIds(row.fieldValue).includes(attachmentId),
    )
  }

  async buildAttachmentMap(
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceId: string,
  ): Promise<Record<string, AttachmentVO[]>> {
    const fields = await this.moduleForms.listFields(
      organizationId,
      RESOURCE_CONFIG[resourceType].formKey,
    )
    const fileFields = fields.filter((field) => RESOURCE_FIELD_FILE_TYPES.has(field.type))
    const result: Record<string, AttachmentVO[]> = Object.fromEntries(
      fileFields.map((field) => [field.key, []]),
    )
    if (!fileFields.length) return result
    const values =
      (await this.load(organizationId, resourceType, [resourceId])).get(resourceId) ?? {}
    const ids = fileFields.flatMap((field) => this.fileIds(values[field.key]))
    if (!ids.length) return result
    const rows = await this.prisma.client.orm.public.Attachments.where({
      tenantId: organizationId,
      targetType: resourceFieldAttachmentTarget(resourceType),
      targetId: resourceId,
    })
      .where((row) => row.id.in([...new Set(ids)]))
      .orderBy((row) => row.createdAt.asc())
      .all()
    const byId = new Map(rows.map((row) => [row.id, row]))
    for (const field of fileFields) {
      result[field.key] = this.fileIds(values[field.key]).flatMap((id) => {
        const row = byId.get(id)
        return row ? [this.toAttachmentVO(row)] : []
      })
    }
    return result
  }

  async saveBatch(
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceIds: string[],
    fieldIdOrKey: string,
    value: unknown,
    tx: PrismaTransaction,
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
        await this.acquireUniqueLock(tx, lockKey)
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
  ) {
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
    const predicates: PrismaRawExpression[] = []
    for (const condition of conditions) {
      const field = fieldMap.get(condition.key)
      if (!field) throw new BadRequestException(`筛选字段不存在：${condition.key}`)
      if (!filterOpsForType(field.type).includes(condition.op)) {
        throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      }
      predicates.push(this.compilePredicate(resourceType, field, condition))
    }
    const client = this.prisma.client
    let combined = predicates[0] ?? client.raw.sql`TRUE`.returns('pg/bool@1')
    for (const predicate of predicates.slice(1)) {
      combined = client.raw.sql`(${combined}) AND (${predicate})`.returns('pg/bool@1')
    }
    return this.buildResourceFilterQuery(resourceType, organizationId, combined)
  }

  async filterResourceIds(
    organizationId: string,
    resourceType: ResourceFieldType,
    conditions: FilterCondition[],
  ): Promise<string[]> {
    const query = await this.buildFilter(organizationId, resourceType, conditions)
    const rows: Array<{ id: string }> = []
    for await (const row of this.prisma.client.runtime().query(query.build())) rows.push(row)
    return rows.map((row) => row.id)
  }

  private async acquireUniqueLock(tx: PrismaTransaction, lockKey: string): Promise<void> {
    const query = this.prisma.client.raw.sql`
      SELECT 1::int4 AS locked
      FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `.returnsRow({ locked: 'pg/int4@1' })
    for await (const _row of tx.query(query.build())) return
    throw new Error('获取唯一字段事务锁失败')
  }

  private buildResourceFilterQuery(
    resourceType: ResourceFieldType,
    organizationId: string,
    predicate: PrismaRawExpression,
  ) {
    const client = this.prisma.client
    switch (resourceType) {
      case 'clue':
        return client.raw.sql`SELECT resource.id FROM clue AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.clue.columns.id,
        })
      case 'customer':
        return client.raw.sql`SELECT resource.id FROM customer AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.customer.columns.id,
        })
      case 'customerContact':
        return client.raw.sql`SELECT resource.id FROM customer_contact AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.customer_contact.columns.id,
        })
      case 'opportunity':
        return client.raw.sql`SELECT resource.id FROM opportunity AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.opportunity.columns.id,
        })
      case 'product':
        return client.raw.sql`SELECT resource.id FROM product AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.product.columns.id,
        })
      case 'productPrice':
        return client.raw.sql`SELECT resource.id FROM product_price AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.product_price.columns.id,
        })
      case 'quotation':
        return client.raw.sql`SELECT resource.id FROM opportunity_quotation AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.opportunity_quotation.columns.id,
        })
      case 'contract':
        return client.raw.sql`SELECT resource.id FROM contract AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.contract.columns.id,
        })
      case 'contractPaymentPlan':
        return client.raw.sql`SELECT resource.id FROM contract_payment_plan AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.contract_payment_plan.columns.id,
        })
      case 'contractPaymentRecord':
        return client.raw.sql`SELECT resource.id FROM contract_payment_record AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.contract_payment_record.columns.id,
        })
      case 'invoice':
        return client.raw.sql`SELECT resource.id FROM contract_invoice AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.contract_invoice.columns.id,
        })
      case 'order':
        return client.raw.sql`SELECT resource.id FROM sales_order AS resource
          WHERE resource.organization_id = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.sales_order.columns.id,
        })
      case 'followRecord':
        return client.raw.sql`SELECT resource.id FROM follow_up_records AS resource
          WHERE resource."tenantId" = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.follow_up_records.columns.id,
        })
      case 'followPlan':
        return client.raw.sql`SELECT resource.id FROM follow_up_plans AS resource
          WHERE resource."tenantId" = ${organizationId} AND (${predicate})`.returnsRow({
          id: client.sql.public.follow_up_plans.columns.id,
        })
    }
  }

  private resourceFieldExists(
    resourceType: ResourceFieldType,
    fieldId: string,
    blob: boolean,
    predicate?: PrismaRawExpression,
  ): PrismaRawExpression {
    const client = this.prisma.client
    const effectivePredicate = predicate ?? client.raw.sql`TRUE`.returns('pg/bool@1')
    const suffix = client.raw.sql`AND (${effectivePredicate})`.returns('pg/bool@1')
    switch (resourceType) {
      case 'clue':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM clue_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM clue_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM clue_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM clue_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'customer':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM customer_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM customer_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM customer_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM customer_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'customerContact':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM customer_contact_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM customer_contact_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM customer_contact_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM customer_contact_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'opportunity':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'product':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM product_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM product_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM product_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM product_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'productPrice':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM product_price_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM product_price_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM product_price_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM product_price_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'quotation':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_quotation_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_quotation_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_quotation_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM opportunity_quotation_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'contract':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'contractPaymentPlan':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_plan_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_plan_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_plan_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_plan_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'contractPaymentRecord':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_record_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_record_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_record_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_payment_record_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'invoice':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_invoice_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_invoice_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM contract_invoice_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM contract_invoice_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'order':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM sales_order_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM sales_order_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM sales_order_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM sales_order_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'followRecord':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_record_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_record_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_record_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_record_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
      case 'followPlan':
        return blob
          ? predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_plan_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_plan_field_blob AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
          : predicate
            ? client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_plan_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId} ${suffix})`.returns(
                'pg/bool@1',
              )
            : client.raw
                .sql`EXISTS (SELECT 1 FROM follow_up_plan_field AS field_value WHERE field_value.resource_id = resource.id AND field_value.field_id = ${fieldId})`.returns(
                'pg/bool@1',
              )
    }
  }

  private async validateWithFields(
    client: PrismaDatabase,
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
      case 'data_source_multiple':
      case 'picture':
      case 'attachment': {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
          throw new BadRequestException(`「${field.label}」必须是字符串数组`)
        }
        const ids = [...new Set(value.map((item) => item.trim()).filter(Boolean))]
        if (ids.length !== value.length) {
          throw new BadRequestException(`「${field.label}」包含重复或空值`)
        }
        if (field.type === 'attachment' && field.config?.onlyOne && ids.length > 1) {
          throw new BadRequestException(`「${field.label}」仅允许一个附件`)
        }
        if (field.type === 'picture') {
          const limit = Math.max(1, field.config?.uploadLimit ?? 10)
          if (ids.length > limit)
            throw new BadRequestException(`「${field.label}」最多上传 ${limit} 张图片`)
        }
        if (!RESOURCE_FIELD_FILE_TYPES.has(field.type)) this.assertOptions(field, ids)
        return JSON.stringify(ids)
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
    if (
      ['multiselect', 'checkbox', 'data_source_multiple', 'picture', 'attachment'].includes(type)
    ) {
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
    if (
      [
        'textarea',
        'multiselect',
        'checkbox',
        'data_source_multiple',
        'picture',
        'attachment',
      ].includes(type)
    )
      return 'blob'
    return serialized !== null && serialized.length > 255 ? 'blob' : 'normal'
  }

  private attachmentLimitBytes(field: FieldVO): number {
    if (field.type === 'picture')
      return Math.max(1, field.config?.uploadSizeLimit ?? 20) * 1024 * 1024
    const configured = field.config?.limitSize?.trim()
    if (!configured) return 20 * 1024 * 1024
    const match = configured.match(/^(\d+(?:\.\d+)?)(KB|MB)$/i)
    if (!match) return 20 * 1024 * 1024
    return Number(match[1]) * (match[2]?.toUpperCase() === 'KB' ? 1024 : 1024 * 1024)
  }

  private decodeFileIds(value: string): string[] {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        : []
    } catch {
      return []
    }
  }

  private fileIds(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
      : []
  }

  private toAttachmentVO(row: {
    id: string
    name: string
    size: number
    mime: string | null
    targetType: string | null
    targetId: string | null
    uploaderId: string | null
    createdAt: Parameters<typeof instantToISOString>[0]
  }): AttachmentVO {
    return {
      id: row.id,
      name: row.name,
      size: row.size,
      mime: row.mime,
      targetType: row.targetType,
      targetId: row.targetId,
      uploaderId: row.uploaderId,
      createdAt: instantToISOString(row.createdAt),
    }
  }

  private async claimResourceFieldAttachments(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceId: string,
    fields: FieldVO[],
    validated: ValidatedFieldValue[],
    actorId: string,
  ): Promise<void> {
    const fileItems = validated.filter((item) => RESOURCE_FIELD_FILE_TYPES.has(item.field.type))
    if (!fileItems.length) return

    const changedFieldIds = new Set(fileItems.map((item) => item.field.id))
    const fileFieldIds = new Set(
      fields.filter((field) => RESOURCE_FIELD_FILE_TYPES.has(field.type)).map((field) => field.id),
    )
    const [currentNormal, currentBlob] = await this.findValues(tx, organizationId, resourceType, [
      resourceId,
    ])
    const occupiedByUnchangedField = new Set<string>()
    for (const row of [...currentNormal, ...currentBlob]) {
      if (!fileFieldIds.has(row.fieldId) || changedFieldIds.has(row.fieldId)) continue
      for (const id of this.decodeFileIds(row.fieldValue)) occupiedByUnchangedField.add(id)
    }

    const idsByField = new Map<string, string[]>()
    const allIds: string[] = []
    for (const item of fileItems) {
      const ids = Array.isArray(item.value)
        ? item.value.filter(
            (value): value is string => typeof value === 'string' && Boolean(value.trim()),
          )
        : []
      idsByField.set(item.field.id, ids)
      allIds.push(...ids)
    }
    if (new Set(allIds).size !== allIds.length) {
      throw new BadRequestException('同一个文件不能同时绑定到多个图片或附件字段')
    }
    if (allIds.some((id) => occupiedByUnchangedField.has(id))) {
      throw new BadRequestException('文件已绑定到当前资源的其他字段')
    }
    if (!allIds.length) return

    const rows = await tx.orm.public.Attachments.where({ tenantId: organizationId })
      .where((row) => row.id.in(allIds))
      .select('id', 'uploaderId', 'name', 'size', 'mime', 'targetType', 'targetId')
      .all()
    if (rows.length !== allIds.length) throw new BadRequestException('文件包含不存在的记录')
    const rowMap = new Map(rows.map((row) => [row.id, row]))
    const targetType = resourceFieldAttachmentTarget(resourceType)
    const tempIds: string[] = []

    for (const item of fileItems) {
      const accepted = (item.field.config?.accept ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean)
      const limitBytes = this.attachmentLimitBytes(item.field)
      for (const id of idsByField.get(item.field.id) ?? []) {
        const row = rowMap.get(id)
        if (!row) throw new BadRequestException('文件不存在')
        const temporary = row.targetType === null && row.targetId === null
        const current = row.targetType === targetType && row.targetId === resourceId
        if (temporary) {
          if (row.uploaderId !== actorId) {
            throw new BadRequestException(`「${item.field.label}」包含其他成员上传的临时文件`)
          }
          tempIds.push(row.id)
        } else if (!current) {
          throw new BadRequestException(`「${item.field.label}」包含已绑定到其他业务对象的文件`)
        }
        if (item.field.type === 'picture' && !row.mime?.startsWith('image/')) {
          throw new BadRequestException(`「${item.field.label}」仅允许图片文件：${row.name}`)
        }
        if (
          item.field.type === 'attachment' &&
          accepted.length &&
          !accepted.some((extension) => row.name.toLowerCase().endsWith(extension))
        ) {
          throw new BadRequestException(`「${item.field.label}」包含不允许的文件类型：${row.name}`)
        }
        if (row.size > limitBytes) {
          throw new BadRequestException(
            `「${item.field.label}」文件超出单文件大小限制：${row.name}`,
          )
        }
      }
    }

    if (!tempIds.length) return
    const count = await tx.orm.public.Attachments.where({
      tenantId: organizationId,
      uploaderId: actorId,
      targetType: null,
      targetId: null,
    })
      .where((row) => row.id.in(tempIds))
      .updateAndCount({ targetType, targetId: resourceId })
    if (count !== tempIds.length) {
      throw new BadRequestException('文件状态已变化，请刷新后重试')
    }
  }

  private async assertResource(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceId: string,
  ): Promise<void> {
    const ids = await this.ownedResourceIds(tx, organizationId, resourceType, [resourceId])
    if (!ids.length) throw new NotFoundException('业务数据不存在')
  }

  private async ownedResourceIds(
    client: PrismaDatabase,
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceIds: string[],
  ): Promise<string[]> {
    const ids = [...new Set(resourceIds)]
    if (!ids.length) return []
    const selectIds = async (rows: PromiseLike<readonly { id: string }[]>) =>
      (await rows).map((row) => String(row.id))
    switch (resourceType) {
      case 'clue':
        return selectIds(
          client.orm.public.Clue.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'customer':
        return selectIds(
          client.orm.public.Customer.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'customerContact':
        return selectIds(
          client.orm.public.CustomerContact.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'opportunity':
        return selectIds(
          client.orm.public.Opportunity.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'product':
        return selectIds(
          client.orm.public.Product.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'productPrice':
        return selectIds(
          client.orm.public.ProductPrice.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'quotation':
        return selectIds(
          client.orm.public.OpportunityQuotation.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'contract':
        return selectIds(
          client.orm.public.Contract.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'contractPaymentPlan':
        return selectIds(
          client.orm.public.ContractPaymentPlan.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'contractPaymentRecord':
        return selectIds(
          client.orm.public.ContractPaymentRecord.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'invoice':
        return selectIds(
          client.orm.public.ContractInvoice.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'order':
        return selectIds(
          client.orm.public.SalesOrder.where({ organizationId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'followRecord':
        return selectIds(
          client.orm.public.FollowUpRecords.where({ tenantId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
      case 'followPlan':
        return selectIds(
          client.orm.public.FollowUpPlans.where({ tenantId: organizationId })
            .where((row) => row.id.in(ids))
            .select('id')
            .all(),
        )
    }
  }

  private async assertUnique(
    client: PrismaDatabase,
    organizationId: string,
    resourceType: ResourceFieldType,
    item: ValidatedFieldValue,
    excludeResourceId?: string,
  ): Promise<void> {
    if (item.serialized === null) return
    const candidates = await this.matchingFieldResourceIds(
      client,
      resourceType,
      item.field.id,
      item.serialized,
      item.storage,
      excludeResourceId,
    )
    if (!candidates.length) return
    const owned = await this.ownedResourceIds(client, organizationId, resourceType, candidates)
    if (owned.length) throw new ConflictException(`「${item.field.label}」的值不能重复`)
  }

  private async matchingFieldResourceIds(
    client: PrismaDatabase,
    resourceType: ResourceFieldType,
    fieldId: string,
    fieldValue: string,
    storage: 'normal' | 'blob',
    excludeResourceId?: string,
  ): Promise<string[]> {
    const fieldIdValue = fieldId
    const excluded = excludeResourceId ? excludeResourceId : null
    const read = async <T extends { resourceId: string }>(rows: PromiseLike<readonly T[]>) =>
      (await rows).map((row) => String(row.resourceId))
    const normalValue = fieldValue

    switch (resourceType) {
      case 'clue': {
        if (storage === 'blob') {
          let rows = client.orm.public.ClueFieldBlob.where({ fieldId: fieldIdValue, fieldValue })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ClueField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'customer': {
        if (storage === 'blob') {
          let rows = client.orm.public.CustomerFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.CustomerField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'customerContact': {
        if (storage === 'blob') {
          let rows = client.orm.public.CustomerContactFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.CustomerContactField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'opportunity': {
        if (storage === 'blob') {
          let rows = client.orm.public.OpportunityFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.OpportunityField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'product': {
        if (storage === 'blob') {
          let rows = client.orm.public.ProductFieldBlob.where({ fieldId: fieldIdValue, fieldValue })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ProductField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'productPrice': {
        if (storage === 'blob') {
          let rows = client.orm.public.ProductPriceFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ProductPriceField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'quotation': {
        if (storage === 'blob') {
          let rows = client.orm.public.OpportunityQuotationFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.OpportunityQuotationField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'contract': {
        if (storage === 'blob') {
          let rows = client.orm.public.ContractFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ContractField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'contractPaymentPlan': {
        if (storage === 'blob') {
          let rows = client.orm.public.ContractPaymentPlanFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ContractPaymentPlanField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'contractPaymentRecord': {
        if (storage === 'blob') {
          let rows = client.orm.public.ContractPaymentRecordFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ContractPaymentRecordField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'invoice': {
        if (storage === 'blob') {
          let rows = client.orm.public.ContractInvoiceFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.ContractInvoiceField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'order': {
        if (storage === 'blob') {
          let rows = client.orm.public.SalesOrderFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.SalesOrderField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'followRecord': {
        if (storage === 'blob') {
          let rows = client.orm.public.FollowUpRecordFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.FollowUpRecordField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
      case 'followPlan': {
        if (storage === 'blob') {
          let rows = client.orm.public.FollowUpPlanFieldBlob.where({
            fieldId: fieldIdValue,
            fieldValue,
          })
          if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
          return read(rows.select('resourceId').all())
        }
        let rows = client.orm.public.FollowUpPlanField.where({
          fieldId: fieldIdValue,
          fieldValue: normalValue,
        })
        if (excluded) rows = rows.where((row) => row.resourceId.neq(excluded))
        return read(rows.select('resourceId').all())
      }
    }
  }

  private async deleteValues(
    tx: PrismaTransaction,
    resourceType: ResourceFieldType,
    resourceId: string,
    fieldIds: string[],
  ): Promise<void> {
    const resource = resourceId
    const fields = fieldIds
    if (!fields.length) return
    switch (resourceType) {
      case 'clue':
        await Promise.all([
          tx.orm.public.ClueField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ClueFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'customer':
        await Promise.all([
          tx.orm.public.CustomerField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.CustomerFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'customerContact':
        await Promise.all([
          tx.orm.public.CustomerContactField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.CustomerContactFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'opportunity':
        await Promise.all([
          tx.orm.public.OpportunityField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.OpportunityFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'product':
        await Promise.all([
          tx.orm.public.ProductField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ProductFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'productPrice':
        await Promise.all([
          tx.orm.public.ProductPriceField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ProductPriceFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'quotation':
        await Promise.all([
          tx.orm.public.OpportunityQuotationField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.OpportunityQuotationFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'contract':
        await Promise.all([
          tx.orm.public.ContractField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ContractFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'contractPaymentPlan':
        await Promise.all([
          tx.orm.public.ContractPaymentPlanField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ContractPaymentPlanFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'contractPaymentRecord':
        await Promise.all([
          tx.orm.public.ContractPaymentRecordField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ContractPaymentRecordFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'invoice':
        await Promise.all([
          tx.orm.public.ContractInvoiceField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.ContractInvoiceFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'order':
        await Promise.all([
          tx.orm.public.SalesOrderField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.SalesOrderFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'followRecord':
        await Promise.all([
          tx.orm.public.FollowUpRecordField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.FollowUpRecordFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
      case 'followPlan':
        await Promise.all([
          tx.orm.public.FollowUpPlanField.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
          tx.orm.public.FollowUpPlanFieldBlob.where({ resourceId: resource })
            .where((row) => row.fieldId.in(fields))
            .deleteAll(),
        ])
        return
    }
  }

  private async createValues(
    tx: PrismaTransaction,
    resourceType: ResourceFieldType,
    resourceId: string,
    normal: ValidatedFieldValue[],
    blob: ValidatedFieldValue[],
  ): Promise<void> {
    const normalData = normal.map((item) => ({
      id: createLegacyId32(),
      resourceId: resourceId,
      fieldId: item.field.id,
      fieldValue: item.serialized!,
    }))
    const blobData = blob.map((item) => ({
      id: createLegacyId32(),
      resourceId: resourceId,
      fieldId: item.field.id,
      fieldValue: item.serialized!,
    }))
    switch (resourceType) {
      case 'clue':
        if (normalData.length) await tx.orm.public.ClueField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ClueFieldBlob.createAll(blobData)
        return
      case 'customer':
        if (normalData.length) await tx.orm.public.CustomerField.createAll(normalData)
        if (blobData.length) await tx.orm.public.CustomerFieldBlob.createAll(blobData)
        return
      case 'customerContact':
        if (normalData.length) await tx.orm.public.CustomerContactField.createAll(normalData)
        if (blobData.length) await tx.orm.public.CustomerContactFieldBlob.createAll(blobData)
        return
      case 'opportunity':
        if (normalData.length) await tx.orm.public.OpportunityField.createAll(normalData)
        if (blobData.length) await tx.orm.public.OpportunityFieldBlob.createAll(blobData)
        return
      case 'product':
        if (normalData.length) await tx.orm.public.ProductField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ProductFieldBlob.createAll(blobData)
        return
      case 'productPrice':
        if (normalData.length) await tx.orm.public.ProductPriceField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ProductPriceFieldBlob.createAll(blobData)
        return
      case 'quotation':
        if (normalData.length) await tx.orm.public.OpportunityQuotationField.createAll(normalData)
        if (blobData.length) await tx.orm.public.OpportunityQuotationFieldBlob.createAll(blobData)
        return
      case 'contract':
        if (normalData.length) await tx.orm.public.ContractField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ContractFieldBlob.createAll(blobData)
        return
      case 'contractPaymentPlan':
        if (normalData.length) await tx.orm.public.ContractPaymentPlanField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ContractPaymentPlanFieldBlob.createAll(blobData)
        return
      case 'contractPaymentRecord':
        if (normalData.length) await tx.orm.public.ContractPaymentRecordField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ContractPaymentRecordFieldBlob.createAll(blobData)
        return
      case 'invoice':
        if (normalData.length) await tx.orm.public.ContractInvoiceField.createAll(normalData)
        if (blobData.length) await tx.orm.public.ContractInvoiceFieldBlob.createAll(blobData)
        return
      case 'order':
        if (normalData.length) await tx.orm.public.SalesOrderField.createAll(normalData)
        if (blobData.length) await tx.orm.public.SalesOrderFieldBlob.createAll(blobData)
        return
      case 'followRecord':
        if (normalData.length) await tx.orm.public.FollowUpRecordField.createAll(normalData)
        if (blobData.length) await tx.orm.public.FollowUpRecordFieldBlob.createAll(blobData)
        return
      case 'followPlan':
        if (normalData.length) await tx.orm.public.FollowUpPlanField.createAll(normalData)
        if (blobData.length) await tx.orm.public.FollowUpPlanFieldBlob.createAll(blobData)
        return
    }
  }

  private async findValues(
    client: PrismaDatabase,
    organizationId: string,
    resourceType: ResourceFieldType,
    resourceIds: string[],
  ): Promise<
    [
      Array<{ resourceId: string; fieldId: string; fieldValue: string }>,
      Array<{ resourceId: string; fieldId: string; fieldValue: string }>,
    ]
  > {
    const owned = await this.ownedResourceIds(client, organizationId, resourceType, resourceIds)
    const ids = owned
    if (!ids.length) return [[], []]
    const selectRows = async <
      T extends { resourceId: string; fieldId: string; fieldValue: string },
    >(
      rows: PromiseLike<readonly T[]>,
    ) =>
      (await rows).map((row) => ({
        resourceId: String(row.resourceId),
        fieldId: String(row.fieldId),
        fieldValue: row.fieldValue,
      }))
    switch (resourceType) {
      case 'clue':
        return Promise.all([
          selectRows(
            client.orm.public.ClueField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ClueFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'customer':
        return Promise.all([
          selectRows(
            client.orm.public.CustomerField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.CustomerFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'customerContact':
        return Promise.all([
          selectRows(
            client.orm.public.CustomerContactField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.CustomerContactFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'opportunity':
        return Promise.all([
          selectRows(
            client.orm.public.OpportunityField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.OpportunityFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'product':
        return Promise.all([
          selectRows(
            client.orm.public.ProductField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ProductFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'productPrice':
        return Promise.all([
          selectRows(
            client.orm.public.ProductPriceField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ProductPriceFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'quotation':
        return Promise.all([
          selectRows(
            client.orm.public.OpportunityQuotationField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.OpportunityQuotationFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'contract':
        return Promise.all([
          selectRows(
            client.orm.public.ContractField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ContractFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'contractPaymentPlan':
        return Promise.all([
          selectRows(
            client.orm.public.ContractPaymentPlanField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ContractPaymentPlanFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'contractPaymentRecord':
        return Promise.all([
          selectRows(
            client.orm.public.ContractPaymentRecordField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ContractPaymentRecordFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'invoice':
        return Promise.all([
          selectRows(
            client.orm.public.ContractInvoiceField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.ContractInvoiceFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'order':
        return Promise.all([
          selectRows(
            client.orm.public.SalesOrderField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.SalesOrderFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'followRecord':
        return Promise.all([
          selectRows(
            client.orm.public.FollowUpRecordField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.FollowUpRecordFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
      case 'followPlan':
        return Promise.all([
          selectRows(
            client.orm.public.FollowUpPlanField.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
          selectRows(
            client.orm.public.FollowUpPlanFieldBlob.where((row) => row.resourceId.in(ids))
              .select('resourceId', 'fieldId', 'fieldValue')
              .all(),
          ),
        ])
    }
  }

  private compilePredicate(
    resourceType: ResourceFieldType,
    field: FieldVO,
    condition: FilterCondition,
  ): PrismaRawExpression {
    const client = this.prisma.client
    const existsNormal = (predicate?: PrismaRawExpression) =>
      this.resourceFieldExists(resourceType, field.id, false, predicate)
    const existsBlob = (predicate?: PrismaRawExpression) =>
      this.resourceFieldExists(resourceType, field.id, true, predicate)
    const negate = (expression: PrismaRawExpression) =>
      client.raw.sql`NOT (${expression})`.returns('pg/bool@1')

    if (condition.op === 'isEmpty') {
      return client.raw.sql`NOT (${existsNormal()}) AND NOT (${existsBlob()})`.returns('pg/bool@1')
    }
    if (condition.op === 'notEmpty') {
      return client.raw.sql`(${existsNormal()}) OR (${existsBlob()})`.returns('pg/bool@1')
    }

    if (
      (condition.op === 'contains' || condition.op === 'notContains') &&
      ['multiselect', 'checkbox', 'data_source_multiple'].includes(field.type)
    ) {
      if (typeof condition.value !== 'string')
        throw new BadRequestException('多选字段筛选值格式不正确')
      this.assertOptions(field, [condition.value])
      const match = client.raw.sql`field_value.field_value::jsonb @> ${JSON.stringify([
        condition.value,
      ])}::jsonb`.returns('pg/bool@1')
      const matched = existsBlob(match)
      return condition.op === 'notContains' ? negate(matched) : matched
    }

    if (condition.op === 'in' || condition.op === 'notIn') {
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      if (!rawValues.length || rawValues.some((value) => this.isEmpty(value))) {
        throw new BadRequestException('筛选值不能为空')
      }
      if (['multiselect', 'checkbox', 'data_source_multiple'].includes(field.type)) {
        const values = rawValues.map(String)
        this.assertOptions(field, values)
        const valuesJson = JSON.stringify(values)
        const match = client.raw.sql`jsonb_exists_any(
          field_value.field_value::jsonb,
          ARRAY(SELECT jsonb_array_elements_text(${valuesJson}::jsonb))
        )`.returns('pg/bool@1')
        const matched = existsBlob(match)
        return condition.op === 'notIn' ? negate(matched) : matched
      }
      const serializedValues = rawValues.map((value) => this.serialize(field, value))
      if (serializedValues.some((value) => value === null)) {
        throw new BadRequestException('筛选值不能为空')
      }
      const storage = this.storageFor(field.type, serializedValues[0] as string)
      const valuesJson = JSON.stringify(serializedValues)
      const match = client.raw.sql`field_value.field_value IN (
        SELECT jsonb_array_elements_text(${valuesJson}::jsonb)
      )`.returns('pg/bool@1')
      const matched = storage === 'blob' ? existsBlob(match) : existsNormal(match)
      return condition.op === 'notIn' ? negate(matched) : matched
    }

    const serialized =
      condition.op === 'contains' || condition.op === 'notContains'
        ? this.serializeContainsValue(field, condition.value)
        : this.serialize(field, condition.value)
    if (serialized === null) throw new BadRequestException('筛选值不能为空')
    const storage = this.storageFor(field.type, serialized)
    let match: PrismaRawExpression
    if (condition.op === 'contains' || condition.op === 'notContains') {
      match = client.raw.sql`field_value.field_value LIKE ${`%${serialized}%`}`.returns('pg/bool@1')
    } else if (['date', 'datetime'].includes(field.type)) {
      if (condition.op === 'gte') {
        match = client.raw
          .sql`field_value.field_value::timestamptz >= ${serialized}::timestamptz`.returns(
          'pg/bool@1',
        )
      } else if (condition.op === 'lte') {
        match = client.raw
          .sql`field_value.field_value::timestamptz <= ${serialized}::timestamptz`.returns(
          'pg/bool@1',
        )
      } else {
        throw new BadRequestException(`「${field.label}」不支持该筛选操作`)
      }
    } else if (condition.op === 'gt') {
      match = client.raw.sql`field_value.field_value::numeric > ${Number(serialized)}`.returns(
        'pg/bool@1',
      )
    } else if (condition.op === 'gte') {
      match = client.raw.sql`field_value.field_value::numeric >= ${Number(serialized)}`.returns(
        'pg/bool@1',
      )
    } else if (condition.op === 'lt') {
      match = client.raw.sql`field_value.field_value::numeric < ${Number(serialized)}`.returns(
        'pg/bool@1',
      )
    } else if (condition.op === 'lte') {
      match = client.raw.sql`field_value.field_value::numeric <= ${Number(serialized)}`.returns(
        'pg/bool@1',
      )
    } else {
      match = client.raw.sql`field_value.field_value = ${serialized}`.returns('pg/bool@1')
    }
    const matched = storage === 'blob' ? existsBlob(match) : existsNormal(match)
    return condition.op === 'ne' || condition.op === 'notContains' ? negate(matched) : matched
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
