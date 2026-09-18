import { Injectable } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { decimalString, numericValue } from '../../prisma/numeric-value'

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

  constructor(private readonly prisma: PrismaService) {
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

  private async restoreQuotation(
    tenantId: string,
    targetId: string,
    raw: ApprovalJsonValue,
    operatorId: string,
  ) {
    const snapshot = raw as unknown as QuotationPreUpdateSnapshot
    if (
      !snapshot.quotation ||
      !Array.isArray(snapshot.fields) ||
      !Array.isArray(snapshot.fieldBlobs)
    )
      return
    const id = targetId
    const current = await this.prisma.client.orm.public.OpportunityQuotation.where({
      id,
      organizationId: tenantId,
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.OpportunityQuotation.where({ id }).update({
        name: snapshot.quotation.name,
        opportunityId: snapshot.quotation.opportunityId,
        untilTime: BigInt(snapshot.quotation.untilTime),
        amount: numericValue(decimalString(snapshot.quotation.amount, 14, 2), 14, 2),
        updateTime: BigInt(Date.now()),
        updateUser: operatorId,
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
            id: item.id,
            quotationId: item.quotationId,
            quotationProp: item.quotationProp,
            quotationValue: item.quotationValue,
          })),
        )
      }
    })
    await this.syncQuotationSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async restoreContract(
    tenantId: string,
    targetId: string,
    raw: ApprovalJsonValue,
    operatorId: string,
  ) {
    const snapshot = raw as unknown as ContractPreUpdateSnapshot
    if (
      !snapshot.contract ||
      !Array.isArray(snapshot.fields) ||
      !Array.isArray(snapshot.fieldBlobs)
    )
      return
    const id = targetId
    const current = await this.prisma.client.orm.public.Contract.where({
      id,
      organizationId: tenantId,
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.Contract.where({ id }).update({
        name: snapshot.contract.name,
        customerId: snapshot.contract.customerId,
        owner: snapshot.contract.owner,
        amount: numericValue(decimalString(snapshot.contract.amount, 14, 2), 14, 2),
        number: snapshot.contract.number,
        stage: snapshot.contract.stage,
        startTime:
          snapshot.contract.startTime === null ? null : BigInt(snapshot.contract.startTime),
        endTime: snapshot.contract.endTime === null ? null : BigInt(snapshot.contract.endTime),
        voidReason: snapshot.contract.voidReason === null ? null : snapshot.contract.voidReason,
        pos: snapshot.contract.pos === null ? null : BigInt(snapshot.contract.pos),
        updateTime: BigInt(Date.now()),
        updateUser: operatorId,
      })
      await tx.orm.public.ContractField.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.ContractFieldBlob.where({ resourceId: id }).deleteAndCount()
      await tx.orm.public.ContractSnapshot.where({ contractId: id }).deleteAndCount()
      if (snapshot.fields.length) {
        await tx.orm.public.ContractField.createAll(
          snapshot.fields.map((field) => this.subtableField(field)),
        )
      }
      if (snapshot.fieldBlobs.length) {
        await tx.orm.public.ContractFieldBlob.createAll(
          snapshot.fieldBlobs.map((field) => this.subtableBlob(field)),
        )
      }
      if (snapshot.snapshots?.length) {
        await tx.orm.public.ContractSnapshot.createAll(
          snapshot.snapshots.map((item) => ({
            id: item.id,
            contractId: item.contractId,
            contractProp: item.contractProp,
            contractValue: item.contractValue,
          })),
        )
      }
    })
    await this.syncContractSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async restoreInvoice(
    tenantId: string,
    targetId: string,
    raw: ApprovalJsonValue,
    operatorId: string,
  ) {
    const snapshot = raw as unknown as InvoicePreUpdateSnapshot
    if (!snapshot.invoice || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs))
      return
    const id = targetId
    const current = await this.prisma.client.orm.public.ContractInvoice.where({
      id,
      organizationId: tenantId,
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.ContractInvoice.where({ id }).update({
        name: snapshot.invoice.name,
        contractId: snapshot.invoice.contractId,
        owner: snapshot.invoice.owner,
        amount:
          snapshot.invoice.amount === null
            ? null
            : numericValue(decimalString(snapshot.invoice.amount, 20, 10), 20, 10),
        invoiceType: snapshot.invoice.invoiceType === null ? null : snapshot.invoice.invoiceType,
        taxRate:
          snapshot.invoice.taxRate === null
            ? null
            : numericValue(decimalString(snapshot.invoice.taxRate, 20, 10), 20, 10),
        businessTitleId:
          snapshot.invoice.businessTitleId === null ? null : snapshot.invoice.businessTitleId,
        updateTime: BigInt(Date.now()),
        updateUser: operatorId,
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
            id: item.id,
            invoiceId: item.invoiceId,
            invoiceProp: item.invoiceProp,
            invoiceValue: item.invoiceValue,
          })),
        )
      }
    })
    await this.syncInvoiceSnapshot(targetId, current.approvalStatus ?? 'NONE', current.approved)
  }

  private async restoreOrder(
    tenantId: string,
    targetId: string,
    raw: ApprovalJsonValue,
    operatorId: string,
  ) {
    const snapshot = raw as unknown as OrderPreUpdateSnapshot
    if (!snapshot.order || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs))
      return
    const id = targetId
    const current = await this.prisma.client.orm.public.SalesOrder.where({
      id,
      organizationId: tenantId,
    })
      .select('id', 'approvalStatus', 'approved')
      .first()
    if (!current) return

    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.SalesOrder.where({ id }).update({
        number: snapshot.order.number,
        name: snapshot.order.name,
        customerId: snapshot.order.customerId === null ? null : snapshot.order.customerId,
        contractId: snapshot.order.contractId === null ? null : snapshot.order.contractId,
        owner: snapshot.order.owner === null ? null : snapshot.order.owner,
        amount:
          snapshot.order.amount === null
            ? null
            : numericValue(decimalString(snapshot.order.amount, 20, 10), 20, 10),
        stage: snapshot.order.stage,
        pos: snapshot.order.pos === null ? null : BigInt(snapshot.order.pos),
        updateTime: BigInt(Date.now()),
        updateUser: operatorId,
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
            id: item.id,
            orderId: item.orderId,
            orderProp: item.orderProp,
            orderValue: item.orderValue,
          })),
        )
      }
    })
    await this.syncOrderSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async syncQuotationSnapshot(
    resourceId: string,
    approvalStatus: string,
    approved: boolean,
  ) {
    const snapshots = await this.prisma.client.orm.public.OpportunityQuotationSnapshot.where({
      quotationId: resourceId,
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.quotationValue) continue
      const value = this.parseSnapshotValue(snapshot.quotationValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.client.orm.public.OpportunityQuotationSnapshot.where({
        id: snapshot.id,
      }).update({ quotationValue: JSON.stringify(value) })
    }
  }

  private async syncContractSnapshot(
    resourceId: string,
    approvalStatus: string,
    approved: boolean,
  ) {
    const snapshots = await this.prisma.client.orm.public.ContractSnapshot.where({
      contractId: resourceId,
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.contractValue) continue
      const value = this.parseSnapshotValue(snapshot.contractValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.client.orm.public.ContractSnapshot.where({ id: snapshot.id }).update({
        contractValue: JSON.stringify(value),
      })
    }
  }

  private async syncInvoiceSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma.client.orm.public.ContractInvoiceSnapshot.where({
      invoiceId: resourceId,
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.invoiceValue) continue
      const value = this.parseSnapshotValue(snapshot.invoiceValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.client.orm.public.ContractInvoiceSnapshot.where({
        id: snapshot.id,
      }).update({
        invoiceValue: JSON.stringify(value),
      })
    }
  }

  private async syncOrderSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma.client.orm.public.SalesOrderSnapshot.where({
      orderId: resourceId,
    }).all()
    for (const snapshot of snapshots) {
      if (!snapshot.orderValue) continue
      const value = this.parseSnapshotValue(snapshot.orderValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.client.orm.public.SalesOrderSnapshot.where({ id: snapshot.id }).update({
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
      id: field.id,
      resourceId: field.resourceId,
      fieldId: field.fieldId,
      fieldValue: field.fieldValue,
      refSubId: field.refSubId === null ? null : field.refSubId,
      rowId: field.rowId === null ? null : field.rowId,
      bizId: field.bizId === null ? null : field.bizId,
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
      id: field.id,
      resourceId: field.resourceId,
      fieldId: field.fieldId,
      fieldValue: field.fieldValue,
      refSubId: field.refSubId === null ? null : field.refSubId,
      rowId: field.rowId === null ? null : field.rowId,
      bizId: field.bizId === null ? null : field.bizId,
    }
  }

  private simpleField(field: {
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
  }) {
    return {
      id: field.id,
      resourceId: field.resourceId,
      fieldId: field.fieldId,
      fieldValue: field.fieldValue,
    }
  }

  private simpleBlob(field: {
    id: string
    resourceId: string
    fieldId: string
    fieldValue: string
  }) {
    return {
      id: field.id,
      resourceId: field.resourceId,
      fieldId: field.fieldId,
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
