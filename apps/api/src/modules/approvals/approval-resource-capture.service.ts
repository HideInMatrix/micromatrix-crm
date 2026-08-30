import { Injectable, NotFoundException } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

type CaptureHandler = (user: AuthUser, targetId: string) => Promise<Prisma.InputJsonValue>

@Injectable()
export class ApprovalResourceCaptureService {
  private readonly handlers: Record<ApprovalModule, CaptureHandler>

  constructor(private readonly prisma: PrismaService) {
    this.handlers = {
      quote: (user, targetId) => this.captureQuotation(user, targetId),
      contract: (user, targetId) => this.captureContract(user, targetId),
      invoice: (user, targetId) => this.captureInvoice(user, targetId),
      order: (user, targetId) => this.captureOrder(user, targetId),
    }
  }

  capture(user: AuthUser, module: ApprovalModule, targetId: string) {
    return this.handlers[module](user, targetId)
  }

  private async captureQuotation(user: AuthUser, targetId: string): Promise<Prisma.InputJsonValue> {
    const quotation = await this.prisma.opportunityQuotation.findFirst({
      where: { id: targetId, organizationId: user.tenantId },
      select: { name: true, opportunityId: true, untilTime: true, amount: true },
    })
    if (!quotation) throw new NotFoundException('报价不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.opportunityQuotationField.findMany({ where: { resourceId: targetId } }),
      this.prisma.opportunityQuotationFieldBlob.findMany({ where: { resourceId: targetId } }),
      this.prisma.opportunityQuotationSnapshot.findMany({ where: { quotationId: targetId } }),
    ])
    return {
      quotation: {
        name: quotation.name,
        opportunityId: quotation.opportunityId,
        untilTime: quotation.untilTime.toString(),
        amount: quotation.amount.toString(),
      },
      fields,
      fieldBlobs,
      snapshots,
    } as unknown as Prisma.InputJsonValue
  }

  private async captureContract(user: AuthUser, targetId: string): Promise<Prisma.InputJsonValue> {
    const contract = await this.prisma.contract.findFirst({
      where: { id: targetId, organizationId: user.tenantId },
      select: {
        name: true,
        customerId: true,
        owner: true,
        amount: true,
        number: true,
        stage: true,
        startTime: true,
        endTime: true,
        voidReason: true,
        pos: true,
      },
    })
    if (!contract) throw new NotFoundException('合同不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.contractField.findMany({ where: { resourceId: targetId } }),
      this.prisma.contractFieldBlob.findMany({ where: { resourceId: targetId } }),
      this.prisma.contractSnapshot.findMany({ where: { contractId: targetId } }),
    ])
    return {
      contract: {
        name: contract.name,
        customerId: contract.customerId,
        owner: contract.owner,
        amount: contract.amount.toString(),
        number: contract.number,
        stage: contract.stage,
        startTime: contract.startTime?.toString() ?? null,
        endTime: contract.endTime?.toString() ?? null,
        voidReason: contract.voidReason,
        pos: contract.pos?.toString() ?? null,
      },
      fields,
      fieldBlobs,
      snapshots,
    } as unknown as Prisma.InputJsonValue
  }

  private async captureInvoice(user: AuthUser, targetId: string): Promise<Prisma.InputJsonValue> {
    const invoice = await this.prisma.contractInvoice.findFirst({
      where: { id: targetId, organizationId: user.tenantId },
      select: {
        name: true,
        contractId: true,
        owner: true,
        amount: true,
        invoiceType: true,
        taxRate: true,
        businessTitleId: true,
      },
    })
    if (!invoice) throw new NotFoundException('发票不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.contractInvoiceField.findMany({ where: { resourceId: targetId } }),
      this.prisma.contractInvoiceFieldBlob.findMany({ where: { resourceId: targetId } }),
      this.prisma.contractInvoiceSnapshot.findMany({ where: { invoiceId: targetId } }),
    ])
    return {
      invoice: {
        name: invoice.name,
        contractId: invoice.contractId,
        owner: invoice.owner,
        amount: invoice.amount?.toString() ?? null,
        invoiceType: invoice.invoiceType,
        taxRate: invoice.taxRate?.toString() ?? null,
        businessTitleId: invoice.businessTitleId,
      },
      fields,
      fieldBlobs,
      snapshots,
    } as unknown as Prisma.InputJsonValue
  }

  private async captureOrder(user: AuthUser, targetId: string): Promise<Prisma.InputJsonValue> {
    const order = await this.prisma.order.findFirst({
      where: { id: targetId, organizationId: user.tenantId },
      select: {
        number: true,
        name: true,
        customerId: true,
        contractId: true,
        owner: true,
        amount: true,
        stage: true,
        pos: true,
      },
    })
    if (!order) throw new NotFoundException('订单不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.orderField.findMany({ where: { resourceId: targetId } }),
      this.prisma.orderFieldBlob.findMany({ where: { resourceId: targetId } }),
      this.prisma.orderSnapshot.findMany({ where: { orderId: targetId } }),
    ])
    return {
      order: {
        number: order.number,
        name: order.name,
        customerId: order.customerId,
        contractId: order.contractId,
        owner: order.owner,
        amount: order.amount?.toString() ?? null,
        stage: order.stage,
        pos: order.pos?.toString() ?? null,
      },
      fields,
      fieldBlobs,
      snapshots,
    } as unknown as Prisma.InputJsonValue
  }
}
