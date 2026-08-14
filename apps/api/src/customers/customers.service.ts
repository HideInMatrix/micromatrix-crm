import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  CustomerRelatedVO,
  CustomerVO,
  DuplicateHitVO,
  FieldVO,
  PaginatedResult,
} from '@micromatrix/shared'
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
import { CheckDuplicateQueryDto, QueryCustomersDto } from './dto/query-customers.dto'
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
        where: await this.accessibleWhere(user, id),
        include: ownerInclude,
      }),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    if (!customer) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return this.toVO(customer, fields)
  }

  /** 名称模糊 + 电话精确，命中客户/联系人/线索/商机；非数据范围仅露负责人 */
  async checkDuplicate(user: AuthUser, query: CheckDuplicateQueryDto): Promise<DuplicateHitVO[]> {
    const name = query.name?.trim()
    const phone = query.phone?.trim()
    if (!name && !phone) throw new BadRequestException('请输入客户名称或电话')

    const [customers, contacts, leads, opportunities] = await Promise.all([
      this.prisma.customer.findMany({
        where: {
          tenantId: user.tenantId,
          OR: [
            ...(name ? [{ name: { contains: name, mode: 'insensitive' as const } }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
        include: { owner: { select: { name: true } } },
        take: 10,
      }),
      this.prisma.contact.findMany({
        where: {
          tenantId: user.tenantId,
          OR: [
            ...(name ? [{ name: { contains: name, mode: 'insensitive' as const } }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
        include: { customer: { select: { id: true, name: true, ownerId: true, inSea: true } } },
        take: 10,
      }),
      this.prisma.lead.findMany({
        where: {
          tenantId: user.tenantId,
          status: { not: 'INVALID' },
          OR: [
            ...(name ? [{ name: { contains: name, mode: 'insensitive' as const } }] : []),
            ...(phone ? [{ phone }] : []),
          ],
        },
        take: 10,
      }),
      name
        ? this.prisma.opportunity.findMany({
            where: {
              tenantId: user.tenantId,
              name: { contains: name, mode: 'insensitive' },
            },
            include: { customer: { select: { name: true } } },
            take: 10,
          })
        : Promise.resolve([]),
    ])

    const customerIds = [
      ...customers.map((c) => c.id),
      ...contacts.map((c) => c.customerId),
    ]
    const [inScopeCustomers, inScopeLeads, inScopeOpps, ownerMap] = await Promise.all([
      this.inScopeCustomerIds(user, customerIds),
      this.inScopeLeadIds(user, leads.map((l) => l.id)),
      this.inScopeOpportunityIds(user, opportunities.map((o) => o.id)),
      this.userNames([
        ...customers.map((c) => c.ownerId),
        ...contacts.map((c) => c.customer.ownerId),
        ...leads.map((l) => l.ownerId),
        ...opportunities.map((o) => o.ownerId),
      ]),
    ])

    const hits: DuplicateHitVO[] = []
    for (const row of customers) {
      const inScope = inScopeCustomers.has(row.id)
      hits.push({
        id: row.id,
        source: 'customer',
        name: inScope ? row.name : null,
        phone: inScope ? row.phone : null,
        ownerName: row.owner?.name ?? null,
        inSea: row.inSea,
        inScope,
      })
    }
    for (const row of contacts) {
      const inScope = inScopeCustomers.has(row.customerId)
      hits.push({
        id: row.id,
        source: 'contact',
        name: inScope ? `${row.name}（${row.customer.name}）` : null,
        phone: inScope ? row.phone : null,
        ownerName: ownerMap.get(row.customer.ownerId ?? '') ?? null,
        inSea: row.customer.inSea,
        inScope,
      })
    }
    for (const row of leads) {
      const inScope = inScopeLeads.has(row.id)
      hits.push({
        id: row.id,
        source: 'lead',
        name: inScope ? row.name : null,
        phone: inScope ? row.phone : null,
        ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
        inSea: row.inPool,
        inScope,
      })
    }
    for (const row of opportunities) {
      const inScope = inScopeOpps.has(row.id)
      hits.push({
        id: row.id,
        source: 'opportunity',
        name: inScope ? `${row.name}（${row.customer.name}）` : null,
        phone: null,
        ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
        inSea: false,
        inScope,
      })
    }
    return hits.slice(0, 20)
  }

  async related(user: AuthUser, id: string): Promise<CustomerRelatedVO> {
    await this.ensureAccessible(user, id)
    const [contacts, opportunities, contracts, followUps, team] = await Promise.all([
      this.prisma.contact.findMany({
        where: { tenantId: user.tenantId, customerId: id },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.opportunity.findMany({
        where: { tenantId: user.tenantId, customerId: id },
        include: { stage: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.contract.findMany({
        where: { tenantId: user.tenantId, customerId: id },
        include: {
          receivableRecords: { select: { amount: true, approvalStatus: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.followUpRecord.findMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.customerTeamMember.findMany({
        where: { tenantId: user.tenantId, customerId: id },
        orderBy: { createdAt: 'asc' },
      }),
    ])

    const [ownerMap, attachMap] = await Promise.all([
      this.userNames([
        ...opportunities.map((o) => o.ownerId),
        ...team.map((m) => m.userId),
      ]),
      this.attachmentMap(
        user.tenantId,
        'follow-up',
        followUps.map((f) => f.id),
      ),
    ])

    const contractRows = contracts.map((c) => {
      const paidAmount =
        Math.round(
          c.receivableRecords
            .filter((r) => r.approvalStatus === 'NONE' || r.approvalStatus === 'APPROVED')
            .reduce((sum, r) => sum + Number(r.amount), 0) * 100,
        ) / 100
      return {
        id: c.id,
        name: c.name,
        amount: Number(c.amount),
        paidAmount,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
      }
    })

    return {
      stats: {
        opportunityCount: opportunities.length,
        opportunityAmount:
          Math.round(opportunities.reduce((sum, o) => sum + Number(o.amount ?? 0), 0) * 100) / 100,
        contractCount: contracts.length,
        contractAmount:
          Math.round(contractRows.reduce((sum, c) => sum + c.amount, 0) * 100) / 100,
        paidAmount: Math.round(contractRows.reduce((sum, c) => sum + c.paidAmount, 0) * 100) / 100,
      },
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        position: c.position,
        phone: c.phone,
        email: c.email,
      })),
      opportunities: opportunities.map((o) => ({
        id: o.id,
        name: o.name,
        amount: o.amount ? Number(o.amount) : null,
        stageName: o.stage.name,
        ownerName: o.ownerId ? (ownerMap.get(o.ownerId) ?? null) : null,
        createdAt: o.createdAt.toISOString(),
      })),
      contracts: contractRows,
      followUps: followUps.map((r) => ({
        id: r.id,
        targetType: r.targetType as 'customer',
        targetId: r.targetId,
        type: r.type,
        content: r.content,
        nextFollowAt: r.nextFollowAt?.toISOString() ?? null,
        ownerId: r.ownerId,
        ownerName: r.ownerName,
        createdAt: r.createdAt.toISOString(),
        attachments: attachMap.get(r.id) ?? [],
      })),
      team: team.map((m) => ({
        id: m.id,
        userId: m.userId,
        userName: ownerMap.get(m.userId) ?? '未知',
        role: m.role,
        createdAt: m.createdAt.toISOString(),
      })),
    }
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

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))]
    if (unique.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  private async findExactCustomerDuplicate(user: AuthUser, name: string, phone?: string) {
    return this.prisma.customer.findFirst({
      where: {
        tenantId: user.tenantId,
        OR: [
          { name: { equals: name, mode: 'insensitive' } },
          ...(phone ? [{ phone }] : []),
        ],
      },
      select: { id: true, name: true },
    })
  }

  private async inScopeCustomerIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.scopeFilter(user)
    const rows = await this.prisma.customer.findMany({
      where: {
        id: { in: unique },
        tenantId: user.tenantId,
        OR: [{ inSea: true }, scope as Prisma.CustomerWhereInput],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async inScopeLeadIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.scopeFilter(user)
    const rows = await this.prisma.lead.findMany({
      where: {
        id: { in: unique },
        tenantId: user.tenantId,
        OR: [{ inPool: true }, scope as Prisma.LeadWhereInput],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async inScopeOpportunityIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.scopeFilter(user)
    const rows = await this.prisma.opportunity.findMany({
      where: {
        id: { in: unique },
        tenantId: user.tenantId,
        AND: [scope as Prisma.OpportunityWhereInput],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async attachmentMap(tenantId: string, targetType: string, targetIds: string[]) {
    const map = new Map<string, { id: string; name: string; size: number; mime: string | null; targetType: string | null; targetId: string | null; uploaderId: string | null; createdAt: string }[]>()
    if (targetIds.length === 0) return map
    const rows = await this.prisma.attachment.findMany({
      where: { tenantId, targetType, targetId: { in: targetIds } },
      orderBy: { createdAt: 'asc' },
    })
    for (const row of rows) {
      if (!row.targetId) continue
      const list = map.get(row.targetId) ?? []
      list.push({
        id: row.id,
        name: row.name,
        size: row.size,
        mime: row.mime,
        targetType: row.targetType,
        targetId: row.targetId,
        uploaderId: row.uploaderId,
        createdAt: row.createdAt.toISOString(),
      })
      map.set(row.targetId, list)
    }
    return map
  }

  private async accessibleWhere(user: AuthUser, id: string): Promise<Prisma.CustomerWhereInput> {
    const scope = await this.dataScope.scopeFilter(user)
    return {
      id,
      tenantId: user.tenantId,
      OR: [{ inSea: true }, scope as Prisma.CustomerWhereInput],
    }
  }

  private async ensureAccessible(user: AuthUser, id: string) {
    const found = await this.prisma.customer.findFirst({
      where: await this.accessibleWhere(user, id),
      select: { id: true, name: true },
    })
    if (!found) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return found
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
        const name = String(rest.name ?? '').trim()
        const phone = rest.phone ? String(rest.phone).trim() : undefined
        if (!name) throw new BadRequestException('名称为空')
        const duplicate = await this.findExactCustomerDuplicate(user, name, phone)
        if (duplicate) throw new BadRequestException(`与已有客户「${duplicate.name}」重复`)
        await this.create(user, {
          name,
          industry: rest.industry ? String(rest.industry) : undefined,
          phone,
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
