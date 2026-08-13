import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { FieldVO, LeadVO, PaginatedResult } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { toCsv } from '../../common/csv'
import { formatForExport } from '../../common/export-format'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Lead, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { NotificationsService } from '../notifications/notifications.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { AssignLeadDto, ConvertLeadDto, CreateLeadDto, QueryLeadsDto, UpdateLeadDto } from './dto/lead.dto'

const MODULE = 'lead'

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly notifications: NotificationsService,
    private readonly opportunities: OpportunitiesService,
  ) {}

  async findAll(user: AuthUser, query: QueryLeadsDto): Promise<PaginatedResult<LeadVO>> {
    const { page = 1, pageSize = 10, keyword, scope = 'mine', status } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const filterClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))

    // 线索池对全员开放；非池数据按数据范围过滤
    const scopeClause =
      scope === 'pool' ? { inPool: true } : { inPool: false, ...(await this.dataScope.scopeFilter(user)) }

    const where: Prisma.LeadWhereInput = {
      tenantId: user.tenantId,
      AND: [scopeClause as Prisma.LeadWhereInput, ...(filterClauses as Prisma.LeadWhereInput[])],
      ...(status ? { status } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { contactName: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword } },
            ],
          }
        : {}),
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.lead.count({ where }),
    ])

    const ownerMap = await this.ownerNames(items.map((l) => l.ownerId))
    return { items: items.map((l) => this.toVO(l, fields, ownerMap)), total, page, pageSize }
  }

  async create(user: AuthUser, dto: CreateLeadDto): Promise<LeadVO> {
    const { customData, ownerId, toPool, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const owner = toPool ? null : await this.resolveOwner(user, ownerId)

    const lead = await this.prisma.lead.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        inPool: Boolean(toPool),
        ownerId: owner?.id ?? null,
        deptId: owner?.deptId ?? null,
        customData: validated as Prisma.InputJsonValue,
      },
    })
    if (owner && owner.id !== user.id) {
      await this.notifyAssign(user, lead.id, lead.name, owner.id)
    }
    return this.toSingleVO(user, lead)
  }

  async update(user: AuthUser, id: string, dto: UpdateLeadDto): Promise<LeadVO> {
    const existing = await this.ensureInScope(user, id)
    const { customData, ownerId, toPool: _toPool, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })

    const data: Prisma.LeadUpdateInput = {
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
      await this.notifyAssign(user, existing.id, existing.name, owner.id)
    }

    const lead = await this.prisma.lead.update({ where: { id }, data })
    return this.toSingleVO(user, lead)
  }

  async remove(user: AuthUser, id: string) {
    const lead = await this.ensureInScope(user, id)
    await this.prisma.lead.delete({ where: { id } })
    return { id, name: lead.name }
  }

  /** 退回线索池 */
  async moveToPool(user: AuthUser, id: string) {
    const lead = await this.ensureInScope(user, id)
    if (lead.status !== 'FOLLOWING') throw new BadRequestException('已转化/无效线索不能退回线索池')
    await this.prisma.lead.update({
      where: { id },
      data: { inPool: true, ownerId: null, deptId: null },
    })
    return { id, name: lead.name }
  }

  /** 从线索池领取 */
  async claim(user: AuthUser, id: string) {
    const result = await this.prisma.lead.updateMany({
      where: { id, tenantId: user.tenantId, inPool: true },
      data: { inPool: false, ownerId: user.id, deptId: user.deptId },
    })
    if (result.count === 0) throw new BadRequestException('线索不存在或已被他人领取')
    const lead = await this.prisma.lead.findUnique({ where: { id } })
    return { id, name: lead?.name ?? '' }
  }

  /** 分配负责人（主管操作） */
  async assign(user: AuthUser, id: string, dto: AssignLeadDto) {
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!lead) throw new NotFoundException('线索不存在')
    const owner = await this.resolveOwner(user, dto.ownerId)
    await this.prisma.lead.update({
      where: { id },
      data: { inPool: false, ownerId: owner.id, deptId: owner.deptId },
    })
    await this.notifyAssign(user, lead.id, lead.name, owner.id)
    return { id, name: lead.name }
  }

  async markInvalid(user: AuthUser, id: string) {
    const lead = await this.ensureInScope(user, id)
    await this.prisma.lead.update({ where: { id }, data: { status: 'INVALID' } })
    return { id, name: lead.name }
  }

  /** 一键转化：线索 → 客户（+联系人 +商机） */
  async convert(user: AuthUser, id: string, dto: ConvertLeadDto) {
    const lead = await this.ensureInScope(user, id)
    if (lead.status === 'CONVERTED') throw new BadRequestException('线索已转化')

    const ownerId = lead.ownerId ?? user.id
    const owner = await this.resolveOwner(user, ownerId)
    // 确保商机阶段已初始化（首次使用时）
    if (dto.opportunity) await this.opportunities.listStages(user.tenantId)

    const result = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.create({
        data: {
          tenantId: user.tenantId,
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          ownerId: owner.id,
          deptId: owner.deptId,
        },
      })
      if ((dto.createContact ?? true) && lead.contactName) {
        await tx.contact.create({
          data: {
            tenantId: user.tenantId,
            customerId: customer.id,
            name: lead.contactName,
            phone: lead.phone,
            email: lead.email,
          },
        })
      }
      let opportunityId: string | null = null
      if (dto.opportunity) {
        const firstStage = await tx.opportunityStage.findFirst({
          where: { tenantId: user.tenantId, isWon: false, isLost: false },
          orderBy: { sort: 'asc' },
        })
        if (!firstStage) throw new BadRequestException('请先在商机管理中初始化商机阶段')
        const opportunity = await tx.opportunity.create({
          data: {
            tenantId: user.tenantId,
            name: dto.opportunity.name,
            customerId: customer.id,
            stageId: firstStage.id,
            amount: dto.opportunity.amount,
            ownerId: owner.id,
            deptId: owner.deptId,
          },
        })
        opportunityId = opportunity.id
      }
      await tx.lead.update({
        where: { id },
        data: { status: 'CONVERTED', convertedCustomerId: customer.id, inPool: false },
      })
      return { customerId: customer.id, opportunityId }
    })

    return { id, name: lead.name, ...result }
  }

  /** 导出 CSV */
  async exportCsv(user: AuthUser, query: QueryLeadsDto): Promise<{ filename: string; csv: string }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const columns = fields.filter((f) => f.showInList && !f.hidden)
    const result = await this.findAll(user, { ...query, page: 1, pageSize: 5000 })

    const headers = [...columns.map((c) => c.label), '状态', '创建时间']
    const statusLabels: Record<string, string> = { FOLLOWING: '跟进中', CONVERTED: '已转化', INVALID: '无效' }
    const rows = result.items.map((item) => [
      ...columns.map((c) => formatForExport(c, item as unknown as Record<string, unknown>)),
      statusLabels[item.status] ?? item.status,
      item.createdAt.slice(0, 10),
    ])
    return { filename: `线索导出_${new Date().toISOString().slice(0, 10)}.csv`, csv: toCsv(headers, rows) }
  }

  /** 批量导入 */
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
          contactName: rest.contactName ? String(rest.contactName) : undefined,
          phone: rest.phone ? String(rest.phone) : undefined,
          email: rest.email ? String(rest.email) : undefined,
          toPool: rest.toPool === true,
          customData,
        })
        success++
      } catch (e) {
        errors.push(`第 ${index + 2} 行: ${e instanceof Error ? e.message : '导入失败'}`)
      }
    }
    return { success, failed: errors.length, errors: errors.slice(0, 20), name: `导入线索 ${success} 条` }
  }

  private async notifyAssign(user: AuthUser, leadId: string, leadName: string, ownerId: string) {
    if (ownerId === user.id) return
    await this.notifications.notify(user.tenantId, ownerId, {
      type: 'assign',
      title: '新线索分配给你',
      content: `${user.name} 将线索「${leadName}」分配给你`,
      link: '/leads',
    })
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
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope as Prisma.LeadWhereInput] },
    })
    if (!lead) throw new NotFoundException('线索不存在或不在你的数据范围内')
    return lead
  }

  private async ownerNames(ownerIds: (string | null)[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds.filter((v): v is string => !!v))]
    if (ids.length === 0) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(users.map((u) => [u.id, u.name]))
  }

  private async toSingleVO(user: AuthUser, lead: Lead): Promise<LeadVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const ownerMap = await this.ownerNames([lead.ownerId])
    return this.toVO(lead, fields, ownerMap)
  }

  private toVO(lead: Lead, fields: FieldVO[], ownerMap: Map<string, string>): LeadVO {
    const customData = (lead.customData as Record<string, unknown> | null) ?? {}
    const record: Record<string, unknown> = {
      name: lead.name,
      contactName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: lead.id,
      name: lead.name,
      contactName: lead.contactName,
      phone: lead.phone,
      email: lead.email,
      status: lead.status,
      inPool: lead.inPool,
      ownerId: lead.ownerId,
      ownerName: lead.ownerId ? (ownerMap.get(lead.ownerId) ?? null) : null,
      deptId: lead.deptId,
      customData: { ...customData, ...formulas },
      convertedCustomerId: lead.convertedCustomerId,
      lastFollowedAt: lead.lastFollowedAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    }
  }
}
