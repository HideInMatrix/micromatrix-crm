import { Injectable } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'
import type { ApprovalJsonValue } from './approval-runtime.types'

interface QuotationPreUpdateSnapshot {
  quotation: {
    name: string
    opportunityId: string
    untilTime: string
    amount: string
  }
  fields: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  fieldBlobs: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  snapshots: Array<{
    id: string
    quotationId: string
    quotationProp: string | null
    quotationValue: string | null
  }>
}

interface ContractPreUpdateSnapshot {
  contract: {
    name: string
    customerId: string
    owner: string
    amount: string
    number: string
    stage: string
    startTime: string | null
    endTime: string | null
    voidReason: string | null
    pos: string | null
  }
  fields: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  fieldBlobs: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  snapshots: Array<{
    id: string
    contractId: string
    contractProp: string | null
    contractValue: string | null
  }>
}

interface InvoicePreUpdateSnapshot {
  invoice: {
    name: string
    contractId: string
    owner: string
    amount: string | null
    invoiceType: string | null
    taxRate: string | null
    businessTitleId: string | null
  }
  fields: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
  }>
  fieldBlobs: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
  }>
  snapshots: Array<{
    id: string
    invoiceId: string
    invoiceProp: string | null
    invoiceValue: string | null
  }>
}

interface OrderPreUpdateSnapshot {
  order: {
    number: string
    name: string
    customerId: string | null
    contractId: string | null
    owner: string | null
    amount: string | null
    stage: string
    pos: string | null
  }
  fields: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  fieldBlobs: Array<{
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }>
  snapshots: Array<{
    id: string
    orderId: string
    orderProp: string | null
    orderValue: string | null
  }>
}

type RestoreHandler = (
  tenantId: string,
  targetId: string,
  snapshot: ApprovalJsonValue,
  operatorId: string,
) => Promise<void>

@Injectable()
export class ApprovalResourceRestoreService {
  private readonly handlers: Record<ApprovalModule, RestoreHandler>

  constructor(private readonly prisma8: Prisma8Service) {
    this.handlers = {
      quote: (tenantId, targetId, snapshot, operatorId) =>
        this.restoreQuotation(tenantId, targetId, snapshot, operatorId),
      contract: (tenantId, targetId, snapshot, operatorId) =>
        this.restoreContract(tenantId, targetId, snapshot, operatorId),
      invoice: (tenantId, targetId, snapshot, operatorId) =>
        this.restoreInvoice(tenantId, targetId, snapshot, operatorId),
      order: (tenantId, targetId, snapshot, operatorId) =>
        this.restoreOrder(tenantId, targetId, snapshot, operatorId),
    }
  }

  restore(
    tenantId: string,
    module: ApprovalModule,
    targetId: string,
    snapshot: ApprovalJsonValue,
    operatorId: string,
  ) {
    return this.handlers[module](tenantId, targetId, snapshot, operatorId)
  }

