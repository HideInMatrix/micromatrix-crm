import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  FieldVO,
  ORDER_STATUS_FLOW,
  OrderStatus,
  OrderVO,
  PaginatedResult,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { generateBizCode } from '../../common/code-gen'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ContractsService } from '../contracts/contracts.service'
import { MetadataService } from '../metadata/metadata.service'
import { CreateOrderDto, QueryOrdersDto, UpdateOrderDto } from './dto/order.dto'

const MODULE = 'order'

type OrderWithRefs = Prisma.OrderGetPayload<{
  include: { contract: { select: { name: true; customerId: true } } }
}>

const orderInclude = { contract: { select: { name: true, customerId: true } } } as const

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly contracts: ContractsService,
  ) {}

  async findAll(user: AuthUser, query: QueryOrdersDto): Promise<PaginatedResult<OrderVO>> {
    const { page = 1, pageSize = 10, keyword, status, contractId } = query
    const [scope, fields] = await Promise.all([
      this.dataScope.scopeFilter(user, 'menu:order'),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    const where: Prisma.OrderWhereInput = {
      tenantId: user.tenantId,
      AND: [scope as Prisma.OrderWhereInput, ...(filterClauses as Prisma.OrderWhereInput[])],
      ...(status ? { status } : {}),
      ...(contractId ? { contractId } : {}),
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
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ])

    const [ownerMap, customerMap] = await Promise.all([
      this.userNames(items.map((o) => o.ownerId)),
      this.customerNames(items.map((o) => o.contract.customerId)),
    ])
    return {
      items: items.map((o) => this.toVO(o, fields, ownerMap, customerMap)),
      total,
      page,
      pageSize,
    }
  }

  async create(user: AuthUser, dto: CreateOrderDto): Promise<OrderVO> {
    const { customData, ownerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const contract = await this.contracts.ensureInScope(user, dto.contractId, 'order:create')
    if (contract.status === 'DRAFT') {
      throw new BadRequestException('合同尚未生效（草稿状态），不能创建订单')
    }
    const owner = await this.resolveOwner(user, ownerId)

    const order = await this.prisma.order.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        code: generateBizCode('DD'),
        ownerId: owner.id,
        deptId: owner.deptId,
        customData: validated as Prisma.InputJsonValue,
      },
      include: orderInclude,
    })
    return this.toSingleVO(user, order)
  }

  async update(user: AuthUser, id: string, dto: UpdateOrderDto): Promise<OrderVO> {
    const existing = await this.ensureInScope(user, id, 'order:update')
    const { customData, ownerId, contractId: _ignored, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })
    const data: Prisma.OrderUpdateInput = {
      ...rest,
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
    const order = await this.prisma.order.update({ where: { id }, data, include: orderInclude })
    return this.toSingleVO(user, order)
  }

  /** 状态流转：待交付→交付中→已验收→已完成；取消 */
  async changeStatus(user: AuthUser, id: string, status: OrderStatus) {
    const order = await this.ensureInScope(user, id, 'order:update')
    const allowed = ORDER_STATUS_FLOW[order.status]
    if (!allowed.includes(status)) {
      throw new BadRequestException(`当前状态不允许流转到该状态`)
    }
    await this.prisma.order.update({
      where: { id },
      data: {
        status,
        ...(status === 'DELIVERING' ? { deliveredAt: new Date() } : {}),
        ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
      },
    })
    return { id, name: order.name, status }
  }

  async remove(user: AuthUser, id: string) {
    const order = await this.ensureInScope(user, id, 'order:delete')
    if (order.status !== 'PENDING' && order.status !== 'CANCELED') {
      throw new BadRequestException('仅待交付或已取消的订单可删除')
    }
    await this.prisma.order.delete({ where: { id } })
    return { id, name: order.name }
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const scope = await this.dataScope.scopeFilter(user, permission)
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope as Prisma.OrderWhereInput] },
    })
    if (!order) throw new NotFoundException('订单不存在或不在你的数据范围内')
    return order
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

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))]
    if (unique.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
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

  private async toSingleVO(user: AuthUser, order: OrderWithRefs): Promise<OrderVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const ownerMap = await this.userNames([order.ownerId])
    const customerMap = await this.customerNames([order.contract.customerId])
    return this.toVO(order, fields, ownerMap, customerMap)
  }

  private toVO(
    order: OrderWithRefs,
    fields: FieldVO[],
    ownerMap: Map<string, string>,
    customerMap: Map<string, string>,
  ): OrderVO {
    const customData = (order.customData as Record<string, unknown> | null) ?? {}
    const record: Record<string, unknown> = { name: order.name, amount: Number(order.amount) }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: order.id,
      code: order.code,
      name: order.name,
      contractId: order.contractId,
      contractName: order.contract.name,
      customerName: customerMap.get(order.contract.customerId),
      amount: Number(order.amount),
      status: order.status,
      approvalStatus: order.approvalStatus,
      deliveredAt: order.deliveredAt?.toISOString().slice(0, 10) ?? null,
      acceptedAt: order.acceptedAt?.toISOString().slice(0, 10) ?? null,
      remark: order.remark,
      ownerId: order.ownerId,
      ownerName: order.ownerId ? (ownerMap.get(order.ownerId) ?? null) : null,
      customData: { ...customData, ...formulas },
      createdAt: order.createdAt.toISOString(),
    }
  }
}
