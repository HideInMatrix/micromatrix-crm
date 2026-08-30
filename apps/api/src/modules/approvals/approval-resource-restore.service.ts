import { Injectable } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

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
  snapshot: Prisma.JsonValue,
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
    snapshot: Prisma.JsonValue,
    operatorId: string,
  ) {
    return this.handlers[module](tenantId, targetId, snapshot, operatorId)
  }

  private async restoreQuotation(tenantId: string, targetId: string, raw: Prisma.JsonValue, operatorId: string) {
    const snapshot = raw as unknown as QuotationPreUpdateSnapshot
    if (!snapshot.quotation || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const current = await this.prisma.opportunityQuotation.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true, approvalStatus: true, approved: true },
    })
    if (!current) return

    await this.prisma.$transaction(async (tx) => {
      await tx.opportunityQuotation.update({
        where: { id: current.id },
        data: {
          name: snapshot.quotation.name,
          opportunityId: snapshot.quotation.opportunityId,
          untilTime: BigInt(snapshot.quotation.untilTime),
          amount: new Prisma.Decimal(snapshot.quotation.amount),
          updateTime: BigInt(Date.now()),
          updateUser: operatorId,
        },
      })
      await Promise.all([
        tx.opportunityQuotationField.deleteMany({ where: { resourceId: targetId } }),
        tx.opportunityQuotationFieldBlob.deleteMany({ where: { resourceId: targetId } }),
        tx.opportunityQuotationSnapshot.deleteMany({ where: { quotationId: targetId } }),
      ])
      if (snapshot.fields.length) await tx.opportunityQuotationField.createMany({ data: snapshot.fields })
      if (snapshot.fieldBlobs.length) {
        await tx.opportunityQuotationFieldBlob.createMany({ data: snapshot.fieldBlobs })
      }
      if (snapshot.snapshots?.length) {
        await tx.opportunityQuotationSnapshot.createMany({ data: snapshot.snapshots })
      }
    })
    await this.syncQuotationSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async restoreContract(tenantId: string, targetId: string, raw: Prisma.JsonValue, operatorId: string) {
    const snapshot = raw as unknown as ContractPreUpdateSnapshot
    if (!snapshot.contract || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const current = await this.prisma.contract.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true, approvalStatus: true, approved: true },
    })
    if (!current) return

    await this.prisma.$transaction(async (tx) => {
      await tx.contract.update({
        where: { id: current.id },
        data: {
          name: snapshot.contract.name,
          customerId: snapshot.contract.customerId,
          owner: snapshot.contract.owner,
          amount: new Prisma.Decimal(snapshot.contract.amount),
          number: snapshot.contract.number,
          stage: snapshot.contract.stage,
          startTime: snapshot.contract.startTime === null ? null : BigInt(snapshot.contract.startTime),
          endTime: snapshot.contract.endTime === null ? null : BigInt(snapshot.contract.endTime),
          voidReason: snapshot.contract.voidReason,
          pos: snapshot.contract.pos === null ? null : BigInt(snapshot.contract.pos),
          updateTime: BigInt(Date.now()),
          updateUser: operatorId,
        },
      })
      await tx.contractField.deleteMany({ where: { resourceId: targetId } })
      await tx.contractFieldBlob.deleteMany({ where: { resourceId: targetId } })
      await tx.contractSnapshot.deleteMany({ where: { contractId: targetId } })
      if (snapshot.fields.length) await tx.contractField.createMany({ data: snapshot.fields })
      if (snapshot.fieldBlobs.length) await tx.contractFieldBlob.createMany({ data: snapshot.fieldBlobs })
      if (snapshot.snapshots?.length) await tx.contractSnapshot.createMany({ data: snapshot.snapshots })
    })
    await this.syncContractSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async restoreInvoice(tenantId: string, targetId: string, raw: Prisma.JsonValue, operatorId: string) {
    const snapshot = raw as unknown as InvoicePreUpdateSnapshot
    if (!snapshot.invoice || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const current = await this.prisma.contractInvoice.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true, approvalStatus: true, approved: true },
    })
    if (!current) return

    await this.prisma.$transaction(async (tx) => {
      await tx.contractInvoice.update({
        where: { id: current.id },
        data: {
          name: snapshot.invoice.name,
          contractId: snapshot.invoice.contractId,
          owner: snapshot.invoice.owner,
          amount: snapshot.invoice.amount === null ? null : new Prisma.Decimal(snapshot.invoice.amount),
          invoiceType: snapshot.invoice.invoiceType,
          taxRate: snapshot.invoice.taxRate === null ? null : new Prisma.Decimal(snapshot.invoice.taxRate),
          businessTitleId: snapshot.invoice.businessTitleId,
          updateTime: BigInt(Date.now()),
          updateUser: operatorId,
        },
      })
      await tx.contractInvoiceField.deleteMany({ where: { resourceId: targetId } })
      await tx.contractInvoiceFieldBlob.deleteMany({ where: { resourceId: targetId } })
      await tx.contractInvoiceSnapshot.deleteMany({ where: { invoiceId: targetId } })
      if (snapshot.fields.length) await tx.contractInvoiceField.createMany({ data: snapshot.fields })
      if (snapshot.fieldBlobs.length) await tx.contractInvoiceFieldBlob.createMany({ data: snapshot.fieldBlobs })
      if (snapshot.snapshots?.length) await tx.contractInvoiceSnapshot.createMany({ data: snapshot.snapshots })
    })
    await this.syncInvoiceSnapshot(targetId, current.approvalStatus ?? 'NONE', current.approved)
  }

  private async restoreOrder(tenantId: string, targetId: string, raw: Prisma.JsonValue, operatorId: string) {
    const snapshot = raw as unknown as OrderPreUpdateSnapshot
    if (!snapshot.order || !Array.isArray(snapshot.fields) || !Array.isArray(snapshot.fieldBlobs)) return
    const current = await this.prisma.order.findFirst({
      where: { id: targetId, organizationId: tenantId },
      select: { id: true, approvalStatus: true, approved: true },
    })
    if (!current) return

    await this.prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: current.id },
        data: {
          number: snapshot.order.number,
          name: snapshot.order.name,
          customerId: snapshot.order.customerId,
          contractId: snapshot.order.contractId,
          owner: snapshot.order.owner,
          amount: snapshot.order.amount === null ? null : new Prisma.Decimal(snapshot.order.amount),
          stage: snapshot.order.stage,
          pos: snapshot.order.pos === null ? null : BigInt(snapshot.order.pos),
          updateTime: BigInt(Date.now()),
          updateUser: operatorId,
        },
      })
      await tx.orderField.deleteMany({ where: { resourceId: targetId } })
      await tx.orderFieldBlob.deleteMany({ where: { resourceId: targetId } })
      await tx.orderSnapshot.deleteMany({ where: { orderId: targetId } })
      if (snapshot.fields.length) await tx.orderField.createMany({ data: snapshot.fields })
      if (snapshot.fieldBlobs.length) await tx.orderFieldBlob.createMany({ data: snapshot.fieldBlobs })
      if (snapshot.snapshots?.length) await tx.orderSnapshot.createMany({ data: snapshot.snapshots })
    })
    await this.syncOrderSnapshot(targetId, current.approvalStatus, current.approved)
  }

  private async syncQuotationSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma.opportunityQuotationSnapshot.findMany({ where: { quotationId: resourceId } })
    for (const snapshot of snapshots) {
      if (!snapshot.quotationValue) continue
      const value = this.parseSnapshotValue(snapshot.quotationValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.opportunityQuotationSnapshot.update({
        where: { id: snapshot.id },
        data: { quotationValue: JSON.stringify(value) },
      })
    }
  }

  private async syncContractSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma.contractSnapshot.findMany({ where: { contractId: resourceId } })
    for (const snapshot of snapshots) {
      if (!snapshot.contractValue) continue
      const value = this.parseSnapshotValue(snapshot.contractValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.contractSnapshot.update({
        where: { id: snapshot.id },
        data: { contractValue: JSON.stringify(value) },
      })
    }
  }

  private async syncInvoiceSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma.contractInvoiceSnapshot.findMany({ where: { invoiceId: resourceId } })
    for (const snapshot of snapshots) {
      if (!snapshot.invoiceValue) continue
      const value = this.parseSnapshotValue(snapshot.invoiceValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.contractInvoiceSnapshot.update({
        where: { id: snapshot.id },
        data: { invoiceValue: JSON.stringify(value) },
      })
    }
  }

  private async syncOrderSnapshot(resourceId: string, approvalStatus: string, approved: boolean) {
    const snapshots = await this.prisma.orderSnapshot.findMany({ where: { orderId: resourceId } })
    for (const snapshot of snapshots) {
      if (!snapshot.orderValue) continue
      const value = this.parseSnapshotValue(snapshot.orderValue)
      value.approvalStatus = approvalStatus
      value.approved = approved
      await this.prisma.orderSnapshot.update({
        where: { id: snapshot.id },
        data: { orderValue: JSON.stringify(value) },
      })
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
