import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { FieldVO, ImportResultVO, LeadVO, PaginatedResult } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { toCsv } from '../../common/csv'
import type {
  BatchAffectResult,
  PoolResourceBatchEditDto,
  ResourceBatchEditDto,
} from '../../common/dto/resource-batch.dto'
import { formatForExport } from '../../common/export-format'
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { BusinessChangeLogService } from '../../common/services/business-change-log.service'
import { Lead, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { MetadataService } from '../metadata/metadata.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { NotificationsService } from '../notifications/notifications.service'
import { OpportunitiesService } from '../opportunities/opportunities.service'
import { ResourcePoolsService } from '../pool-rules/resource-pools.service'
import { SavedViewsService } from '../saved-views/saved-views.service'
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
    private readonly pools: ResourcePoolsService,
    private readonly changeLog: BusinessChangeLogService,
    private readonly savedViews: SavedViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  async findAll(user: AuthUser, query: QueryLeadsDto): Promise<PaginatedResult<LeadVO>> {
    const { page = 1, pageSize = 10, keyword, scope = 'mine', status } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldsMap = new Map(fields.map((f) => [f.key, f]))
    const adHocClauses = buildFilterClauses(fieldsMap, parseFilters(query.filters))
    const viewModule = scope === 'pool' ? 'lead_pool' : 'lead'
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

    // 线索池对全员开放；非池数据按数据范围过滤
    let scopeClause: Prisma.LeadWhereInput
    if (scope === 'pool') {
      const options = await this.pools.options(user, 'lead')
      const accessiblePoolIds = options.map((pool) => pool.id)
      if (query.poolId && !accessiblePoolIds.includes(query.poolId)) {
        throw new BadRequestException('你无权访问该线索池')
      }
      scopeClause = query.poolId
        ? { inPool: true, poolId: query.poolId }
        : {
            inPool: true,
            OR: [{ poolId: { in: accessiblePoolIds } }, { poolId: null }],
          }
    } else {
      scopeClause = { inPool: false, ...(await this.dataScope.scopeFilter(user)) }
    }

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
    const { customData, ownerId, toPool, poolId, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    const owner = toPool ? null : await this.resolveOwner(user, ownerId)
    const targetPool = toPool ? await this.pools.resolveTargetPool(user, 'lead', poolId) : null
    const now = new Date()
    if (owner) await this.pools.assertCapacityForOwner(user.tenantId, 'lead', owner.id)

    const lead = await this.prisma.lead.create({
      data: {
        ...rest,
        tenantId: user.tenantId,
        inPool: Boolean(toPool),
        poolId: targetPool?.id ?? null,
        poolEnteredAt: targetPool ? now : null,
        ownerId: owner?.id ?? null,
        deptId: owner?.deptId ?? null,
        collectedAt: owner ? now : null,
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
    return this.updateExisting(user, existing, dto)
  }

  private async updateExisting(user: AuthUser, existing: Lead, dto: UpdateLeadDto): Promise<LeadVO> {
    const { customData, ownerId, toPool: _toPool, poolId: _poolId, ...rest } = dto
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
      await this.pools.assertCapacityForOwner(user.tenantId, 'lead', owner.id)
      data.ownerId = owner.id
      data.deptId = owner.deptId
      data.collectedAt = new Date()
      data.poolId = null
      data.poolEnteredAt = null
      if (existing.ownerId) {
        await this.prisma.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'lead',
            resourceId: existing.id,
            ownerId: existing.ownerId,
            operatorId: user.id,
            collectedAt: existing.collectedAt,
          },
        })
      }
      await this.notifyAssign(user, existing.id, existing.name, owner.id)
    }

    const lead = await this.prisma.lead.update({ where: { id: existing.id }, data })
    await this.changeLog.record(user, {
      module: 'lead',
      action: 'update',
      targetId: lead.id,
      targetName: lead.name,
      before: existing,
      after: lead,
    })
    return this.toSingleVO(user, lead)
  }

  async remove(user: AuthUser, id: string) {
    const lead = await this.ensureInScope(user, id)
    await this.deleteLeadResources(user, [lead])
    return { id, name: lead.name }
  }

  /** 退回线索池 */
  async moveToPool(user: AuthUser, id: string, poolId?: string, reasonId?: string) {
    const lead = await this.ensureInScope(user, id)
    if (lead.status !== 'FOLLOWING') throw new BadRequestException('已转化/无效线索不能退回线索池')
    const pool = await this.pools.resolveMoveTargetPool(user.tenantId, 'lead', lead.ownerId, poolId)
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      if (lead.ownerId) {
        await tx.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'lead',
            resourceId: lead.id,
            ownerId: lead.ownerId,
            operatorId: user.id,
            poolId: pool.id,
            reasonId,
            collectedAt: lead.collectedAt,
            endedAt: now,
          },
        })
      }
      await tx.lead.update({
        where: { id },
        data: {
          inPool: true,
          poolId: pool.id,
          poolEnteredAt: now,
          ownerId: null,
          deptId: null,
          collectedAt: null,
        },
      })
    })
    return { id, name: lead.name, poolId: pool.id }
  }

  /** 从线索池领取 */
  async claim(user: AuthUser, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId: user.tenantId, inPool: true },
    })
    if (!lead) throw new BadRequestException('线索不存在或已被他人领取')
    await this.pools.assertCanClaim(user, 'lead', lead.poolId, lead.id, lead.poolEnteredAt)
    const now = new Date()
    const result = await this.prisma.lead.updateMany({
      where: { id, tenantId: user.tenantId, inPool: true, poolId: lead.poolId },
      data: {
        inPool: false,
        poolId: null,
        poolEnteredAt: null,
        ownerId: user.id,
        deptId: user.deptId,
        collectedAt: now,
      },
    })
    if (result.count === 0) throw new BadRequestException('线索不存在或已被他人领取')
    const claimedLead = await this.prisma.lead.findUnique({ where: { id } })
    return { id, name: claimedLead?.name ?? '' }
  }

  async batchClaim(user: AuthUser, ids: string[], poolId?: string): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        if (poolId) {
          const lead = await this.prisma.lead.findFirst({
            where: { id, tenantId: user.tenantId, inPool: true },
            select: { poolId: true },
          })
          if (!lead || lead.poolId !== poolId) throw new BadRequestException('线索不属于指定线索池')
        }
        await this.claim(user, id)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** 分配负责人（主管操作） */
  async assign(user: AuthUser, id: string, dto: AssignLeadDto) {
    const lead = await this.prisma.lead.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!lead) throw new NotFoundException('线索不存在')
    const owner = await this.resolveOwner(user, dto.ownerId)
    if (lead.ownerId !== owner.id || lead.inPool) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'lead', owner.id)
    }
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      if (lead.ownerId && lead.ownerId !== owner.id) {
        await tx.resourceOwnerHistory.create({
          data: {
            tenantId: user.tenantId,
            module: 'lead',
            resourceId: lead.id,
            ownerId: lead.ownerId,
            operatorId: user.id,
            collectedAt: lead.collectedAt,
            endedAt: now,
          },
        })
      }
      await tx.lead.update({
        where: { id },
        data: {
          inPool: false,
          poolId: null,
          poolEnteredAt: null,
          ownerId: owner.id,
          deptId: owner.deptId,
          collectedAt: now,
        },
      })
    })
    await this.notifyAssign(user, lead.id, lead.name, owner.id)
    return { id, name: lead.name }
  }

  async batchAssign(user: AuthUser, ids: string[], ownerId: string): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.assign(user, id, { ownerId })
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  async batchMoveToPool(
    user: AuthUser,
    ids: string[],
    poolId?: string,
    reasonId?: string,
  ): Promise<BatchAffectResult> {
    const failedIds: string[] = []
    let success = 0
    for (const id of ids) {
      try {
        await this.moveToPool(user, id, poolId, reasonId)
        success++
      } catch {
        failedIds.push(id)
      }
    }
    return { success, fail: failedIds.length, failedIds }
  }

  /** Cordys ResourceBatchEditRequest：所有选中资源先校验权限，再统一修改一个字段。 */
  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)

    // CsBatchPermission 语义：任何一条不在当前数据范围，都在写入前整体失败。
    const leads = await Promise.all(dto.ids.map((id) => this.ensureInScope(user, id)))

    if (field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      const processCount = leads.filter((lead) => lead.ownerId !== dto.fieldValue).length
      if (processCount > 0) {
        await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.fieldValue, processCount)
      }
      for (const lead of leads) {
        if (lead.ownerId !== dto.fieldValue) await this.assign(user, lead.id, { ownerId: dto.fieldValue })
      }
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    const updateDto: UpdateLeadDto = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : ({ [field.key]: dto.fieldValue } as UpdateLeadDto)

    for (const lead of leads) await this.update(user, lead.id, updateDto)
    return { success: dto.ids.length, fail: 0, failedIds: [] }
  }

  async batchDelete(user: AuthUser, ids: string[]): Promise<BatchAffectResult> {
    const leads = await Promise.all(ids.map((id) => this.ensureInScope(user, id)))
    await this.deleteLeadResources(user, leads)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async poolBatchUpdate(
    user: AuthUser,
    dto: PoolResourceBatchEditDto,
  ): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'lead', dto.poolId)
    const leads = await this.prisma.lead.findMany({
      where: {
        tenantId: user.tenantId,
        id: { in: dto.ids },
        inPool: true,
        poolId: dto.poolId,
      },
    })
    if (leads.length !== dto.ids.length) {
      throw new BadRequestException('所选线索必须全部属于同一个指定线索池')
    }

    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    if (field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string' || !dto.fieldValue) {
        throw new BadRequestException('负责人不能为空')
      }
      await this.pools.assertCapacityForOwner(
        user.tenantId,
        'lead',
        dto.fieldValue,
        leads.length,
      )
      for (const lead of leads) await this.assign(user, lead.id, { ownerId: dto.fieldValue })
      return { success: leads.length, fail: 0, failedIds: [] }
    }

    const updateDto: UpdateLeadDto = field.key.startsWith('cf_')
      ? { customData: { [field.key]: dto.fieldValue } }
      : ({ [field.key]: dto.fieldValue } as UpdateLeadDto)
    for (const lead of leads) await this.updateExisting(user, lead, updateDto)
    return { success: leads.length, fail: 0, failedIds: [] }
  }

  async poolBatchDelete(user: AuthUser, poolId: string, ids: string[]): Promise<BatchAffectResult> {
    await this.pools.assertPoolMember(user, 'lead', poolId)
    const leads = await this.prisma.lead.findMany({
      where: { tenantId: user.tenantId, id: { in: ids }, inPool: true, poolId },
    })
    if (leads.length !== ids.length) {
      throw new BadRequestException('所选线索必须全部属于同一个指定线索池')
    }
    await this.deleteLeadResources(user, leads)
    return { success: ids.length, fail: 0, failedIds: [] }
  }

  async ownerHistory(user: AuthUser, id: string) {
    const lead = await this.prisma.lead.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, inPool: true, poolId: true },
    })
    if (!lead) throw new NotFoundException('线索不存在')
    if (lead.inPool && lead.poolId) {
      const options = await this.pools.options(user, 'lead')
      if (!options.some((pool) => pool.id === lead.poolId)) throw new NotFoundException('线索不存在或无权访问')
    } else if (!lead.inPool) {
      await this.ensureInScope(user, id)
    }
    return this.pools.ownerHistory(user, 'lead', id)
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
    await this.pools.assertCapacityForOwner(user.tenantId, 'customer', owner.id)
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
          collectedAt: new Date(),
        },
      })
      let contactId: string | null = null
      if ((dto.createContact ?? true) && lead.contactName) {
        const contact = await tx.contact.create({
          data: {
            tenantId: user.tenantId,
            customerId: customer.id,
            ownerId: owner.id,
            deptId: owner.deptId,
            name: lead.contactName,
            phone: lead.phone,
            enable: true,
          },
        })
        contactId = contact.id
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
            contactId,
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
        data: {
          status: 'CONVERTED',
          convertedCustomerId: customer.id,
          inPool: false,
          poolId: null,
          poolEnteredAt: null,
        },
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

  async importTemplate(
    user: AuthUser,
    importType: ImportType,
    poolId?: string,
  ): Promise<{ filename: string; data: Buffer }> {
    if (poolId) await this.pools.assertPoolMember(user, 'lead', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: poolId ? ['ownerId'] : [],
    })
    return {
      filename: `${poolId ? '线索池' : '线索'}${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
    poolId?: string,
  ): Promise<ImportResultVO> {
    if (poolId) await this.pools.assertPoolMember(user, 'lead', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (errors.length === 0) {
        try {
          await this.prepareImportRow(user, row.values, fields, importType, row.resourceId, poolId)
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
    if (poolId) await this.pools.assertPoolMember(user, 'lead', poolId)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: poolId ? ['ownerId'] : [],
    })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
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
            await this.create(user, {
              ...prepared.dto,
              ...(poolId ? { toPool: true, poolId } : {}),
            } as CreateLeadDto)
          } else if (poolId) {
            if (!prepared.existing) throw new BadRequestException('线索不存在或不属于当前线索池')
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
    query: QueryLeadsDto,
    input: { fileName: string; headList: string[]; ids?: string[]; poolId?: string },
  ) {
    const poolMode = Boolean(input.poolId)
    if (poolMode) await this.pools.assertPoolMember(user, 'lead', input.poolId as string)
    const effectiveQuery: QueryLeadsDto = {
      ...query,
      scope: poolMode ? 'pool' : 'mine',
      poolId: poolMode ? input.poolId : undefined,
    }
    const items = await this.collectExportItems(user, effectiveQuery, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(fields.filter((field) => !field.hidden).map((field) => [field.key, field]))
    const extraColumns = new Map([
      ['status', '状态'],
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
    const statusLabels: Record<string, string> = {
      FOLLOWING: '跟进中',
      CONVERTED: '已转化',
      INVALID: '无效',
    }
    const rows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          const field = fieldMap.get(column.key)
          if (field) return [column.key, formatForExport(field, source)]
          if (column.key === 'status') return [column.key, statusLabels[item.status] ?? item.status]
          return [column.key, source[column.key] ?? '']
        }),
      )
    })
    return this.exportTasks.create(user, {
      module: poolMode ? 'lead_pool' : 'lead',
      fileName: input.fileName,
      columns,
      rows,
    })
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

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
    poolId?: string,
  ): Promise<{ dto: UpdateLeadDto; existing?: Lead }> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const dto: UpdateLeadDto = {}
    const customData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap.get(key)
      if (!field || field.hidden || field.type === 'formula') continue
      this.metadata.validateBatchFieldValue(field, value)
      if (poolId && key === 'ownerId') throw new BadRequestException('线索池导入不允许设置负责人')
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
      if (!name) throw new BadRequestException('线索名称不能为空')
      if (!poolId) await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.ownerId ?? user.id)
      else await this.pools.resolveTargetPool(user, 'lead', poolId)
      return { dto }
    }

    if (!resourceId) throw new BadRequestException('唯一ID不能为空')
    const existing = poolId
      ? await this.prisma.lead.findFirst({
          where: { id: resourceId, tenantId: user.tenantId, inPool: true, poolId },
        })
      : await this.ensureInScope(user, resourceId)
    if (!existing) throw new BadRequestException('线索不存在或不属于当前线索池')
    if (dto.ownerId && dto.ownerId !== existing.ownerId) {
      await this.pools.assertCapacityForOwner(user.tenantId, 'lead', dto.ownerId)
    }
    return { dto, existing }
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

  private async collectExportItems(user: AuthUser, query: QueryLeadsDto, ids?: string[]) {
    const all: LeadVO[] = []
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
    if (selected.length !== wanted.size) throw new BadRequestException('选中数据包含不存在或无权导出的线索')
    return selected
  }

  private async deleteLeadResources(user: AuthUser, leads: Lead[]) {
    const ids = leads.map((lead) => lead.id)
    await this.prisma.$transaction(async (tx) => {
      await tx.followUpRecord.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'lead', targetId: { in: ids } },
      })
      await tx.resourceOwnerHistory.deleteMany({
        where: { tenantId: user.tenantId, module: 'lead', resourceId: { in: ids } },
      })
      await tx.attachment.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'lead', targetId: { in: ids } },
      })
      await tx.lead.deleteMany({ where: { tenantId: user.tenantId, id: { in: ids } } })
    })
    for (const lead of leads) {
      await this.changeLog.record(user, {
        module: 'lead',
        action: 'delete',
        targetId: lead.id,
        targetName: lead.name,
        before: lead,
        after: null,
      })
      if (lead.ownerId && lead.ownerId !== user.id) {
        await this.notifications.notify(user.tenantId, lead.ownerId, {
          type: 'system',
          title: '线索已删除',
          content: `${user.name} 删除了线索「${lead.name}」`,
          link: '/leads',
        })
      }
    }
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
      poolId: lead.poolId,
      ownerId: lead.ownerId,
      ownerName: lead.ownerId ? (ownerMap.get(lead.ownerId) ?? null) : null,
      deptId: lead.deptId,
      customData: { ...customData, ...formulas },
      convertedCustomerId: lead.convertedCustomerId,
      collectedAt: lead.collectedAt?.toISOString() ?? null,
      poolEnteredAt: lead.poolEnteredAt?.toISOString() ?? null,
      lastFollowedAt: lead.lastFollowedAt?.toISOString() ?? null,
      createdAt: lead.createdAt.toISOString(),
      updatedAt: lead.updatedAt.toISOString(),
    }
  }
}
