import { Injectable, NotFoundException } from '@nestjs/common'
import type { ApprovalModule } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'
import type { ApprovalJsonValue } from './approval-runtime.types'

type CaptureHandler = (user: AuthUser, targetId: string) => Promise<ApprovalJsonValue>

@Injectable()
export class ApprovalResourceCaptureService {
  private readonly handlers: Record<ApprovalModule, CaptureHandler>

  constructor(private readonly prisma8: Prisma8Service) {
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
    const id = prisma8Varchar(targetId, 32)
    const quotation = await this.prisma8.client.orm.public.OpportunityQuotation.where({
      id,
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .select('name', 'opportunityId', 'untilTime', 'amount')
      .first()
    if (!quotation) throw new NotFoundException('报价不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma8.client.orm.public.OpportunityQuotationField.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.OpportunityQuotationFieldBlob.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.OpportunityQuotationSnapshot.where({ quotationId: id }).all(),
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
    const id = prisma8Varchar(targetId, 32)
    const contract = await this.prisma8.client.orm.public.Contract.where({
      id,
      organizationId: prisma8Varchar(user.tenantId, 32),
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
      this.prisma8.client.orm.public.ContractField.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.ContractFieldBlob.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.ContractSnapshot.where({ contractId: id }).all(),
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
    const id = prisma8Varchar(targetId, 32)
    const invoice = await this.prisma8.client.orm.public.ContractInvoice.where({
      id,
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .select('name', 'contractId', 'owner', 'amount', 'invoiceType', 'taxRate', 'businessTitleId')
      .first()
    if (!invoice) throw new NotFoundException('发票不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma8.client.orm.public.ContractInvoiceField.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.ContractInvoiceFieldBlob.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.ContractInvoiceSnapshot.where({ invoiceId: id }).all(),
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
    const id = prisma8Varchar(targetId, 32)
    const order = await this.prisma8.client.orm.public.SalesOrder.where({
      id,
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .select('number', 'name', 'customerId', 'contractId', 'owner', 'amount', 'stage', 'pos')
      .first()
    if (!order) throw new NotFoundException('订单不存在')
    const [fields, fieldBlobs, snapshots] = await Promise.all([
      this.prisma8.client.orm.public.SalesOrderField.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.SalesOrderFieldBlob.where({ resourceId: id }).all(),
      this.prisma8.client.orm.public.SalesOrderSnapshot.where({ orderId: id }).all(),
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
