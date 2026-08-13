import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { FieldVO, PaginatedResult, QuoteVO, lineAmount } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { generateBizCode } from '../../common/code-gen'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { LineItemDto } from '../../common/dto/line-item.dto'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalsService } from '../approvals/approvals.service'
import { MetadataService } from '../metadata/metadata.service'
import { CreateQuoteDto, QueryQuotesDto, UpdateQuoteDto } from './dto/quote.dto'

const MODULE = 'quote'

type QuoteWithRefs = Prisma.QuoteGetPayload<{
  include: { items: true }
}> & { customerName?: string }

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly approvals: ApprovalsService,
  ) {}

  async findAll(user: AuthUser, query: QueryQuotesDto): Promise<PaginatedResult<QuoteVO>> {
    const { page = 1, pageSize = 10, keyword, status, customerId } = query
    const [scope, fields] = await Promise.all([
      this.dataScope.scopeFilter(user),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    const where: Prisma.QuoteWhereInput = {
      tenantId: user.tenantId,
      AND: [scope as Prisma.QuoteWhereInput, ...(filterClauses as Prisma.QuoteWhereInput[])],
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { code: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.quote.findMany({
        where,
        include: { items: { orderBy: { sort: 'asc' } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.quote.count({ where }),
    ])

    const [customerMap, ownerMap] = await Promise.all([
      this.customerNames(items.map((q) => q.customerId)),
      this.userNames(items.map((q) => q.ownerId)),
    ])
    return {
      items: items.map((q) => this.toVO(q, fields, customerMap, ownerMap)),
      total,
      page,
      pageSize,
    }
  }

  async create(user: AuthUser, dto: CreateQuoteDto): Promise<QuoteVO> {
    const { customData, items, ownerId, validUntil, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    await this.ensureCustomer(user, dto.customerId)
    const owner = await this.resolveOwner(user, ownerId)
    const normalized = this.normalizeItems(items)

    const quote = await this.prisma.quote.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        code: generateBizCode('QT'),
        validUntil: validUntil ? new Date(validUntil) : null,
        totalAmount: normalized.total,
        ownerId: owner.id,
        deptId: owner.deptId,
        customData: validated as Prisma.InputJsonValue,
        items: { create: normalized.rows },
      },
      include: { items: { orderBy: { sort: 'asc' } } },
    })
    return this.toSingleVO(user, quote)
  }

  async update(user: AuthUser, id: string, dto: UpdateQuoteDto): Promise<QuoteVO> {
    const existing = await this.ensureInScope(user, id)
    if (existing.status !== 'DRAFT') throw new BadRequestException('仅草稿状态的报价可编辑')
    const { customData, items, ownerId, validUntil, customerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })
    if (customerId) await this.ensureCustomer(user, customerId)

    const data: Prisma.QuoteUpdateInput = {
      ...rest,
      ...(customerId ? { customerId } : {}),
      ...(validUntil !== undefined ? { validUntil: validUntil ? new Date(validUntil) : null } : {}),
      customData: {
        ...((existing.customData as Record<string, unknown> | null) ?? {}),
        ...validated,
      } as Prisma.InputJsonValue,
    }
    if (ownerId && ownerId !== existing.ownerId) {
      const owner = await this.resolveOwner(user, ownerId)
      data.ownerId = owner.id
      data.deptId = owner.deptId
    }
    if (items) {
      const normalized = this.normalizeItems(items)
      data.totalAmount = normalized.total
      data.items = { deleteMany: {}, create: normalized.rows }
    }

    const quote = await this.prisma.quote.update({
      where: { id },
      data,
      include: { items: { orderBy: { sort: 'asc' } } },
    })
    return this.toSingleVO(user, quote)
  }

  /** 确认 / 作废 */
  async changeStatus(user: AuthUser, id: string, status: 'CONFIRMED' | 'VOID') {
    const quote = await this.ensureInScope(user, id)
    if (quote.status !== 'DRAFT') throw new BadRequestException('仅草稿状态可变更')
    // 配置了审批流的报价必须走审批通过后自动确认
    if (
      status === 'CONFIRMED' &&
      quote.approvalStatus !== 'APPROVED' &&
      (await this.approvals.flowRequired(user.tenantId, 'quote', Number(quote.totalAmount)))
    ) {
      throw new BadRequestException('该报价需要审批，请点击"提交审批"')
    }
    await this.prisma.quote.update({ where: { id }, data: { status } })
    return { id, name: quote.name, status }
  }

  async remove(user: AuthUser, id: string) {
    const quote = await this.ensureInScope(user, id)
    await this.prisma.quote.delete({ where: { id } })
    return { id, name: quote.name }
  }

  private normalizeItems(items: LineItemDto[]) {
    const rows = items.map((item, index) => {
      const discount = item.discount ?? 100
      return {
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discount,
        amount: lineAmount({ quantity: item.quantity, unitPrice: item.unitPrice, discount }),
        sort: index,
      }
    })
    const total = Math.round(rows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100
    return { rows, total }
  }

  private async ensureCustomer(user: AuthUser, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId: user.tenantId },
    })
    if (!customer) throw new BadRequestException('客户不存在')
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, deptId: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async ensureInScope(user: AuthUser, id: string) {
    const scope = await this.dataScope.scopeFilter(user)
    const quote = await this.prisma.quote.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope as Prisma.QuoteWhereInput] },
    })
    if (!quote) throw new NotFoundException('报价不存在或不在你的数据范围内')
    return quote
  }

  private async customerNames(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(customers.map((c) => [c.id, c.name]))
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))]
    if (unique.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  private async toSingleVO(user: AuthUser, quote: QuoteWithRefs): Promise<QuoteVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const customerMap = await this.customerNames([quote.customerId])
    const ownerMap = await this.userNames([quote.ownerId])
    return this.toVO(quote, fields, customerMap, ownerMap)
  }

  private toVO(
    quote: QuoteWithRefs,
    fields: FieldVO[],
    customerMap: Map<string, string>,
    ownerMap: Map<string, string>,
  ): QuoteVO {
    const customData = (quote.customData as Record<string, unknown> | null) ?? {}
    const record: Record<string, unknown> = {
      name: quote.name,
      totalAmount: Number(quote.totalAmount),
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: quote.id,
      code: quote.code,
      name: quote.name,
      customerId: quote.customerId,
      customerName: customerMap.get(quote.customerId),
      opportunityId: quote.opportunityId,
      totalAmount: Number(quote.totalAmount),
      status: quote.status,
      approvalStatus: quote.approvalStatus,
      validUntil: quote.validUntil?.toISOString().slice(0, 10) ?? null,
      remark: quote.remark,
      ownerId: quote.ownerId,
      ownerName: quote.ownerId ? (ownerMap.get(quote.ownerId) ?? null) : null,
      customData: { ...customData, ...formulas },
      items: quote.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        amount: Number(item.amount),
      })),
      createdAt: quote.createdAt.toISOString(),
    }
  }
}