  private async restoreQuotation(tenantId: string, targetId: string, raw: ApprovalJsonValue, operatorId: string) {
    const snapshot = raw as unknown as QuotationPreUpdateSnapshot
    if (!snapshot.quotation || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const id = prisma8Varchar(targetId, 32)
    const current = await this.prisma8.client.orm.public.OpportunityQuotation.where({
      id,
      organizationId: prisma8Varchar(tenantId, 32),
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.OpportunityQuotation.where({ id }).update({
        name: prisma8Varchar(snapshot.quotation.name, 255),
        opportunityId: prisma8Varchar(snapshot.quotation.opportunityId, 32),
        untilTime: BigInt(snapshot.quotation.untilTime),
        amount: prisma8Numeric(snapshot.quotation.amount, 14, 2),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(operatorId, 32),
      })
      await tx.orm.public.OpportunityQuotationField.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.OpportunityQuotationFieldBlob.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.OpportunityQuotationSnapshot.where({ quotationId: id }).deleteAndCount()
      if (snapshot.fields.length) {
        await tx.orm.public.OpportunityQuotationField.createAll(
          snapshot.fields.map((field) => this.subtableField(field)),
        )
      }
      if (snapshot.fieldBlobs.length) {
        await tx.orm.public.OpportunityQuotationFieldBlob.createAll(
          snapshot.fieldBlobs.map((field) => this.subtableBlob(field)),
        )
      }
      if (snapshot.snapshots?.length) {
        await tx.orm.public.OpportunityQuotationSnapshot.createAll(
          snapshot.snapshots.map((item) => ({
            id: prisma8Varchar(item.id, 32),
            quotationId: prisma8Varchar(item.quotationId, 32),
            quotationProp: item.quotationProp,
            quotationValue: item.quotationValue,
          })),
        )
      }
    })
    await this.syncQuotationSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async restoreContract(tenantId: string, targetId: string, raw: ApprovalJsonValue, operatorId: string) {
    const snapshot = raw as unknown as ContractPreUpdateSnapshot
    if (!snapshot.contract || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const id = prisma8Varchar(targetId, 32)
    const current = await this.prisma8.client.orm.public.Contract.where({
      id,
      organizationId: prisma8Varchar(tenantId, 32),
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.Contract.where({ id }).update({
        name: prisma8Varchar(snapshot.contract.name, 255),
        customerId: prisma8Varchar(snapshot.contract.customerId, 32),
        owner: prisma8Varchar(snapshot.contract.owner, 32),
        amount: prisma8Numeric(snapshot.contract.amount, 14, 2),
        number: prisma8Varchar(snapshot.contract.number, 50),
        stage: prisma8Varchar(snapshot.contract.stage, 32),
        startTime: snapshot.contract.startTime === null ? null : BigInt(snapshot.contract.startTime),
        endTime: snapshot.contract.endTime === null ? null : BigInt(snapshot.contract.endTime),
        voidReason:
          snapshot.contract.voidReason === null
            ? null
            : prisma8Varchar(snapshot.contract.voidReason, 255),
        pos: snapshot.contract.pos === null ? null : BigInt(snapshot.contract.pos),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(operatorId, 32),
      })
      await tx.orm.public.ContractField.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.ContractFieldBlob.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.ContractSnapshot.where({ contractId: id }).deleteAndCount()
      if (snapshot.fields.length) {
        await tx.orm.public.ContractField.createAll(snapshot.fields.map((field) => this.subtableField(field)))
      }
      if (snapshot.fieldBlobs.length) {
        await tx.orm.public.ContractFieldBlob.createAll(
          snapshot.fieldBlobs.map((field) => this.subtableBlob(field)),
        )
      }
      if (snapshot.snapshots?.length) {
        await tx.orm.public.ContractSnapshot.createAll(
          snapshot.snapshots.map((item) => ({
            id: prisma8Varchar(item.id, 32),
            contractId: prisma8Varchar(item.contractId, 32),
            contractProp: item.contractProp,
            contractValue: item.contractValue,
          })),
        )
      }
    })
    await this.syncContractSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async restoreInvoice(tenantId: string, targetId: string, raw: ApprovalJsonValue, operatorId: string) {
    const snapshot = raw as unknown as InvoicePreUpdateSnapshot
    if (!snapshot.invoice || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const id = prisma8Varchar(targetId, 32)
    const current = await this.prisma8.client.orm.public.ContractInvoice.where({
      id,
      organizationId: prisma8Varchar(tenantId, 32),
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.ContractInvoice.where({ id }).update({
        name: prisma8Varchar(snapshot.invoice.name, 255),
        contractId: prisma8Varchar(snapshot.invoice.contractId, 32),
        owner: prisma8Varchar(snapshot.invoice.owner, 32),
        amount:
          snapshot.invoice.amount === null
            ? null
            : prisma8Numeric(snapshot.invoice.amount, 20, 10),
        invoiceType:
          snapshot.invoice.invoiceType === null
            ? null
            : prisma8Varchar(snapshot.invoice.invoiceType, 32),
        taxRate:
          snapshot.invoice.taxRate === null
            ? null
            : prisma8Numeric(snapshot.invoice.taxRate, 20, 10),
        businessTitleId:
          snapshot.invoice.businessTitleId === null
            ? null
            : prisma8Varchar(snapshot.invoice.businessTitleId, 32),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(operatorId, 32),
      })
      await tx.orm.public.ContractInvoiceField.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.ContractInvoiceFieldBlob.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.ContractInvoiceSnapshot.where({ invoiceId: id }).deleteAndCount()
      if (snapshot.fields.length) {
        await tx.orm.public.ContractInvoiceField.createAll(
          snapshot.fields.map((field) => this.simpleField(field)),
        )
      }
      if (snapshot.fieldBlobs.length) {
        await tx.orm.public.ContractInvoiceFieldBlob.createAll(
          snapshot.fieldBlobs.map((field) => this.simpleBlob(field)),
        )
      }
      if (snapshot.snapshots?.length) {
        await tx.orm.public.ContractInvoiceSnapshot.createAll(
          snapshot.snapshots.map((item) => ({
            id: prisma8Varchar(item.id, 32),
            invoiceId: prisma8Varchar(item.invoiceId, 32),
            invoiceProp: item.invoiceProp,
            invoiceValue: item.invoiceValue,
          })),
        )
      }
    })
    await this.syncInvoiceSnapshot(targetId, current.approvalStatus ?? 'NONE', current.approved)
  }

  private async restoreOrder(tenantId: string, targetId: string, raw: ApprovalJsonValue, operatorId: string) {
    const snapshot = raw as unknown as OrderPreUpdateSnapshot
    if (!snapshot.order || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const id = prisma8Varchar(targetId, 32)
    const current = await this.prisma8.client.orm.public.SalesOrder.where({
      id,
      organizationId: prisma8Varchar(tenantId, 32),
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.SalesOrder.where({ id }).update({
        number: prisma8Varchar(snapshot.order.number, 50),
        name: prisma8Varchar(snapshot.order.name, 255),
        customerId:
          snapshot.order.customerId === null ? null : prisma8Varchar(snapshot.order.customerId, 32),
        contractId:
          snapshot.order.contractId === null ? null : prisma8Varchar(snapshot.order.contractId, 32),
        owner: snapshot.order.owner === null ? null : prisma8Varchar(snapshot.order.owner, 32),
        amount:
          snapshot.order.amount === null ? null : prisma8Numeric(snapshot.order.amount, 20, 10),
        stage: prisma8Varchar(snapshot.order.stage, 50),
        pos: snapshot.order.pos === null ? null : BigInt(snapshot.order.pos),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(operatorId, 32),
      })
      await tx.orm.public.SalesOrderField.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.SalesOrderFieldBlob.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.SalesOrderSnapshot.where({ orderId: id }).deleteAndCount()
      if (snapshot.fields.length) {
        await tx.orm.public.SalesOrderField.createAll(
          snapshot.fields.map((field) => this.subtableField(field)),
        )
      }
      if (snapshot.fieldBlobs.length) {
        await tx.orm.public.SalesOrderFieldBlob.createAll(
          snapshot.fieldBlobs.map((field) => this.subtableBlob(field)),
        )
      }
      if (snapshot.snapshots?.length) {
        await tx.orm.public.SalesOrderSnapshot.createAll(
          snapshot.snapshots.map((item) => ({
            id: prisma8Varchar(item.id, 32),
            orderId: prisma8Varchar(item.orderId, 32),
            orderProp: item.orderProp,
            orderValue: item.orderValue,
          })),
        )
      }
    })
    await this.syncOrderSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async syncQuotationSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma8.client.orm.public.OpportunityQuotationSnapshot.where({
      quotationId: prisma8Varchar(resourceId, 32),
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.quotationValue) continue
      const value = this.parseSnapshotValue(snapshot.quotationValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma8.client.orm.public.OpportunityQuotationSnapshot.where({
        id: snapshot.id,
      }).update({ quotationValue: JSON.stringify(value) })
    }
  }

  private async syncContractSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma8.client.orm.public.ContractSnapshot.where({
      contractId: prisma8Varchar(resourceId, 32),
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.contractValue) continue
      const value = this.parseSnapshotValue(snapshot.contractValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma8.client.orm.public.ContractSnapshot.where({ id: snapshot.id }).update({
        contractValue: JSON.stringify(value),
      })
    }
  }

  private async syncInvoiceSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma8.client.orm.public.ContractInvoiceSnapshot.where({
      invoiceId: prisma8Varchar(resourceId, 32),
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.invoiceValue) continue
      const value = this.parseSnapshotValue(snapshot.invoiceValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma8.client.orm.public.ContractInvoiceSnapshot.where({ id: snapshot.id }).update({
        invoiceValue: JSON.stringify(value),
      })
    }
  }

  private async syncOrderSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma8.client.orm.public.SalesOrderSnapshot.where({
      orderId: prisma8Varchar(resourceId, 32),
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.orderValue) continue
      const value = this.parseSnapshotValue(snapshot.orderValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma8.client.orm.public.SalesOrderSnapshot.where({ id: snapshot.id }).update({
        orderValue: JSON.stringify(value),
      })
    }
  }

  private subtableField(field: {
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }) {
    return {
      id: prisma8Varchar(field.id, 32),
      resourceId: prisma8Varchar(field.resourceId, 32),
      fieldId: prisma8Varchar(field.fieldId, 32),
      fieldValue: prisma8Varchar(field.fieldValue, 255),
      refSubId: field.refSubId === null ? null : prisma8Varchar(field.refSubId, 32),
      rowId: field.rowId === null ? null : prisma8Varchar(field.rowId, 32),
      bizId: field.bizId === null ? null : prisma8Varchar(field.bizId, 32),
    }
  }

  private subtableBlob(field: {
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
    refSubId: string | null
    rowId: string | null
    bizId: string | null
  }) {
    return {
      id: prisma8Varchar(field.id, 32),
      resourceId: prisma8Varchar(field.resourceId, 32),
      fieldId: prisma8Varchar(field.fieldId, 32),
      fieldValue: field.fieldValue,
      refSubId: field.refSubId === null ? null : prisma8Varchar(field.refSubId, 32),
      rowId: field.rowId === null ? null : prisma8Varchar(field.rowId, 32),
      bizId: field.bizId === null ? null : prisma8Varchar(field.bizId, 32),
    }
  }

  private simpleField(field: {
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
  }) {
    return {
      id: prisma8Varchar(field.id, 32),
      resourceId: prisma8Varchar(field.resourceId, 32),
      fieldId: prisma8Varchar(field.fieldId, 32),
      fieldValue: prisma8Varchar(field.fieldValue, 255),
    }
  }

  private simpleBlob(field: {
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
  }) {
    return {
      id: prisma8Varchar(field.id, 32),
      resourceId: prisma8Varchar(field.resourceId, 32),
      fieldId: prisma8Varchar(field.fieldId, 32),
      fieldValue: field.fieldValue,
    }
  }

  private parseSnapshotValue(raw: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}
