import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ContractVO, FieldVO, PaginatedResult, lineAmount } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { generateBizCode } from '../../common/code-gen'
import { LineItemDto } from '../../common/dto/line-item.dto'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Contract, ContractItem, InvoiceStatus, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalsService } from '../approvals/approvals.service'
import { MetadataService } from '../metadata/metadata.service'
import { ChangeContractStatusDto, CreateContractDto, QueryContractsDto, UpdateContractDto } from './dto/contract.dto'

const MODULE = 'contract'

type ContractWithRefs = Contract & {
  items: ContractItem[]
  customer: { name: string }
  receivableRecords: { amount: Prisma.Decimal; approvalStatus: string }[]
  invoices: { amount: Prisma.Decimal; status: InvoiceStatus }[]
}

const contractInclude = {
  items: { orderBy: { sort: 'asc' as const } },
  customer: { select: { name: true } },
  receivableRecords: { select: { amount: true, approvalStatus: true } },
  invoices: { select: { amount: true, status: true } },
} as const

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly approvals: ApprovalsService,
  ) {}

  async findAll(user: AuthUser, query: QueryContractsDto): Promise<PaginatedResult<ContractVO>> {
    const { page = 1, pageSize = 10, keyword, status, customerId } = query
    const [scope, fields] = await Promise.all([
      this.dataScope.scopeFilter(user),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    const where: Prisma.ContractWhereInput = {
      tenantId: user.tenantId,
      AND: [scope as Prisma.ContractWhereInput, ...(filterClauses as Prisma.ContractWhereInput[])],
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
      this.prisma.contract.findMany({
        where,
        include: contractInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contract.count({ where }),
    ])
    const ownerMap = await this.userNames(items.map((c) => c.ownerId))
    return { items: items.map((c) => this.toVO(c, fields, ownerMap)), total, page, pageSize }
  }

  async findOne(user: AuthUser, id: string): Promise<ContractVO> {
    const [contract, fields] = await Promise.all([
      this.prisma.contract.findFirst({
        where: { id, tenantId: user.tenantId },
        include: contractInclude,
      }),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    if (!contract) throw new NotFoundException('合同不存在')
    const ownerMap = await this.userNames([contract.ownerId])
    return this.toVO(contract, fields, ownerMap)
  }

  async create(user: AuthUser, dto: CreateContractDto): Promise<ContractVO> {
    const { customData, items, ownerId, fromQuoteId, signedAt, startAt, endAt, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    await this.ensureCustomer(user, dto.customerId)
    const owner = await this.resolveOwner(user, ownerId)

    // 从报价单创建：复制明细
    let sourceItems: LineItemDto[] = items ?? []
    if (fromQuoteId && sourceItems.length === 0) {
      const quote = await this.prisma.quote.findFirst({
        where: { id: fromQuoteId, tenantId: user.tenantId },
        include: { items: true },
      })
      if (!quote) throw new BadRequestException('报价单不存在')
      sourceItems = quote.items.map((item) => ({
        productId: item.productId ?? undefined,
        productName: item.productName,
        unit: item.unit ?? undefined,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
      }))
    }
    const normalized = this.normalizeItems(sourceItems)

    const contract = await this.prisma.contract.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        code: generateBizCode('HT'),
        quoteId: fromQuoteId,
        amount: normalized.total,
        signedAt: signedAt ? new Date(signedAt) : null,
        startAt: startAt ? new Date(startAt) : null,
        endAt: endAt ? new Date(endAt) : null,
        ownerId: owner.id,
        deptId: owner.deptId,
        customData: validated as Prisma.InputJsonValue,
        items: { create: normalized.rows },
      },
      include: contractInclude,
    })
    return this.toSingleVO(user, contract)
  }

  async update(user: AuthUser, id: string, dto: UpdateContractDto): Promise<ContractVO> {
    const existing = await this.ensureInScope(user, id)
    if (existing.status !== 'DRAFT') throw new BadRequestException('仅草稿状态的合同可编辑')
    const { customData, items, ownerId, fromQuoteId: _ignored, signedAt, startAt, endAt, customerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })
    if (customerId) await this.ensureCustomer(user, customerId)

    const data: Prisma.ContractUpdateInput = {
      ...rest,
      ...(customerId ? { customerId } : {}),
      ...(signedAt !== undefined ? { signedAt: signedAt ? new Date(signedAt) : null } : {}),
      ...(startAt !== undefined ? { startAt: startAt ? new Date(startAt) : null } : {}),
      ...(endAt !== undefined ? { endAt: endAt ? new Date(endAt) : null } : {}),
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
      data.amount = normalized.total
      data.items = { deleteMany: {}, create: normalized.rows }
    }

    const contract = await this.prisma.contract.update({
      where: { id },
      data,
      include: contractInclude,
    })
    return this.toSingleVO(user, contract)
  }

  async changeStatus(user: AuthUser, id: string, dto: ChangeContractStatusDto) {
    const contract = await this.ensureInScope(user, id)
    // 配置了审批流的合同必须审批通过后自动生效
    if (
      dto.status === 'EXECUTING' &&
      contract.approvalStatus !== 'APPROVED' &&
      (await this.approvals.flowRequired(user.tenantId, 'contract', Number(contract.amount)))
    ) {
      throw new BadRequestException('该合同需要审批，请点击"提交审批"')
    }
    await this.prisma.contract.update({ where: { id }, data: { status: dto.status } })
    return { id, name: contract.name, status: dto.status }
  }

  async remove(user: AuthUser, id: string) {
    const contract = await this.ensureInScope(user, id)
    if (contract.status !== 'DRAFT') throw new BadRequestException('仅草稿状态的合同可删除')
    await this.prisma.contract.delete({ where: { id } })
    return { id, name: contract.name }
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

  async ensureInScope(user: AuthUser, id: string) {
    const scope = await this.dataScope.scopeFilter(user)
    const contract = await this.prisma.contract.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope as Prisma.ContractWhereInput] },
    })
    if (!contract) throw new NotFoundException('合同不存在或不在你的数据范围内')
    return contract
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

  private async toSingleVO(user: AuthUser, contract: ContractWithRefs): Promise<ContractVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const ownerMap = await this.userNames([contract.ownerId])
    return this.toVO(contract, fields, ownerMap)
  }

  private toVO(
    contract: ContractWithRefs,
    fields: FieldVO[],
    ownerMap: Map<string, string>,
  ): ContractVO {
    const customData = (contract.customData as Record<string, unknown> | null) ?? {}
    // 审批中/被驳回的回款不计入已回款
    const paidAmount =
      Math.round(
        contract.receivableRecords
          .filter((r) => r.approvalStatus === 'NONE' || r.approvalStatus === 'APPROVED')
          .reduce((sum, r) => sum + Number(r.amount), 0) * 100,
      ) / 100
    const invoicedAmount =
      Math.round(
        contract.invoices
          .filter((i) => i.status === 'ISSUED')
          .reduce((sum, i) => sum + Number(i.amount), 0) * 100,
      ) / 100
    const record: Record<string, unknown> = {
      name: contract.name,
      amount: Number(contract.amount),
      paidAmount,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: contract.id,
      code: contract.code,
      name: contract.name,
      customerId: contract.customerId,
      customerName: contract.customer.name,
      opportunityId: contract.opportunityId,
      quoteId: contract.quoteId,
      amount: Number(contract.amount),
      paidAmount,
      invoicedAmount,
      status: contract.status,
      approvalStatus: contract.approvalStatus,
      signedAt: contract.signedAt?.toISOString().slice(0, 10) ?? null,
      startAt: contract.startAt?.toISOString().slice(0, 10) ?? null,
      endAt: contract.endAt?.toISOString().slice(0, 10) ?? null,
      remark: contract.remark,
      ownerId: contract.ownerId,
      ownerName: contract.ownerId ? (ownerMap.get(contract.ownerId) ?? null) : null,
      customData: { ...customData, ...formulas },
      items: contract.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discount: Number(item.discount),
        amount: Number(item.amount),
      })),
      createdAt: contract.createdAt.toISOString(),
    }
  }
}
