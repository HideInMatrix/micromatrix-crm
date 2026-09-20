import { Injectable, NotFoundException } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'

import type { ApprovalJsonValue } from './approval-runtime.types'

type CaptureHandler = (user: AuthUser, targetId: string) => Promise<ApprovalJsonValue>

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

  private async captureQuotation(user: AuthUser, targetId: string): Promise<ApprovalJsonValue> {
    const id = targetId
    const quotation = await this.prisma.client.orm.public.OpportunityQuotation.where({
      id,
      organizationId: user.tenantId,
    })
      .select('name', 'opportunityId', 'untilTime', 'amount')
      .first()
    if (!quotation) throw new NotFoundException('报价不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.client.orm.public.OpportunityQuotationField.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.OpportunityQuotationFieldBlob.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.OpportunityQuotationSnapshot.where({ quotationId: id }).all(),
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
    } as unknown as ApprovalJsonValue
  }

  private async captureContract(user: AuthUser, targetId: string): Promise<ApprovalJsonValue> {
    const id = targetId
    const contract = await this.prisma.client.orm.public.Contract.where({
      id,
      organizationId: user.tenantId,
    })
      .select(
        'name',
        'customerId',
        'owner',
        'amount',
        'number',
        'stage',
        'startTime',
        'endTime',
        'voidReason',
        'pos',
      )
      .first()
    if (!contract) throw new NotFoundException('合同不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.client.orm.public.ContractField.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.ContractFieldBlob.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.ContractSnapshot.where({ contractId: id }).all(),
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
    } as unknown as ApprovalJsonValue
  }

  private async captureInvoice(user: AuthUser, targetId: string): Promise<ApprovalJsonValue> {
    const id = targetId
    const invoice = await this.prisma.client.orm.public.ContractInvoice.where({
      id,
      organizationId: user.tenantId,
    })
      .select('name', 'contractId', 'owner', 'amount', 'invoiceType', 'taxRate', 'businessTitleId')
      .first()
    if (!invoice) throw new NotFoundException('发票不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.client.orm.public.ContractInvoiceField.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.ContractInvoiceFieldBlob.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.ContractInvoiceSnapshot.where({ invoiceId: id }).all(),
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
    } as unknown as ApprovalJsonValue
  }

  private async captureOrder(user: AuthUser, targetId: string): Promise<ApprovalJsonValue> {
    const id = targetId
    const order = await this.prisma.client.orm.public.SalesOrder.where({
      id,
      organizationId: user.tenantId,
    })
      .select('number', 'name', 'customerId', 'contractId', 'owner', 'amount', 'stage', 'pos')
      .first()
    if (!order) throw new NotFoundException('订单不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma.client.orm.public.SalesOrderField.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.SalesOrderFieldBlob.where({ resourceId: id }).all(),
      this.prisma.client.orm.public.SalesOrderSnapshot.where({ orderId: id }).all(),
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
    } as unknown as ApprovalJsonValue
  }
}
