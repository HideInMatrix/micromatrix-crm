import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InvoiceTitleVO, InvoiceVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'
import { ContractsService } from './contracts.service'
import { CreateInvoiceDto, IssueInvoiceDto, TitleDto } from './dto/invoice.dto'

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
  ) {}

  // ===== 工商抬头 =====

  async listTitles(user: AuthUser, customerId?: string): Promise<InvoiceTitleVO[]> {
    const titles = await this.prisma.invoiceTitle.findMany({
      where: {
        tenantId: user.tenantId,
        ...(customerId ? { OR: [{ customerId }, { customerId: null }] } : {}),
      },
      orderBy: { createdAt: 'desc' },
    })
    return titles.map((t) => ({
      id: t.id,
      customerId: t.customerId,
      name: t.name,
      taxNo: t.taxNo,
      bankName: t.bankName,
      bankAccount: t.bankAccount,
      address: t.address,
      phone: t.phone,
    }))
  }

  async createTitle(user: AuthUser, dto: TitleDto) {
    const title = await this.prisma.invoiceTitle.create({
      data: { ...dto, tenantId: user.tenantId },
    })
    return { id: title.id, name: title.name }
  }

  async updateTitle(user: AuthUser, id: string, dto: Partial<TitleDto>) {
    await this.ensureTitle(user, id)
    const title = await this.prisma.invoiceTitle.update({ where: { id }, data: dto })
    return { id: title.id, name: title.name }
  }

  async removeTitle(user: AuthUser, id: string) {
    const title = await this.ensureTitle(user, id)
    const used = await this.prisma.invoiceRecord.count({ where: { titleId: id } })
    if (used > 0) throw new BadRequestException('该抬头已被发票记录引用，无法删除')
    await this.prisma.invoiceTitle.delete({ where: { id } })
    return { id, name: title.name }
  }

  // ===== 发票 =====

  async listInvoices(user: AuthUser, contractId: string): Promise<InvoiceVO[]> {
    const invoices = await this.prisma.invoiceRecord.findMany({
      where: { tenantId: user.tenantId, contractId },
      include: { title: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return invoices.map((invoice) => ({
      id: invoice.id,
      contractId: invoice.contractId,
      titleId: invoice.titleId,
      titleName: invoice.title?.name ?? null,
      amount: Number(invoice.amount),
      type: invoice.type,
      status: invoice.status,
      invoiceNo: invoice.invoiceNo,
      issuedAt: invoice.issuedAt?.toISOString().slice(0, 10) ?? null,
      remark: invoice.remark,
    }))
  }

  async createInvoice(user: AuthUser, dto: CreateInvoiceDto) {
    await this.contracts.ensureInScope(user, dto.contractId, 'invoice:manage')
    if (dto.titleId) await this.ensureTitle(user, dto.titleId)
    const invoice = await this.prisma.invoiceRecord.create({
      data: { ...dto, tenantId: user.tenantId, ownerId: user.id },
    })
    return { id: invoice.id, name: `开票申请 ¥${dto.amount}` }
  }

  /** 标记开票完成 */
  async issueInvoice(user: AuthUser, id: string, dto: IssueInvoiceDto) {
    const invoice = await this.ensureInvoice(user, id)
    if (invoice.status !== 'PENDING') throw new BadRequestException('仅待开票状态可操作')
    await this.prisma.invoiceRecord.update({
      where: { id },
      data: { status: 'ISSUED', invoiceNo: dto.invoiceNo, issuedAt: new Date() },
    })
    return { id, name: `发票 ${dto.invoiceNo}` }
  }

  async voidInvoice(user: AuthUser, id: string) {
    await this.ensureInvoice(user, id)
    await this.prisma.invoiceRecord.update({ where: { id }, data: { status: 'VOID' } })
    return { id, name: '发票作废' }
  }

  private async ensureTitle(user: AuthUser, id: string) {
    const title = await this.prisma.invoiceTitle.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!title) throw new NotFoundException('工商抬头不存在')
    return title
  }

  private async ensureInvoice(user: AuthUser, id: string) {
    const invoice = await this.prisma.invoiceRecord.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!invoice) throw new NotFoundException('发票记录不存在')
    return invoice
  }
}
