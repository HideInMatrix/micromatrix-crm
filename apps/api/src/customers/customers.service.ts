import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CustomerVO, FieldVO, PaginatedResult } from '@micromatrix/shared'
import type { AuthUser } from '../common/auth-user'
import { toCsv } from '../common/csv'
import { formatForExport } from '../common/export-format'
import { buildFilterClauses, parseFilters } from '../common/filter-builder'
import { DataScopeService } from '../common/services/data-scope.service'
import { Prisma } from '../generated/prisma/client'
import { MetadataService } from '../modules/metadata/metadata.service'
import { NotificationsService } from '../modules/notifications/notifications.service'
import { PrismaService } from '../prisma/prisma.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { QueryCustomersDto } from './dto/query-customers.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'

type CustomerWithOwner = Prisma.CustomerGetPayload<{
  include: { owner: { select: { name: true } } }
}>

const ownerInclude = { owner: { select: { name: true } } } as const
const MODULE = 'customer'

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(user: AuthUser, query: QueryCustomersDto): Promise<PaginatedResult<CustomerVO>> {
    const { page = 1, pageSize = 10, keyword, scope: viewScope = 'mine' } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    // 公海对全员开放；非公海按数据范围过滤
    const scopeClause =
      viewScope === 'sea'
        ? { inSea: true }
        : { inSea: false, ...(await this.dataScope.scopeFilter(user)) }

    const where: Prisma.CustomerWhereInput = {
      tenantId: user.tenantId,
      AND: [scopeClause as Prisma.CustomerWhereInput, ...(filterClauses as Prisma.CustomerWhereInput[])],
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword } },
              { email: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: ownerInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ])

    return { items: items.map((c) => this.toVO(c, fields)), total, page, pageSize }
  }

  async findOne(user: AuthUser, id: string): Promise<CustomerVO> {
    const [customer, fields] = await Promise.all([
      this.prisma.customer.findFirst({
        where: await this.scopedWhere(user, id),
        include: ownerInclude,
      }),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    if (!customer) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return this.toVO(customer, fields)
  }

  async create(user: AuthUser, dto: CreateCustomerDto): Promise<CustomerVO> {
    const { customData, ownerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const owner = await this.resolveOwner(user, ownerId)

    const customer = await this.prisma.customer.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        ownerId: owner.id,
        deptId: owner.deptId,
        customData: validated as Prisma.InputJsonValue,
      },
      include: ownerInclude,
    })
    return this.toVO(customer, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerDto): Promise<CustomerVO> {
    const existing = await this.ensureInScope(user, id)
    const { customData, ownerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })

    const data: Prisma.CustomerUpdateInput = {
      ...rest,
      customData: {
        ...((existing.customData as Record<string, unknown> | null) ?? {}),
        ...validated,
      } as Prisma.InputJsonValue,
    }
    // 负责人变更时同步归属部门
    if (ownerId && ownerId !== existing.ownerId) {
      const owner = await this.resolveOwner(user, ownerId)
      data.owner = { connect: { id: owner.id } }
      data.deptId = owner.deptId
    }

    const customer = await this.prisma.customer.update({
      where: { id },
      data,
      include: ownerInclude,
    })
    return this.toVO(customer, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async remove(user: AuthUser, id: string): Promise<{ id: string; name: string }> {
    const customer = await this.ensureInScope(user, id)
    await this.prisma.customer.delete({ where: { id } })
    return { id, name: customer.name }
  }

  /** 退回公海 */
  async moveToSea(user: AuthUser, id: string) {
    const customer = await this.ensureInScope(user, id)
    await this.prisma.customer.update({
      where: { id },
      data: { inSea: true, ownerId: null, deptId: null },
    })
    return { id, name: customer.name }
  }

  /** 从公海领取 */
  async claimFromSea(user: AuthUser, id: string) {
    const result = await this.prisma.customer.updateMany({
      where: { id, tenantId: user.tenantId, inSea: true },
      data: { inSea: false, ownerId: user.id, deptId: user.deptId },
    })
    if (result.count === 0) throw new BadRequestException('客户不存在或已被他人领取')
    const customer = await this.prisma.customer.findUnique({ where: { id } })
    return { id, name: customer?.name ?? '' }
  }

  /** 分配负责人 */
  async assignOwner(user: AuthUser, id: string, ownerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenantId: user.tenantId },
    })
    if (!customer) throw new NotFoundException('客户不存在')
    const owner = await this.resolveOwner(user, ownerId)
    await this.prisma.customer.update({
      where: { id },
      data: { inSea: false, ownerId: owner.id, deptId: owner.deptId },
    })
    if (owner.id !== user.id) {
      await this.notifications.notify(user.tenantId, owner.id, {
        type: 'assign',
        title: '新客户分配给你',
        content: `${user.name} 将客户「${customer.name}」分配给你`,
        link: '/customers',
      })
    }
    return { id, name: customer.name }
  }

  // ===== 团队成员 =====

  async teamList(user: AuthUser, customerId: string) {
    await this.ensureInScope(user, customerId)
    const members = await this.prisma.customerTeamMember.findMany({
      where: { tenantId: user.tenantId, customerId },
      orderBy: { createdAt: 'asc' },
    })
    const userMap = await this.userNames(members.map((m) => m.userId))
    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      userName: userMap.get(m.userId) ?? '未知',
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    }))
  }

  async teamAdd(user: AuthUser, customerId: string, userId: string, role?: string) {
    const customer = await this.ensureInScope(user, customerId)
    const exists = await this.prisma.customerTeamMember.findFirst({
      where: { customerId, userId },
    })
    if (exists) throw new BadRequestException('该成员已在团队中')
    await this.prisma.customerTeamMember.create({
      data: { tenantId: user.tenantId, customerId, userId, role },
    })
    if (userId !== user.id) {
      await this.notifications.notify(user.tenantId, userId, {
        type: 'assign',
        title: '你被加入客户协作团队',
        content: `${user.name} 邀请你协作跟进客户「${customer.name}」`,
        link: '/customers',
      })
    }
    return { id: customerId, name: customer.name }
  }

  async teamRemove(user: AuthUser, customerId: string, memberId: string) {
    await this.ensureInScope(user, customerId)
    await this.prisma.customerTeamMember.deleteMany({
      where: { id: memberId, tenantId: user.tenantId, customerId },
    })
    return { id: memberId }
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  /** 导出 CSV（按字段配置的列表列） */
  async exportCsv(user: AuthUser, query: QueryCustomersDto): Promise<{ filename: string; csv: string }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const columns = fields.filter((f) => f.showInList && !f.hidden)
    const result = await this.findAll(user, { ...query, page: 1, pageSize: 5000 })

    const headers = [...columns.map((c) => c.label), '创建时间']
    const rows = result.items.map((item) => [
      ...columns.map((c) => formatForExport(c, item as unknown as Record<string, unknown>)),
      item.createdAt.slice(0, 10),
    ])
    return { filename: `客户导出_${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(headers, rows) }
  }

  /** 批量导入（前端解析 CSV 后传结构化行） */
  async bulkImport(user: AuthUser, rows: Record<string, unknown>[]) {
    if (rows.length === 0) throw new BadRequestException('没有可导入的数据')
    if (rows.length > 500) throw new BadRequestException('单次最多导入 500 行')
    let success = 0
    const errors: string[] = []
    for (const [index, row] of rows.entries()) {
      try {
        const { customData, ...rest } = row as { customData?: Record<string, unknown> } & Record<string, unknown>
        await this.create(user, {
          name: String(rest.name ?? ''),
          industry: rest.industry ? String(rest.industry) : undefined,
          phone: rest.phone ? String(rest.phone) : undefined,
          email: rest.email ? String(rest.email) : undefined,
          remark: rest.remark ? String(rest.remark) : undefined,
          customData,
        })
        success++
      } catch (e) {
        errors.push(`第 ${index + 2} 行: ${e instanceof Error ? e.message : '导入失败'}`)
      }
    }
    return { success, failed: errors.length, errors: errors.slice(0, 20), name: `导入客户 ${success} 条` }
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

  private async scopedWhere(user: AuthUser, id: string): Promise<Prisma.CustomerWhereInput> {
    const scope = await this.dataScope.scopeFilter(user)
    return { id, tenantId: user.tenantId, AND: [scope] }
  }

  private async ensureInScope(user: AuthUser, id: string) {
    const found = await this.prisma.customer.findFirst({
      where: await this.scopedWhere(user, id),
      select: { id: true, name: true, ownerId: true, customData: true },
    })
    if (!found) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return found
  }

  private toVO(customer: CustomerWithOwner, fields: FieldVO[]): CustomerVO {
    const customData = (customer.customData as Record<string, unknown> | null) ?? {}
    const record: Record<string, unknown> = {
      name: customer.name,
      industry: customer.industry,
      phone: customer.phone,
      email: customer.email,
      remark: customer.remark,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)

    return {
      id: customer.id,
      name: customer.name,
      industry: customer.industry,
      phone: customer.phone,
      email: customer.email,
      remark: customer.remark,
      ownerId: customer.ownerId,
      ownerName: customer.owner?.name ?? null,
      deptId: customer.deptId,
      customData: { ...customData, ...formulas },
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    }
  }
}
