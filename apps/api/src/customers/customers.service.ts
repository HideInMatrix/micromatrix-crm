import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  Customer360Resource,
  CustomerRelatedVO,
  CustomerVO,
  DuplicateHitVO,
  FieldVO,
  ImportResultVO,
  PaginatedResult,
  ReceivablePlanStatus,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../common/auth-user'
import { toCsv } from '../common/csv'
import type {
  BatchAffectResult,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../common/dto/resource-batch.dto'
import { formatForExport } from '../common/export-format'
import { buildFilterClauses, parseFilters } from '../common/filter-builder'
import { DataScopeService } from '../common/services/data-scope.service'
import { BusinessChangeLogService } from '../common/services/business-change-log.service'
import { Prisma } from '../generated/prisma/client'
import { MetadataService } from '../modules/metadata/metadata.service'
import { ExportTasksService } from '../modules/import-export/export-tasks.service'
import type { ImportType } from '../modules/import-export/dto/import-export.dto'
import { SpreadsheetService } from '../modules/import-export/spreadsheet.service'
import { BusinessNotificationsService } from '../modules/notifications/business-notifications.service'
import { ResourcePoolsService } from '../modules/pool-rules/resource-pools.service'
import { SavedViewsService } from '../modules/saved-views/saved-views.service'
import { PrismaService } from '../prisma/prisma.service'
import { CustomerAccessService } from './customer-access.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import type { SaveCustomerRelationDto } from './dto/customer-relation.dto'
import { CustomerMergeDto } from './dto/customer-merge.dto'
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
    private readonly notifications: BusinessNotificationsService,
    private readonly pools: ResourcePoolsService,
    private readonly changeLog: BusinessChangeLogService,
    private readonly savedViews: SavedViewsService,
    private readonly customerAccess: CustomerAccessService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  async findAll(user: AuthUser, query: QueryCustomersDto): Promise<PaginatedResult<CustomerVO>> {
    const { page = 1, pageSize = 10, keyword } = query
    const poolMode = query.scope === 'sea'
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const adHocClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))
    const viewModule = poolMode ? 'customer_pool' : 'customer'
    const saved = query.viewId
      ? await this.savedViews.resolveFilters(user, query.viewId, viewModule)
      : null
    const savedClauses = saved ? buildFilterClauses(fieldsMap, saved.conditions) : []
    const filterClauses = [
      ...(savedClauses.length === 0
        ? []
        : saved?.searchMode === 'OR'
          ? [{ OR: savedClauses }]
          : savedClauses),
      ...adHocClauses,
    ]

    // 公海按 Pool scope；普通客户页使用 Cordys 系统视图，并始终受当前角色数据权限约束。
    let scopeClause: Prisma.CustomerWhereInput
    if (poolMode) {
      const options = await this.pools.options(user, 'customer')
      const accessiblePoolIds = options.map((pool) => pool.id)
      if (query.poolId && !accessiblePoolIds.includes(query.poolId)) {
        throw new BadRequestException('你无权访问该公海')
      }
      scopeClause = query.poolId
        ? { inSea: true, poolId: query.poolId }
        : { inSea: true, OR: [{ poolId: { in: accessiblePoolIds } }, { poolId: null }] }
    } else {
      scopeClause = { inSea: false, ...(await this.resolveListScope(user, query.view)) }
    }

    const where: Prisma.CustomerWhereInput = {
      tenantId: user.tenantId,
      AND: [
        scopeClause as Prisma.CustomerWhereInput,
        ...(filterClauses as Prisma.CustomerWhereInput[]),
      ],
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

  /** Cordys /account/tab：决定“全部客户 / 部门客户”系统视图是否显示。 */
  tab(user: AuthUser) {
    const roles = user.roles.filter((role) => hasPermission(role.permissions, 'menu:customer'))
    return {
      all: roles.some((role) => role.dataScope === 'ALL' || role.dataScope === 'CUSTOM'),
      dept: roles.some((role) => ['ALL', 'DEPT_AND_CHILD', 'CUSTOM'].includes(role.dataScope)),
    }
  }

  async findOne(user: AuthUser, id: string): Promise<CustomerVO> {
    const access = await this.customerAccess.assertRead(user, id)
    const [customer, fields] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id, tenantId: user.tenantId },
        include: ownerInclude,
      }),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    if (!customer) throw new NotFoundException('客户不存在或不在你的数据范围内')
    return {
      ...this.toVO(customer, fields),
      collaborationType: !access.dataScope && !access.pool ? access.collaborationType : null,
      canManageCustomer: access.canManageCustomer,
      canCollaborateWrite: access.canCollaborateWrite,
    }
  }

  /** Cordys /customer/option 语义：仅返回租户内客户 id/name，不下推 owner 数据范围。 */
  async customerOptions(user: AuthUser, keyword?: string) {
    const value = keyword?.trim()
    return this.prisma.customer.findMany({
      where: {
        tenantId: user.tenantId,
        ...(value ? { name: { contains: value, mode: 'insensitive' } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 50,
    })
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

    const customerIds = [...customers.map((c) => c.id), ...contacts.map((c) => c.customerId)]
    const [inScopeCustomers, inScopeLeads, inScopeOpps, ownerMap] = await Promise.all([
      this.inScopeCustomerIds(user, customerIds),
      this.inScopeLeadIds(
        user,
        leads.map((l) => l.id),
      ),
      this.inScopeOpportunityIds(
        user,
        opportunities.map((o) => o.id),
      ),
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
    const access = await this.customerAccess.assertRead(user, id)
    const contactWhere: Prisma.ContactWhereInput = {
      tenantId: user.tenantId,
      customerId: id,
      ...(!access.dataScope && !access.pool && access.collaborationType === 'COLLABORATION'
        ? { ownerId: user.id }
        : {}),
    }
    const isOpenSea = access.customer.inSea
    const canReadContacts =
      !isOpenSea &&
      hasPermission(user.permissions, 'contact:read') &&
      (access.dataScope || access.pool || access.collaborationType === 'COLLABORATION')
    const canReadOpportunities = !isOpenSea && hasPermission(user.permissions, 'menu:opportunity')
    const canReadContracts = !isOpenSea && hasPermission(user.permissions, 'menu:contract')
    const canReadTeam = !isOpenSea && access.collaborationType === null
    const [contacts, opportunities, contracts, followUps, team] = await Promise.all([
      canReadContacts
        ? this.prisma.contact.findMany({ where: contactWhere, orderBy: { createdAt: 'asc' } })
        : Promise.resolve([]),
      canReadOpportunities
        ? this.prisma.opportunity.findMany({
            where: { tenantId: user.tenantId, customerId: id },
            include: { stage: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
      canReadContracts
        ? this.prisma.contract.findMany({
            where: { tenantId: user.tenantId, customerId: id },
            include: {
              receivableRecords: { select: { amount: true, approvalStatus: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          })
        : Promise.resolve([]),
      this.prisma.followUpRecord.findMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      canReadTeam
        ? this.prisma.customerTeamMember.findMany({
            where: { tenantId: user.tenantId, customerId: id },
            orderBy: { createdAt: 'asc' },
          })
        : Promise.resolve([]),
    ])

    const [ownerMap, attachMap] = await Promise.all([
      this.userNames([...opportunities.map((o) => o.ownerId), ...team.map((m) => m.userId)]),
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
        contractAmount: Math.round(contractRows.reduce((sum, c) => sum + c.amount, 0) * 100) / 100,
        paidAmount: Math.round(contractRows.reduce((sum, c) => sum + c.paidAmount, 0) * 100) / 100,
      },
      contacts: contacts.map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone,
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
        collaborationType: m.collaborationType as 'READ_ONLY' | 'COLLABORATION',
        createdAt: m.createdAt.toISOString(),
      })),
    }
  }

  async relatedResource(
    user: AuthUser,
    id: string,
    resource: Customer360Resource,
    page = 1,
    pageSize = 10,
  ): Promise<PaginatedResult<Record<string, unknown>>> {
    const access = await this.customerAccess.assertRead(user, id)
    if (access.customer.inSea) {
      throw new ForbiddenException('客户公海详情不提供该 360 业务资源')
    }
    this.assert360ResourcePermission(user, resource)

    const take = Math.min(Math.max(pageSize, 1), 100)
    const currentPage = Math.max(page, 1)
    const skip = (currentPage - 1) * take

    if (resource === 'opportunities') {
      const where: Prisma.OpportunityWhereInput = { tenantId: user.tenantId, customerId: id }
      const [rows, total] = await Promise.all([
        this.prisma.opportunity.findMany({
          where,
          include: { stage: true },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.opportunity.count({ where }),
      ])
      const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
      return {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          amount: row.amount === null ? null : Number(row.amount),
          stageName: row.stage.name,
          ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'contracts') {
      const where: Prisma.ContractWhereInput = { tenantId: user.tenantId, customerId: id }
      const [rows, total] = await Promise.all([
        this.prisma.contract.findMany({
          where,
          include: {
            receivableRecords: { select: { amount: true, approvalStatus: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.contract.count({ where }),
      ])
      const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
      return {
        items: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          amount: Number(row.amount),
          paidAmount:
            Math.round(
              row.receivableRecords
                .filter(
                  (record) =>
                    record.approvalStatus === 'NONE' || record.approvalStatus === 'APPROVED',
                )
                .reduce((sum, record) => sum + Number(record.amount), 0) * 100,
            ) / 100,
          status: row.status,
          approvalStatus: row.approvalStatus,
          ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'receivablePlans') {
      const where: Prisma.ReceivablePlanWhereInput = {
        tenantId: user.tenantId,
        contract: { customerId: id },
      }
      const [rows, total] = await Promise.all([
        this.prisma.receivablePlan.findMany({
          where,
          include: {
            contract: { select: { name: true } },
            records: { select: { amount: true, approvalStatus: true } },
          },
          orderBy: [{ dueDate: 'asc' }, { period: 'asc' }],
          skip,
          take,
        }),
        this.prisma.receivablePlan.count({ where }),
      ])
      return {
        items: rows.map((row) => {
          const paidAmount =
            Math.round(
              row.records
                .filter(
                  (record) =>
                    record.approvalStatus === 'NONE' || record.approvalStatus === 'APPROVED',
                )
                .reduce((sum, record) => sum + Number(record.amount), 0) * 100,
            ) / 100
          const amount = Number(row.amount)
          return {
            id: row.id,
            contractId: row.contractId,
            contractName: row.contract.name,
            period: row.period,
            amount,
            paidAmount,
            status: this.receivablePlanStatus(amount, paidAmount, row.dueDate),
            dueDate: row.dueDate.toISOString().slice(0, 10),
            remark: row.remark,
          }
        }),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'receivableRecords') {
      const where: Prisma.ReceivableRecordWhereInput = {
        tenantId: user.tenantId,
        contract: { customerId: id },
      }
      const [rows, total] = await Promise.all([
        this.prisma.receivableRecord.findMany({
          where,
          include: {
            contract: { select: { name: true } },
            plan: { select: { period: true } },
          },
          orderBy: { receivedAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.receivableRecord.count({ where }),
      ])
      const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
      return {
        items: rows.map((row) => ({
          id: row.id,
          contractId: row.contractId,
          contractName: row.contract.name,
          planId: row.planId,
          planPeriod: row.plan?.period ?? null,
          amount: Number(row.amount),
          receivedAt: row.receivedAt.toISOString().slice(0, 10),
          method: row.method,
          remark: row.remark,
          approvalStatus: row.approvalStatus,
          ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    if (resource === 'invoices') {
      const where: Prisma.InvoiceRecordWhereInput = {
        tenantId: user.tenantId,
        contract: { customerId: id },
      }
      const [rows, total] = await Promise.all([
        this.prisma.invoiceRecord.findMany({
          where,
          include: {
            contract: { select: { name: true } },
            title: { select: { name: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.invoiceRecord.count({ where }),
      ])
      return {
        items: rows.map((row) => ({
          id: row.id,
          contractId: row.contractId,
          contractName: row.contract.name,
          titleName: row.title?.name ?? null,
          amount: Number(row.amount),
          type: row.type,
          status: row.status,
          invoiceNo: row.invoiceNo,
          issuedAt: row.issuedAt?.toISOString().slice(0, 10) ?? null,
          remark: row.remark,
        })),
        total,
        page: currentPage,
        pageSize: take,
      }
    }

    const where: Prisma.OrderWhereInput = {
      tenantId: user.tenantId,
      contract: { customerId: id },
    }
    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: { contract: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
    ])
    const ownerMap = await this.userNames(rows.map((row) => row.ownerId))
    return {
      items: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.name,
        contractId: row.contractId,
        contractName: row.contract.name,
        amount: Number(row.amount),
        status: row.status,
        approvalStatus: row.approvalStatus,
        ownerName: row.ownerId ? (ownerMap.get(row.ownerId) ?? null) : null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page: currentPage,
      pageSize: take,
    }
  }

  async create(user: AuthUser, dto: CreateCustomerDto): Promise<CustomerVO> {
    const { customData, ownerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    await this.assertCustomerUniqueRules(user.tenantId, rest)
    const owner = await this.resolveOwner(user, ownerId)
    await this.pools.assertCapacityForOwner(user.tenantId, 'customer', owner.id)

    const customer = await this.prisma.customer.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        ownerId: owner.id,
        deptId: owner.deptId,
        collectedAt: new Date(),
        customData: validated as Prisma.InputJsonValue,
      },
      include: ownerInclude,
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_ADD',
      operatorId: user.id,
      recipientIds: [owner.id],
      excludeSelf: true,
      type: 'system',
      title: '新建客户',
      content: `${user.name} 新建了客户「${customer.name}」并将你设为负责人`,
      link: `/customers/${customer.id}`,
    })
    return this.toVO(customer, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async update(user: AuthUser, id: string, dto: UpdateCustomerDto): Promise<CustomerVO> {
    const existing = await this.ensureInScope(user, id, 'customer:update')
    return this.updateExisting(user, existing, dto)
  }

  private async updateExisting(
    user: AuthUser,
    existing: Prisma.CustomerGetPayload<Record<string, never>>,
    dto: UpdateCustomerDto,
  ): Promise<CustomerVO> {
    const { customData, ownerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })
    await this.assertCustomerUniqueRules(user.tenantId, rest, existing.id)

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
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', owner.id)
      data.owner = { connect: { id: owner.id } }
      data.deptId = owner.deptId
      data.collectedAt = new Date()
      data.poolId = null
      data.poolEnteredAt = null
      if (existing.ownerId) {
        await this.prisma.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'customer',
            resourceId: existing.id,
            ownerId: existing.ownerId,
            operatorId: user.id,
            collectedAt: existing.collectedAt,
          },
        })
      }
    }

    const customer = await this.prisma.customer.update({
      where: { id: existing.id },
      data,
      include: ownerInclude,
    })
    if (ownerId && ownerId !== existing.ownerId) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CUSTOMER_TRANSFERRED_CUSTOMER',
        operatorId: user.id,
        recipientIds: [ownerId],
        excludeSelf: true,
        type: 'assign',
        title: '客户已转移给你',
        content: `${user.name} 将客户「${customer.name}」转移给你`,
        link: `/customers/${customer.id}`,
      })
    }
    await this.changeLog.record(user, {
      module: 'customer',
      action: 'update',
      targetId: customer.id,
      targetName: customer.name,
      before: existing,
      after: customer,
    })
    return this.toVO(customer, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async remove(user: AuthUser, id: string): Promise<{ id: string; name: string }> {
    const customer = await this.ensureInScope(user, id, 'customer:delete')
    await this.assertCustomersDeletable(user.tenantId, [id])
    await this.deleteCustomerResources(user, [customer])
    return { id, name: customer.name }
  }

  /** 退回公海 */
  async moveToSea(user: AuthUser, id: string, poolId?: string, reasonId?: string) {
    const customer = await this.ensureInScope(user, id, 'customer:assign')
    const pool = await this.pools.resolveMoveTargetPool(
      user.tenantId,
      'customer',
      customer.ownerId,
      poolId,
    )
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      if (customer.ownerId) {
        await tx.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'customer',
            resourceId: customer.id,
            ownerId: customer.ownerId,
            operatorId: user.id,
            poolId: pool.id,
            reasonId,
            collectedAt: customer.collectedAt,
            endedAt: now,
          },
        })
      }
      await tx.customer.update({
        where: { id },
        data: {
          inSea: true,
          poolId: pool.id,
          poolEnteredAt: now,
          ownerId: null,
          deptId: null,
          collectedAt: null,
        },
      })
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_MOVED_HIGH_SEAS',
      operatorId: user.id,
      recipientIds: [customer.ownerId],
      excludeSelf: true,
      type: 'pool',
      title: '客户已移入公海',
      content: `${user.name} 将客户「${customer.name}」移入公海`,
      link: '/customers',
    })
    return { id, name: customer.name, poolId: pool.id }
  }

  /** 从公海领取 */
  async claimFromSea(user: AuthUser, id: string) {
    const current = await this.prisma.customer.findFirst({
      where: { id, tenantId: user.tenantId, inSea: true },
    })
    if (!current) throw new BadRequestException('客户不存在或已被他人领取')
    await this.pools.assertCanClaim(
      user,
      'customer',
      current.poolId,
      current.id,
      current.poolEnteredAt,
    )
    const now = new Date()
    const result = await this.prisma.customer.updateMany({
      where: { id, tenantId: user.tenantId, inSea: true, poolId: current.poolId },
      data: {
        inSea: false,
        poolId: null,
        poolEnteredAt: null,
        ownerId: user.id,
        deptId: user.deptId,
        collectedAt: now,
      },
    })
    if (result.count === 0) throw new BadRequestException('客户不存在或已被他人领取')
    const customer = await this.prisma.customer.findUnique({ where: { id } })
    return { id, name: customer?.name ?? '' }
  }

  async batchClaimFromSea(
    user: AuthUser,
    ids: string[],
    poolId?: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        if (poolId) {
          const customer = await this.prisma.customer.findFirst({
            where: { id, tenantId: user.tenantId, inSea: true },
            select: { poolId: true },
          })
          if (!customer || customer.poolId !== poolId)
            throw new BadRequestException('客户不属于指定公海')
        }
        await this.claimFromSea(user, id)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** 分配负责人 */
  async assignOwner(user: AuthUser, id: string, ownerId: string) {
    const customer = (await this.customerAccess.assertManageCustomer(user, id)).customer
    return this.assignOwnerExisting(user, customer, ownerId)
  }

  /** 已由调用方完成资源访问校验后的统一负责人变更。 */
  private async assignOwnerExisting(
    user: AuthUser,
    customer: Prisma.CustomerGetPayload<Record<string, never>>,
    ownerId: string,
    capacityChecked = false,
  ) {
    const owner = await this.resolveOwner(user, ownerId)
    if (!capacityChecked && (customer.ownerId !== owner.id || customer.inSea)) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', owner.id)
    }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      if (customer.ownerId && customer.ownerId !== owner.id) {
        await tx.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'customer',
            resourceId: customer.id,
            ownerId: customer.ownerId,
            operatorId: user.id,
            collectedAt: customer.collectedAt,
            endedAt: now,
          },
        })
      }
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          inSea: false,
          poolId: null,
          poolEnteredAt: null,
          ownerId: owner.id,
          deptId: owner.deptId,
          collectedAt: now,
        },
      })
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: customer.inSea ? 'HIGH_SEAS_CUSTOMER_DISTRIBUTED' : 'CUSTOMER_TRANSFERRED_CUSTOMER',
      operatorId: user.id,
      recipientIds: [owner.id],
      excludeSelf: true,
      type: 'assign',
      title: customer.inSea ? '公海客户已分配给你' : '客户已转移给你',
      content: `${user.name} 将客户「${customer.name}」分配给你`,
      link: `/customers/${customer.id}`,
    })
    return { id: customer.id, name: customer.name }
  }

  async batchAssignOwner(
    user: AuthUser,
    ids: string[],
    ownerId: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.assignOwner(user, id, ownerId)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  async batchMoveToSea(
    user: AuthUser,
    ids: string[],
    poolId?: string,
    reasonId?: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.moveToSea(user, id, poolId, reasonId)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** Cordys ResourceBatchEditRequest：先完成整批资源权限校验，再修改一个字段。 */
  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    const customers = await Promise.all(
      dto.ids.map((id) => this.ensureInScope(user, id, 'customer:update')),
    )

    if (field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      const processCount = customers.filter(
        (customer) => customer.ownerId !== dto.fieldValue,
      ).length
      if (processCount > 0) {
        await this.pools.assertCapacityForOwner(
          user.tenantId,
          'customer',
          dto.fieldValue,
          processCount,
        )
      }
      for (const customer of customers) {
        if (customer.ownerId !== dto.fieldValue) {
          await this.assignOwnerExisting(user, customer, dto.fieldValue, true)
        }
      }
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    const updateDto: UpdateCustomerDto = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : ({ [field.key]: dto.fieldValue } as UpdateCustomerDto)
    for (const customer of customers) await this.update(user, customer.id, updateDto)
    return { success: dto.ids.length, fail: 0, failedIds: [] }
  }

  async batchDelete(user: AuthUser, ids: string[]): Promise<BatchAffectResult> {
    const customers = await Promise.all(
      ids.map((id) => this.ensureInScope(user, id, 'customer:delete')),
    )
    await this.assertCustomersDeletable(user.tenantId, ids)
    await this.deleteCustomerResources(user, customers)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async poolBatchUpdate(user: AuthUser, dto: PoolResourceBatchEditDto): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'customer', dto.poolId)
    const customers = await this.prisma.customer.findMany({
      where: {
        tenantId: user.tenantId,
        id: { in: dto.ids },
        inSea: true,
        poolId: dto.poolId,
      },
    })
    if (customers.length !== dto.ids.length) {
      throw new BadRequestException('所选客户必须全部属于同一个指定公海')
    }

    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    if (field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      await this.pools.assertCapacityForOwner(
        user.tenantId,
        'customer',
        dto.fieldValue,
        customers.length,
      )
      for (const customer of customers) {
        await this.assignOwnerExisting(user, customer, dto.fieldValue, true)
      }
      return { success: customers.length, fail: 0, failedIds: [] }
    }

    const updateDto: UpdateCustomerDto = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : ({ [field.key]: dto.fieldValue } as UpdateCustomerDto)
    for (const customer of customers) await this.updateExisting(user, customer, updateDto)
    return { success: customers.length, fail: 0, failedIds: [] }
  }

  async poolBatchDelete(user: AuthUser, poolId: string, ids: string[]): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'customer', poolId)
    const customers = await this.prisma.customer.findMany({
      where: { tenantId: user.tenantId, id: { in: ids }, inSea: true, poolId },
    })
    if (customers.length !== ids.length) {
      throw new BadRequestException('所选客户必须全部属于同一个指定公海')
    }
    await this.assertCustomersDeletable(user.tenantId, ids)
    await this.deleteCustomerResources(user, customers)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  // ===== 团队成员 =====

  async teamList(user: AuthUser, customerId: string) {
    await this.customerAccess.assertRead(user, customerId)
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
      collaborationType: m.collaborationType as 'READ_ONLY' | 'COLLABORATION',
      createdAt: m.createdAt.toISOString(),
    }))
  }

  async teamAdd(
    user: AuthUser,
    customerId: string,
    userId: string,
    role?: string,
    collaborationType: 'READ_ONLY' | 'COLLABORATION' = 'COLLABORATION',
  ) {
    const customer = (await this.customerAccess.assertManageCustomer(user, customerId)).customer
    const member = await this.prisma.user.findFirst({
      where: { id: userId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true, name: true },
    })
    if (!member) throw new BadRequestException('协作成员不存在或已禁用')
    const exists = await this.prisma.customerTeamMember.findFirst({
      where: { tenantId: user.tenantId, customerId, userId },
    })
    if (exists) throw new BadRequestException('该成员已在团队中')
    await this.prisma.customerTeamMember.create({
      data: {
        tenantId: user.tenantId,
        customerId,
        userId,
        role,
        collaborationType,
        createdById: user.id,
        updatedById: user.id,
      },
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_COLLABORATION_ADD',
      operatorId: user.id,
      recipientIds: [customer.ownerId],
      excludeSelf: true,
      type: 'system',
      title: '客户新增协作人',
      content: `${user.name} 为客户「${customer.name}」添加协作成员「${member.name}」`,
      link: `/customers/${customerId}`,
    })
    return { id: customerId, name: customer.name }
  }

  async teamUpdate(
    user: AuthUser,
    customerId: string,
    memberId: string,
    collaborationType: 'READ_ONLY' | 'COLLABORATION',
  ) {
    await this.customerAccess.assertManageCustomer(user, customerId)
    const result = await this.prisma.customerTeamMember.updateMany({
      where: { id: memberId, tenantId: user.tenantId, customerId },
      data: { collaborationType, updatedById: user.id },
    })
    if (result.count === 0) throw new NotFoundException('协作成员不存在')
    return { id: memberId, collaborationType }
  }

  async teamRemove(user: AuthUser, customerId: string, memberId: string) {
    await this.customerAccess.assertManageCustomer(user, customerId)
    await this.prisma.customerTeamMember.deleteMany({
      where: { id: memberId, tenantId: user.tenantId, customerId },
    })
    return { id: memberId }
  }

  // ===== 客户集团 / 子公司关系 =====

  async relationList(user: AuthUser, customerId: string) {
    await this.customerAccess.assertRead(user, customerId)
    const rows = await this.prisma.customerRelation.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
      orderBy: { createdAt: 'asc' },
    })
    const relatedIds = rows.map((row) =>
      row.sourceCustomerId === customerId ? row.targetCustomerId : row.sourceCustomerId,
    )
    const customers = await this.prisma.customer.findMany({
      where: { tenantId: user.tenantId, id: { in: relatedIds } },
      select: { id: true, name: true },
    })
    const names = new Map(customers.map((item) => [item.id, item.name]))
    return rows.map((row) => {
      const isGroup = row.targetCustomerId === customerId
      const relatedId = isGroup ? row.sourceCustomerId : row.targetCustomerId
      return {
        id: row.id,
        relationType: isGroup ? ('GROUP' as const) : ('SUBSIDIARY' as const),
        customerId: relatedId,
        customerName: names.get(relatedId) ?? null,
        createdAt: row.createdAt.toISOString(),
      }
    })
  }

  /**
   * Cordys 客户关系编辑器采用“整组替换保存”。
   * 现有单条 CRUD 保留兼容；新前端优先使用此接口，避免客户端计算增删改差异。
   */
  async relationReplace(user: AuthUser, customerId: string, requests: SaveCustomerRelationDto[]) {
    const access = await this.customerAccess.assertRead(user, customerId)
    if (!access.canManageCustomer && access.collaborationType !== 'COLLABORATION') {
      throw new ForbiddenException('当前客户关系仅允许查看')
    }
    if (requests.length > 11) throw new BadRequestException('客户关系最多 11 条')

    const customerIds = requests.map((item) => item.customerId)
    if (new Set(customerIds).size !== customerIds.length) {
      throw new BadRequestException('同一个客户不能重复建立关系')
    }
    if (requests.filter((item) => item.relationType === 'GROUP').length > 1) {
      throw new BadRequestException('一个客户只能设置一个上级集团')
    }

    const currentRows = await this.prisma.customerRelation.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
      select: { id: true },
    })
    const excludeIds = currentRows.map((row) => row.id)
    const relations: {
      tenantId: string
      sourceCustomerId: string
      targetCustomerId: string
    }[] = []
    for (const request of requests) {
      const relation = await this.buildCustomerRelation(
        user,
        customerId,
        request.customerId,
        request.relationType,
      )
      await this.assertCustomerRelationValid(
        user.tenantId,
        relation.sourceCustomerId,
        relation.targetCustomerId,
        excludeIds,
      )
      relations.push(relation)
    }
    await this.assertCustomerRelationGraphValid(user.tenantId, relations, excludeIds)

    await this.prisma.$transaction(async (tx) => {
      await tx.customerRelation.deleteMany({
        where: {
          tenantId: user.tenantId,
          OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
        },
      })
      if (relations.length > 0) await tx.customerRelation.createMany({ data: relations })
    })
    return this.relationList(user, customerId)
  }

  async relationAdd(
    user: AuthUser,
    customerId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const relation = await this.buildCustomerRelation(
      user,
      customerId,
      relatedCustomerId,
      relationType,
    )
    await this.assertCustomerRelationValid(
      user.tenantId,
      relation.sourceCustomerId,
      relation.targetCustomerId,
    )
    return this.prisma.customerRelation.create({ data: relation })
  }

  async relationUpdate(
    user: AuthUser,
    customerId: string,
    relationId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const existing = await this.prisma.customerRelation.findFirst({
      where: {
        id: relationId,
        tenantId: user.tenantId,
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
    })
    if (!existing) throw new NotFoundException('客户关系不存在')
    const relation = await this.buildCustomerRelation(
      user,
      customerId,
      relatedCustomerId,
      relationType,
    )
    await this.assertCustomerRelationValid(
      user.tenantId,
      relation.sourceCustomerId,
      relation.targetCustomerId,
      [relationId],
    )
    return this.prisma.customerRelation.update({
      where: { id: relationId },
      data: {
        sourceCustomerId: relation.sourceCustomerId,
        targetCustomerId: relation.targetCustomerId,
      },
    })
  }

  async relationRemove(user: AuthUser, customerId: string, relationId: string) {
    await this.ensureInScope(user, customerId, 'customer:update')
    const result = await this.prisma.customerRelation.deleteMany({
      where: {
        id: relationId,
        tenantId: user.tenantId,
        OR: [{ sourceCustomerId: customerId }, { targetCustomerId: customerId }],
      },
    })
    if (result.count === 0) throw new NotFoundException('客户关系不存在')
    return { id: relationId }
  }

  async mergePreview(user: AuthUser, dto: CustomerMergeDto) {
    const context = await this.prepareMergeContext(user, dto)
    const [
      ownerMap,
      opportunityCount,
      quoteCount,
      contractCount,
      followUpCount,
      attachmentCount,
      collaborationCount,
      relationCount,
    ] = await Promise.all([
      this.userNames([
        context.target.ownerId,
        ...context.sources.map((item) => item.ownerId),
        context.newOwner.id,
      ]),
      this.prisma.opportunity.count({
        where: { tenantId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.quote.count({
        where: { tenantId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.contract.count({
        where: { tenantId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.followUpRecord.count({
        where: {
          tenantId: user.tenantId,
          targetType: 'customer',
          targetId: { in: context.sourceIds },
        },
      }),
      this.prisma.attachment.count({
        where: {
          tenantId: user.tenantId,
          targetType: 'customer',
          targetId: { in: context.sourceIds },
        },
      }),
      this.prisma.customerTeamMember.count({
        where: { tenantId: user.tenantId, customerId: { in: context.sourceIds } },
      }),
      this.prisma.customerRelation.count({
        where: {
          tenantId: user.tenantId,
          OR: [
            { sourceCustomerId: { in: context.sourceIds } },
            { targetCustomerId: { in: context.sourceIds } },
          ],
        },
      }),
    ])

    return {
      targetWasSelected: context.targetWasSelected,
      target: {
        id: context.target.id,
        name: context.target.name,
        ownerId: context.target.ownerId,
        ownerName: context.target.ownerId ? (ownerMap.get(context.target.ownerId) ?? null) : null,
      },
      sources: context.sources.map((source) => ({
        id: source.id,
        name: source.name,
        ownerId: source.ownerId,
        ownerName: source.ownerId ? (ownerMap.get(source.ownerId) ?? null) : null,
      })),
      finalOwner: {
        id: context.newOwner.id,
        name: ownerMap.get(context.newOwner.id) ?? null,
      },
      contactConflictStrategy: dto.contactConflictStrategy ?? 'KEEP_ALL',
      counts: {
        customersToDelete: context.sourceIds.length,
        contacts: context.sourceContacts.length,
        contactsWillMove: context.sourceContacts.length - context.skipContactIds.length,
        contactsWillSkip: context.skipContactIds.length,
        opportunities: opportunityCount,
        quotes: quoteCount,
        contracts: contractCount,
        followUps: followUpCount,
        attachments: attachmentCount,
        collaborations: collaborationCount,
        relationsToRemove: relationCount,
      },
      contactConflicts: context.contactConflicts,
    }
  }

  async merge(user: AuthUser, dto: CustomerMergeDto) {
    const context = await this.prepareMergeContext(user, dto)
    const { sourceIds, target, sources, newOwner, skipContactIds, contactConflicts } = context

    const sourceNames = sources.map((source) => source.name)
    const sourceTeams = await this.prisma.customerTeamMember.findMany({
      where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
    })
    const targetTeams = await this.prisma.customerTeamMember.findMany({
      where: { tenantId: user.tenantId, customerId: dto.toMergeId },
      select: { userId: true },
    })
    const existingTeamUsers = new Set(targetTeams.map((item) => item.userId))
    const collaboration = new Map<string, 'READ_ONLY' | 'COLLABORATION'>()
    for (const item of sourceTeams) {
      const type = item.collaborationType === 'READ_ONLY' ? 'READ_ONLY' : 'COLLABORATION'
      const previous = collaboration.get(item.userId)
      if (!previous || type === 'COLLABORATION') collaboration.set(item.userId, type)
    }
    for (const source of sources) {
      if (source.ownerId && !collaboration.has(source.ownerId)) {
        collaboration.set(source.ownerId, 'COLLABORATION')
      }
    }

    const now = new Date()
    const result = await this.prisma.$transaction(async (tx) => {
      // Cordys 核心合并对象：联系人、商机、跟进；MicroMatrix 额外同步直接 Customer FK。
      if (skipContactIds.length > 0) {
        for (const conflict of contactConflicts) {
          if (!skipContactIds.includes(conflict.sourceContactId)) continue
          const targetContactId = conflict.targetContactIds[0]
          if (targetContactId) {
            await tx.attachment.updateMany({
              where: {
                tenantId: user.tenantId,
                targetType: 'contact',
                targetId: conflict.sourceContactId,
              },
              data: { targetId: targetContactId },
            })
          }
        }
        await tx.contact.deleteMany({
          where: { tenantId: user.tenantId, id: { in: skipContactIds } },
        })
      }
      await tx.contact.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.opportunity.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.quote.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.contract.updateMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        data: { customerId: dto.toMergeId },
      })
      await tx.followUpRecord.updateMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: sourceIds } },
        data: { targetId: dto.toMergeId },
      })
      await tx.attachment.updateMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: sourceIds } },
        data: { targetId: dto.toMergeId },
      })

      // Cordys 删除被合并客户的集团关系；目标客户已有关系保持不动。
      await tx.customerRelation.deleteMany({
        where: {
          tenantId: user.tenantId,
          OR: [{ sourceCustomerId: { in: sourceIds } }, { targetCustomerId: { in: sourceIds } }],
        },
      })

      for (const [userId, collaborationType] of collaboration) {
        if (userId === newOwner.id || existingTeamUsers.has(userId)) continue
        await tx.customerTeamMember.create({
          data: {
            tenantId: user.tenantId,
            customerId: dto.toMergeId,
            userId,
            collaborationType,
            createdById: user.id,
            updatedById: user.id,
          },
        })
      }
      await tx.customerTeamMember.deleteMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
      })

      if (target.ownerId && target.ownerId !== newOwner.id) {
        await tx.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'customer',
            resourceId: target.id,
            ownerId: target.ownerId,
            operatorId: user.id,
            collectedAt: target.collectedAt,
            endedAt: now,
          },
        })
      }
      const mergedTarget = await tx.customer.update({
        where: { id: target.id },
        data: {
          ownerId: newOwner.id,
          deptId: newOwner.deptId,
          inSea: false,
          poolId: null,
          poolEnteredAt: null,
          collectedAt: target.ownerId === newOwner.id && !target.inSea ? target.collectedAt : now,
        },
      })
      await tx.customer.deleteMany({
        where: { tenantId: user.tenantId, id: { in: sourceIds } },
      })
      return mergedTarget
    })

    if (target.ownerId !== newOwner.id) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CUSTOMER_TRANSFERRED_CUSTOMER',
        operatorId: user.id,
        recipientIds: [newOwner.id],
        excludeSelf: true,
        type: 'assign',
        title: '客户已转移给你',
        content: `${user.name} 将合并后的客户「${target.name}」分配给你`,
        link: `/customers/${target.id}`,
      })
    }
    await this.changeLog.record(user, {
      module: 'customer',
      action: 'merge',
      targetId: target.id,
      targetName: target.name,
      before: { ownerId: target.ownerId, merge: sourceNames },
      after: { ownerId: result.ownerId, merge: [target.name] },
    })
    return { id: target.id, name: target.name, merged: sourceIds.length }
  }

  async ownerHistory(user: AuthUser, customerId: string) {
    await this.customerAccess.assertRead(user, customerId)
    return this.pools.ownerHistory(user, 'customer', customerId)
  }

  private async prepareMergeContext(user: AuthUser, dto: CustomerMergeDto) {
    const requestedIds = [...new Set(dto.mergeIds)]
    const targetWasSelected = requestedIds.includes(dto.toMergeId)
    const sourceIds = requestedIds.filter((id) => id !== dto.toMergeId)
    if (sourceIds.length === 0) throw new BadRequestException('没有可合并的客户')

    const target = await this.ensureInScope(user, dto.toMergeId, 'customer:merge')
    const sources: (typeof target)[] = []
    for (const sourceId of sourceIds) {
      sources.push(await this.ensureInScope(user, sourceId, 'customer:merge'))
    }
    const newOwner = await this.resolveOwner(user, dto.ownerId)

    if (targetWasSelected) {
      const selectedOwnerIds = new Set(
        [target, ...sources].map((item) => item.ownerId).filter((id): id is string => !!id),
      )
      if (!selectedOwnerIds.has(newOwner.id)) {
        throw new BadRequestException('主客户来自已选客户时，最终负责人必须来自已选客户负责人')
      }
    } else {
      if (!target.ownerId) {
        throw new BadRequestException('其它主客户当前没有负责人，请改用已选客户作为主客户')
      }
      if (newOwner.id !== target.ownerId) {
        throw new BadRequestException('主客户来自其它客户时，最终负责人必须保持主客户原负责人')
      }
    }

    const sourceOwnedByNewOwner = sources.filter(
      (source) => source.ownerId === newOwner.id && !source.inSea,
    ).length
    const targetAddsCapacity = target.ownerId !== newOwner.id || target.inSea
    if (targetAddsCapacity && sourceOwnedByNewOwner === 0) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', newOwner.id)
    }

    const [targetContacts, sourceContacts] = await Promise.all([
      this.prisma.contact.findMany({
        where: { tenantId: user.tenantId, customerId: target.id },
        select: { id: true, customerId: true, name: true, phone: true },
      }),
      this.prisma.contact.findMany({
        where: { tenantId: user.tenantId, customerId: { in: sourceIds } },
        select: { id: true, customerId: true, name: true, phone: true },
      }),
    ])
    const contactConflicts = this.findMergeContactConflicts(targetContacts, sourceContacts)
    const skipContactIds =
      (dto.contactConflictStrategy ?? 'KEEP_ALL') === 'SKIP_DUPLICATES'
        ? contactConflicts.map((item) => item.sourceContactId)
        : []

    return {
      requestedIds,
      targetWasSelected,
      sourceIds,
      target,
      sources,
      newOwner,
      sourceContacts,
      contactConflicts,
      skipContactIds,
    }
  }

  private findMergeContactConflicts(
    targetContacts: { id: string; customerId: string; name: string; phone: string | null }[],
    sourceContacts: { id: string; customerId: string; name: string; phone: string | null }[],
  ) {
    const normalizeName = (value: string) => value.trim().toLocaleLowerCase()
    const normalizePhone = (value: string | null) => value?.trim() ?? ''
    const targetNames = new Map<string, string[]>()
    const targetPhones = new Map<string, string[]>()
    for (const contact of targetContacts) {
      const name = normalizeName(contact.name)
      if (name) targetNames.set(name, [...(targetNames.get(name) ?? []), contact.id])
      const phone = normalizePhone(contact.phone)
      if (phone) targetPhones.set(phone, [...(targetPhones.get(phone) ?? []), contact.id])
    }

    return sourceContacts.flatMap((contact) => {
      const matchedBy: ('name' | 'phone')[] = []
      const targetContactIds = new Set<string>()
      const nameMatches = targetNames.get(normalizeName(contact.name)) ?? []
      if (nameMatches.length > 0) {
        matchedBy.push('name')
        nameMatches.forEach((id) => targetContactIds.add(id))
      }
      const phone = normalizePhone(contact.phone)
      const phoneMatches = phone ? (targetPhones.get(phone) ?? []) : []
      if (phoneMatches.length > 0) {
        matchedBy.push('phone')
        phoneMatches.forEach((id) => targetContactIds.add(id))
      }
      if (matchedBy.length === 0) return []
      return [
        {
          sourceContactId: contact.id,
          sourceCustomerId: contact.customerId,
          name: contact.name,
          phone: contact.phone,
          matchedBy,
          targetContactIds: [...targetContactIds],
        },
      ]
    })
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

  private assert360ResourcePermission(user: AuthUser, resource: Customer360Resource) {
    const permission =
      resource === 'opportunities'
        ? 'menu:opportunity'
        : resource === 'orders'
          ? 'menu:order'
          : 'menu:contract'
    if (!hasPermission(user.permissions, permission)) {
      throw new ForbiddenException('没有查看该客户关联数据的权限')
    }
  }

  private receivablePlanStatus(
    amount: number,
    paidAmount: number,
    dueDate: Date,
  ): ReceivablePlanStatus {
    if (paidAmount >= amount && amount > 0) return 'PAID'
    if (paidAmount > 0) return 'PARTIAL'
    if (dueDate < new Date()) return 'OVERDUE'
    return 'PENDING'
  }

  private async buildCustomerRelation(
    user: AuthUser,
    customerId: string,
    relatedCustomerId: string,
    relationType: 'GROUP' | 'SUBSIDIARY',
  ) {
    if (customerId === relatedCustomerId)
      throw new BadRequestException('客户不能与自己建立集团关系')
    const related = await this.prisma.customer.findFirst({
      where: { id: relatedCustomerId, tenantId: user.tenantId },
      select: { id: true },
    })
    if (!related) throw new NotFoundException('关联客户不存在')
    return relationType === 'GROUP'
      ? {
          tenantId: user.tenantId,
          sourceCustomerId: relatedCustomerId,
          targetCustomerId: customerId,
        }
      : {
          tenantId: user.tenantId,
          sourceCustomerId: customerId,
          targetCustomerId: relatedCustomerId,
        }
  }

  private async assertCustomerRelationValid(
    tenantId: string,
    sourceCustomerId: string,
    targetCustomerId: string,
    excludeIds: string[] = [],
  ) {
    const existingParent = await this.prisma.customerRelation.findFirst({
      where: {
        tenantId,
        targetCustomerId,
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      select: { sourceCustomerId: true },
    })
    if (existingParent && existingParent.sourceCustomerId !== sourceCustomerId) {
      const group = await this.prisma.customer.findFirst({
        where: { id: existingParent.sourceCustomerId, tenantId },
        select: { name: true },
      })
      throw new BadRequestException(`该子公司已属于集团「${group?.name ?? '未知客户'}」`)
    }

    // 防止直接或间接形成集团关系环。
    let current: string | null = sourceCustomerId
    const visited = new Set<string>()
    while (current) {
      if (current === targetCustomerId) throw new BadRequestException('客户集团关系不能形成循环')
      if (visited.has(current)) break
      visited.add(current)
      const parent: { sourceCustomerId: string } | null =
        await this.prisma.customerRelation.findFirst({
          where: {
            tenantId,
            targetCustomerId: current,
            ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
          },
          select: { sourceCustomerId: true },
        })
      current = parent?.sourceCustomerId ?? null
    }
  }

  private async assertCustomerRelationGraphValid(
    tenantId: string,
    pending: { sourceCustomerId: string; targetCustomerId: string }[],
    excludeIds: string[],
  ) {
    const existing = await this.prisma.customerRelation.findMany({
      where: {
        tenantId,
        ...(excludeIds.length ? { id: { notIn: excludeIds } } : {}),
      },
      select: { sourceCustomerId: true, targetCustomerId: true },
    })
    const edges = [...existing, ...pending]

    const parentCount = new Map<string, number>()
    const adjacency = new Map<string, string[]>()
    for (const edge of edges) {
      parentCount.set(edge.targetCustomerId, (parentCount.get(edge.targetCustomerId) ?? 0) + 1)
      if ((parentCount.get(edge.targetCustomerId) ?? 0) > 1) {
        throw new BadRequestException('一个子公司只能属于一个集团')
      }
      const next = adjacency.get(edge.sourceCustomerId) ?? []
      next.push(edge.targetCustomerId)
      adjacency.set(edge.sourceCustomerId, next)
    }

    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): boolean => {
      if (visiting.has(id)) return false
      if (visited.has(id)) return true
      visiting.add(id)
      for (const next of adjacency.get(id) ?? []) {
        if (!visit(next)) return false
      }
      visiting.delete(id)
      visited.add(id)
      return true
    }
    for (const id of adjacency.keys()) {
      if (!visit(id)) throw new BadRequestException('客户关系不能形成循环')
    }
  }

  private async findExactCustomerDuplicate(user: AuthUser, name: string, phone?: string) {
    return this.prisma.customer.findFirst({
      where: {
        tenantId: user.tenantId,
        OR: [{ name: { equals: name, mode: 'insensitive' } }, ...(phone ? [{ phone }] : [])],
      },
      select: { id: true, name: true },
    })
  }

  private async assertCustomerUniqueRules(
    tenantId: string,
    values: { name?: string; phone?: string; email?: string },
    excludeId?: string,
  ) {
    const fields = await this.metadata.fieldsMap(tenantId, MODULE)
    const checks = [
      ['name', values.name],
      ['phone', values.phone],
      ['email', values.email],
    ] as const
    for (const [key, raw] of checks) {
      if (!fields.get(key)?.config?.unique || raw === undefined || raw === null || raw === '')
        continue
      const value = typeof raw === 'string' ? raw.trim() : raw
      if (value === '') continue
      const duplicate = await this.prisma.customer.findFirst({
        where: {
          tenantId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          ...(key === 'name'
            ? { name: { equals: String(value), mode: 'insensitive' } }
            : key === 'phone'
              ? { phone: String(value) }
              : { email: { equals: String(value), mode: 'insensitive' } }),
        },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException(`「${fields.get(key)?.label ?? key}」不能重复`)
    }
  }

  private async inScopeCustomerIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.scopeFilter(user, 'menu:customer')
    const poolIds = (await this.pools.options(user, 'customer')).map((pool) => pool.id)
    const rows = await this.prisma.customer.findMany({
      where: {
        id: { in: unique },
        tenantId: user.tenantId,
        OR: [
          { inSea: true, OR: [{ poolId: { in: poolIds } }, { poolId: null }] },
          scope as Prisma.CustomerWhereInput,
          { teamMembers: { some: { tenantId: user.tenantId, userId: user.id } } },
        ],
      },
      select: { id: true },
    })
    return new Set(rows.map((r) => r.id))
  }

  private async inScopeLeadIds(user: AuthUser, ids: string[]): Promise<Set<string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Set()
    const scope = await this.dataScope.scopeFilter(user, 'menu:lead')
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
    const scope = await this.dataScope.scopeFilter(user, 'menu:opportunity')
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
    const map = new Map<
      string,
      {
        id: string
        name: string
        size: number
        mime: string | null
        targetType: string | null
        targetId: string | null
        uploaderId: string | null
        createdAt: string
      }[]
    >()
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

  /** 导出 CSV（按字段配置的列表列） */
  async exportCsv(
    user: AuthUser,
    query: QueryCustomersDto,
  ): Promise<{ filename: string; csv: string }> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const columns = fields.filter((f) => f.showInList && !f.hidden)
    const result = await this.findAll(user, { ...query, page: 1, pageSize: 5000 })

    const headers = [...columns.map((c) => c.label), '创建时间']
    const rows = result.items.map((item) => [
      ...columns.map((c) => formatForExport(c, item as unknown as Record<string, unknown>)),
      item.createdAt.slice(0, 10),
    ])
    return {
      filename: `客户导出_${new Date().toISOString().slice(0, 10)}.csv`,
      csv: toCsv(headers, rows),
    }
  }

  async importTemplate(
    user: AuthUser,
    importType: ImportType,
    poolId?: string,
  ): Promise<{ filename: string; data: Buffer }> {
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: poolId ? ['ownerId'] : [],
    })
    return {
      filename: `${poolId ? '客户公海' : '客户'}${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
    poolId?: string,
  ): Promise<ImportResultVO> {
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    const seen = new Set<string>()
    for (const row of rows) {
      const errors = [...row.errors]
      if (errors.length === 0) {
        try {
          const prepared = await this.prepareImportRow(
            user,
            row.values,
            fields,
            importType,
            row.resourceId,
            poolId,
          )
          if (importType === 'ADD') {
            const fingerprint = `${prepared.dto.name?.trim().toLowerCase() ?? ''}|${prepared.dto.phone?.trim() ?? ''}`
            if (seen.has(fingerprint)) throw new BadRequestException('导入文件内存在重复客户')
            seen.add(fingerprint)
          }
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '数据校验失败')
        }
      }
      if (errors.length > 0) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
      else successCount++
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async importXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
    poolId?: string,
  ): Promise<ImportResultVO> {
    if (poolId) await this.pools.assertPoolMember(user, 'customer', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    const seen = new Set<string>()
    for (const row of rows) {
      const errors = [...row.errors]
      if (errors.length === 0) {
        try {
          const prepared = await this.prepareImportRow(
            user,
            row.values,
            fields,
            importType,
            row.resourceId,
            poolId,
          )
          if (importType === 'ADD') {
            const fingerprint = `${prepared.dto.name?.trim().toLowerCase() ?? ''}|${prepared.dto.phone?.trim() ?? ''}`
            if (seen.has(fingerprint)) throw new BadRequestException('导入文件内存在重复客户')
            seen.add(fingerprint)
            if (poolId) await this.createInSea(user, prepared.dto, poolId)
            else await this.create(user, prepared.dto as CreateCustomerDto)
          } else if (poolId) {
            if (!prepared.existing) throw new BadRequestException('客户不存在或不属于当前公海')
            await this.updateExisting(user, prepared.existing, prepared.dto)
          } else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, row.resourceId, prepared.dto)
          }
          successCount++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '导入失败')
        }
      }
      if (errors.length > 0) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async exportXlsx(
    user: AuthUser,
    query: QueryCustomersDto,
    input: { fileName: string; headList: string[]; ids?: string[]; poolId?: string },
  ) {
    const poolMode = Boolean(input.poolId)
    if (poolMode) await this.pools.assertPoolMember(user, 'customer', input.poolId as string)
    const effectiveQuery: QueryCustomersDto = {
      ...query,
      scope: poolMode ? 'sea' : undefined,
      poolId: poolMode ? input.poolId : undefined,
    }
    const items = await this.collectExportItems(user, effectiveQuery, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['createdAt', '创建时间'],
      ['updatedAt', '更新时间'],
      ['lastFollowedAt', '最近跟进'],
    ])
    const columns = input.headList.map((key) => {
      const field = fieldMap.get(key)
      const extraLabel = extraColumns.get(key)
      if (!field && !extraLabel) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extraLabel as string) }
    })
    const rows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          const field = fieldMap.get(column.key)
          return [column.key, field ? formatForExport(field, source) : (source[column.key] ?? '')]
        }),
      )
    })
    return this.exportTasks.create(user, {
      module: poolMode ? 'customer_pool' : 'customer',
      fileName: input.fileName,
      columns,
      rows,
    })
  }

  /** 批量导入（前端解析 CSV 后传结构化行） */
  async bulkImport(user: AuthUser, rows: Record<string, unknown>[]) {
    if (rows.length === 0) throw new BadRequestException('没有可导入的数据')
    if (rows.length > 500) throw new BadRequestException('单次最多导入 500 行')
    let success = 0
    const errors: string[] = []
    for (const [index, row] of rows.entries()) {
      try {
        const { customData, ...rest } = row as { customData?: Record<string, unknown> } & Record<
          string,
          unknown
        >
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
    return {
      success,
      failed: errors.length,
      errors: errors.slice(0, 20),
      name: `导入客户 ${success} 条`,
    }
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
    poolId?: string,
  ): Promise<{
    dto: UpdateCustomerDto
    existing?: Prisma.CustomerGetPayload<Record<string, never>>
  }> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const dto: UpdateCustomerDto = {}
    const customData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap.get(key)
      if (!field || field.hidden || field.type === 'formula') continue
      this.metadata.validateBatchFieldValue(field, value)
      if (poolId && key === 'ownerId') throw new BadRequestException('客户公海导入不允许设置负责人')
      if (key === 'ownerId') {
        dto.ownerId = await this.resolveImportOwner(user, String(value))
      } else if (key.startsWith('cf_')) {
        customData[key] = value
      } else {
        ;(dto as Record<string, unknown>)[key] = value
      }
    }
    if (Object.keys(customData).length > 0) dto.customData = customData
    await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: importType === 'ADD',
    })

    if (importType === 'ADD') {
      const name = typeof dto.name === 'string' ? dto.name.trim() : ''
      if (!name) throw new BadRequestException('客户名称不能为空')
      const duplicate = await this.findExactCustomerDuplicate(user, name, dto.phone)
      if (duplicate) throw new BadRequestException(`与已有客户「${duplicate.name}」重复`)
      if (!poolId)
        await this.pools.assertCapacityForOwner(user.tenantId, 'customer', dto.ownerId ?? user.id)
      else await this.pools.resolveTargetPool(user, 'customer', poolId)
      return { dto }
    }

    if (!resourceId) throw new BadRequestException('唯一ID不能为空')
    const existing = poolId
      ? await this.prisma.customer.findFirst({
          where: { id: resourceId, tenantId: user.tenantId, inSea: true, poolId },
        })
      : await this.ensureInScope(user, resourceId, 'customer:import')
    if (!existing) throw new BadRequestException('客户不存在或不属于当前公海')
    if (dto.ownerId && dto.ownerId !== existing.ownerId) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'customer', dto.ownerId)
    }
    return { dto, existing }
  }

  private async createInSea(user: AuthUser, dto: UpdateCustomerDto, poolId: string) {
    const pool = await this.pools.resolveTargetPool(user, 'customer', poolId)
    const { customData, ownerId: _ownerId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const name = typeof rest.name === 'string' ? rest.name.trim() : ''
    if (!name) throw new BadRequestException('客户名称不能为空')
    const now = new Date()
    const customer = await this.prisma.customer.create({
      data: {
        ...rest,
        name,
        tenantId: user.tenantId,
        inSea: true,
        poolId: pool.id,
        poolEnteredAt: now,
        ownerId: null,
        deptId: null,
        collectedAt: null,
        customData: validated as Prisma.InputJsonValue,
      },
      include: ownerInclude,
    })
    return this.toVO(customer, await this.metadata.listFields(user.tenantId, MODULE))
  }

  private async resolveImportOwner(user: AuthUser, value: string): Promise<string> {
    const input = value.trim()
    if (!input) throw new BadRequestException('负责人不能为空')
    const direct = await this.prisma.user.findFirst({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        OR: [{ id: input }, { email: { equals: input, mode: 'insensitive' } }],
      },
      select: { id: true },
    })
    if (direct) return direct.id
    const byName = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, status: 'ACTIVE', name: input },
      select: { id: true },
      take: 2,
    })
    if (byName.length === 0) throw new BadRequestException(`负责人「${input}」不存在或已禁用`)
    if (byName.length > 1) throw new BadRequestException(`负责人名称「${input}」不唯一，请填写邮箱`)
    return byName[0].id
  }

  private async collectExportItems(user: AuthUser, query: QueryCustomersDto, ids?: string[]) {
    const all: CustomerVO[] = []
    const pageSize = 500
    let page = 1
    while (true) {
      const result = await this.findAll(user, { ...query, page, pageSize })
      all.push(...result.items)
      if (all.length >= result.total || result.items.length === 0) break
      page++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size)
      throw new BadRequestException('选中数据包含不存在或无权导出的客户')
    return selected
  }

  /**
   * Cordys 在删除客户前会阻止仍被 Contact / Opportunity 引用的客户。
   * MicroMatrix 另外有 Quote / Contract 直接外键，因此一起保护，避免把业务拒绝退化成数据库 FK 500。
   */
  private async assertCustomersDeletable(tenantId: string, ids: string[]) {
    const [contacts, opportunities, quotes, contracts] = await Promise.all([
      this.prisma.contact.count({ where: { tenantId, customerId: { in: ids } } }),
      this.prisma.opportunity.count({ where: { tenantId, customerId: { in: ids } } }),
      this.prisma.quote.count({ where: { tenantId, customerId: { in: ids } } }),
      this.prisma.contract.count({ where: { tenantId, customerId: { in: ids } } }),
    ])
    if (contacts + opportunities + quotes + contracts > 0) {
      throw new BadRequestException('客户已关联联系人、商机或交易数据，不能删除')
    }
  }

  private async deleteCustomerResources(
    user: AuthUser,
    customers: { id: string; name: string; ownerId: string | null }[],
  ) {
    const ids = customers.map((customer) => customer.id)
    await this.prisma.$transaction(async (tx) => {
      await tx.followUpRecord.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: ids } },
      })
      await tx.resourceOwnerHistory.deleteMany({
        where: { tenantId: user.tenantId, module: 'customer', resourceId: { in: ids } },
      })
      await tx.customerRelation.deleteMany({
        where: {
          tenantId: user.tenantId,
          OR: [{ sourceCustomerId: { in: ids } }, { targetCustomerId: { in: ids } }],
        },
      })
      await tx.customerTeamMember.deleteMany({
        where: { tenantId: user.tenantId, customerId: { in: ids } },
      })
      await tx.attachment.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'customer', targetId: { in: ids } },
      })
      await tx.customer.deleteMany({ where: { tenantId: user.tenantId, id: { in: ids } } })
    })

    for (const customer of customers) {
      await this.changeLog.record(user, {
        module: 'customer',
        action: 'delete',
        targetId: customer.id,
        targetName: customer.name,
        before: customer,
        after: null,
      })
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'CUSTOMER_DELETED',
        operatorId: user.id,
        recipientIds: [customer.ownerId],
        excludeSelf: true,
        type: 'system',
        title: '客户已删除',
        content: `${user.name} 删除了客户「${customer.name}」`,
        link: '/customers',
      })
    }
  }

  private async resolveListScope(
    user: AuthUser,
    view?: 'ALL' | 'SELF' | 'DEPARTMENT' | 'COLLABORATION',
  ): Promise<Prisma.CustomerWhereInput> {
    if (!view)
      return (await this.dataScope.scopeFilter(user, 'menu:customer')) as Prisma.CustomerWhereInput
    if (view === 'SELF') return { ownerId: user.id }
    if (view === 'COLLABORATION') {
      return { teamMembers: { some: { tenantId: user.tenantId, userId: user.id } } }
    }
    if (view === 'ALL') {
      const roles = user.roles.filter((role) => hasPermission(role.permissions, 'menu:customer'))
      if (!roles.some((role) => role.dataScope === 'ALL' || role.dataScope === 'CUSTOM')) {
        throw new ForbiddenException('当前角色没有全部客户视图权限')
      }
      return (await this.dataScope.scopeFilter(user, 'menu:customer')) as Prisma.CustomerWhereInput
    }
    if (view === 'DEPARTMENT') {
      const roles = user.roles.filter((role) => hasPermission(role.permissions, 'menu:customer'))
      if (!roles.some((role) => ['ALL', 'DEPT_AND_CHILD', 'CUSTOM'].includes(role.dataScope))) {
        throw new ForbiddenException('当前角色没有部门客户视图权限')
      }
      const effective = await this.dataScope.resolveScope(user, 'menu:customer')
      if (effective.all) return {}
      const deptIds = effective.deptIds
      return deptIds.length > 0
        ? { OR: [{ ownerId: user.id }, { deptId: { in: deptIds } }] }
        : { ownerId: user.id }
    }
    return (await this.dataScope.scopeFilter(user, 'menu:customer')) as Prisma.CustomerWhereInput
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

  private async scopedWhere(
    user: AuthUser,
    id: string,
    permission: string,
  ): Promise<Prisma.CustomerWhereInput> {
    const scope = await this.dataScope.scopeFilter(user, permission)
    return { id, tenantId: user.tenantId, AND: [scope] }
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const found = await this.prisma.customer.findFirst({
      where: await this.scopedWhere(user, id, permission),
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
      inSea: customer.inSea,
      poolId: customer.poolId,
      ownerId: customer.ownerId,
      ownerName: customer.owner?.name ?? null,
      deptId: customer.deptId,
      customData: { ...customData, ...formulas },
      collectedAt: customer.collectedAt?.toISOString() ?? null,
      poolEnteredAt: customer.poolEnteredAt?.toISOString() ?? null,
      lastFollowedAt: customer.lastFollowedAt?.toISOString() ?? null,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    }
  }
}
