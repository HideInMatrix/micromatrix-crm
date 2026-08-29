import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type FieldVO,
  isCustomFieldKey,
  type FilterCondition,
  type OpportunityStageVO,
  type OpportunityVO,
  type PaginatedResult,
  type StageLogVO,
  type ImportResultVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { formatForExport } from '../../common/export-format'
import { parseFilters } from '../../common/filter-builder'
import type { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Opportunity, OpportunityStageConfig, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { DictionariesService } from '../dictionaries/dictionaries.service'
import { HomeFilterService } from '../home/home-filter.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { MetadataService } from '../metadata/metadata.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { UserViewsService } from '../user-views/user-views.service'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import {
  ChangeStageDto,
  CreateOpportunityDto,
  OpportunityAddDto,
  OpportunityBoardSortDto,
  OpportunityChartDto,
  OpportunityExportDto,
  OpportunityExportSelectDto,
  OpportunityPageDto,
  OpportunityStatisticDto,
  OpportunityTransferDto,
  OpportunityUpdateDto,
  QueryOpportunitiesDto,
  OpportunityStageUpdateDto,
  OpportunityStageAddDto,
  OpportunityStageEditDto,
  OpportunityStageRollbackDto,
  UpdateOpportunityDto,
} from './dto/opportunity.dto'

const MODULE = 'opportunity'

type OpportunityWithRefs = Opportunity & {
  customer: { name: string } | null
  contact: { name: string } | null
  stageConfig: OpportunityStageConfig
}

const refInclude = {
  customer: { select: { name: true } },
  contact: { select: { name: true } },
  stageConfig: true,
} as const

const DEFAULT_STAGES = [
  { name: '新建', type: 'AFOOT', rate: '10', pos: 1 },
  { name: '需求明确', type: 'AFOOT', rate: '30', pos: 2 },
  { name: '方案验证', type: 'AFOOT', rate: '50', pos: 3 },
  { name: '立项汇报', type: 'AFOOT', rate: '70', pos: 4 },
  { name: '商务采购', type: 'AFOOT', rate: '90', pos: 5 },
  { name: '成功', type: 'END', rate: '100', pos: 6 },
  { name: '失败', type: 'END', rate: '0', pos: 7 },
] as const

@Injectable()
export class OpportunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly notifications: BusinessNotificationsService,
    private readonly homeFilters: HomeFilterService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly dictionaries: DictionariesService,
  ) {}

  getModuleForm(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, MODULE)
  }

  async page(user: AuthUser, dto: OpportunityPageDto) {
    if (dto.board) {
      const result = await this.kanban(user)
      return { list: result.items, stages: result.stages, total: Object.values(result.items).flat().length }
    }
    const result = await this.findAll(user, {
      page: dto.current,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      viewId: dto.viewId,
      filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      homeFilter: dto.homeFilter,
    })
    return {
      list: result.items,
      total: result.total,
      pageSize: result.pageSize,
      current: result.page,
      optionMap: {},
    }
  }

  async statistic(user: AuthUser, dto: OpportunityStatisticDto) {
    const result = await this.findAll(user, {
      page: 1,
      pageSize: 500,
      keyword: dto.keyword,
      customerId: dto.customerId,
      viewId: dto.viewId,
      filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      homeFilter: dto.homeFilter,
    })
    const amount = result.items.reduce((sum, item) => sum + Number(item.amount ?? 0), 0)
    return {
      amount: Math.round(amount * 100) / 100,
      averageAmount: result.total > 0 ? Math.round((amount / result.total) * 100) / 100 : 0,
    }
  }

  async addOpportunity(user: AuthUser, dto: OpportunityAddDto) {
    const customData = await this.moduleFieldsToCustomData(user, dto.moduleFields)
    const result = await this.create(user, {
      name: dto.name,
      customerId: dto.customerId ?? '',
      contactId: dto.contactId,
      amount: dto.amount,
      ownerId: dto.owner,
      expectedCloseAt:
        dto.expectedEndTime === undefined ? undefined : new Date(dto.expectedEndTime).toISOString(),
      customData,
      items: dto.products?.map((productId) => ({
        productId,
        productName: productId,
        quantity: 1,
        unitPrice: 0,
      })),
      possible: dto.possible,
    } as CreateOpportunityDto)
    if (dto.follower !== undefined || dto.followTime !== undefined) {
      await this.prisma.opportunity.update({
        where: { id: result.id },
        data: {
          follower: dto.follower ?? null,
          followTime: dto.followTime === undefined ? null : BigInt(dto.followTime),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
    }
    return this.findOne(user, result.id)
  }

  async updateOpportunity(user: AuthUser, dto: OpportunityUpdateDto) {
    const customData =
      dto.moduleFields === undefined
        ? undefined
        : await this.moduleFieldsToCustomData(user, dto.moduleFields)
    const result = await this.update(user, dto.id, {
      name: dto.name,
      customerId: dto.customerId,
      contactId: dto.contactId,
      amount: dto.amount,
      ownerId: dto.owner,
      expectedCloseAt:
        dto.expectedEndTime === undefined ? undefined : new Date(dto.expectedEndTime).toISOString(),
      customData,
      items:
        dto.products === undefined
          ? undefined
          : dto.products.map((productId) => ({
              productId,
              productName: productId,
              quantity: 1,
              unitPrice: 0,
            })),
      possible: dto.possible,
    } as UpdateOpportunityDto)
    if (dto.follower !== undefined || dto.followTime !== undefined) {
      await this.prisma.opportunity.update({
        where: { id: dto.id },
        data: {
          ...(dto.follower !== undefined ? { follower: dto.follower ?? null } : {}),
          ...(dto.followTime !== undefined
            ? { followTime: dto.followTime === null ? null : BigInt(dto.followTime) }
            : {}),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
    }
    return this.findOne(user, result.id)
  }

  async batchTransfer(user: AuthUser, dto: OpportunityTransferDto) {
    const owner = await this.resolveOwner(user, dto.owner)
    const rows = await this.assertBatchInScope(user, dto.ids, 'opportunity:transfer')
    const now = BigInt(Date.now())
    await this.prisma.opportunity.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, organizationId: user.tenantId },
      data: { owner: owner.id, updateTime: now, updateUser: user.id },
    })
    return { count: rows.length }
  }

  async batchDelete(user: AuthUser, ids: string[]) {
    const rows = await this.assertBatchInScope(user, ids, 'opportunity:delete')
    await this.prisma.opportunity.deleteMany({
      where: { id: { in: rows.map((row) => row.id) }, organizationId: user.tenantId },
    })
    return { count: rows.length }
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto) {
    const rows = await this.assertBatchInScope(user, dto.ids, 'opportunity:update')
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.type === 'formula' || field.hidden) {
      throw new BadRequestException('字段不存在或不支持批量修改')
    }
    if (!field.system || isCustomFieldKey(field.key)) {
      return this.prisma.$transaction(async (tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'opportunity',
          rows.map((row) => row.id),
          field.id,
          dto.fieldValue,
          tx,
        ),
      )
    }
    const data = await this.systemBatchUpdateData(user, field.key, dto.fieldValue)
    await this.prisma.opportunity.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, organizationId: user.tenantId },
      data: { ...data, updateTime: BigInt(Date.now()), updateUser: user.id },
    })
    return { count: rows.length }
  }

  async getTabEnable(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, 'menu:opportunity')
    return { all: scope.all, dept: !scope.all && scope.deptIds.length > 0 }
  }

  async contactList(user: AuthUser, opportunityId: string) {
    const opportunity = await this.ensureInScope(user, opportunityId, 'menu:opportunity')
    if (!opportunity.customerId) return { list: [] }
    const contacts = await this.prisma.customerContact.findMany({
      where: {
        organizationId: user.tenantId,
        customerId: opportunity.customerId,
        enable: true,
      },
      select: { id: true, name: true, phone: true, owner: true },
      orderBy: { createTime: 'asc' },
    })
    const ownerMap = await this.ownerNames(contacts.map((contact) => contact.owner))
    const list = contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      ownerId: contact.owner,
      ownerName: ownerMap.get(contact.owner) ?? null,
    }))
    return { list }
  }

  async updateStageCordys(user: AuthUser, dto: OpportunityStageUpdateDto) {
    return this.changeStage(user, dto.id, {
      stageId: dto.stage,
      lostReason: dto.failureReason,
    })
  }

  async sortBoard(user: AuthUser, dto: OpportunityBoardSortDto) {
    const moving = await this.ensureInScope(user, dto.dragNodeId, 'opportunity:update')
    const targetStage = await this.ensureStage(user.tenantId, dto.stage)
    const targetRows = await this.prisma.opportunity.findMany({
      where: {
        organizationId: user.tenantId,
        stage: targetStage.id,
        id: { not: moving.id },
      },
      orderBy: [{ pos: 'asc' }, { updateTime: 'asc' }],
      select: { id: true },
    })
    const ordered = targetRows.map((row) => row.id)
    const targetIndex = dto.dropNodeId ? ordered.indexOf(dto.dropNodeId) : -1
    const insertAt =
      targetIndex < 0 ? ordered.length : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    ordered.splice(insertAt, 0, moving.id)
    const now = BigInt(Date.now())
    await this.prisma.$transaction(async (tx) => {
      for (const [index, id] of ordered.entries()) {
        await tx.opportunity.update({
          where: { id },
          data: {
            ...(id === moving.id
              ? {
                  lastStage: moving.stage === targetStage.id ? moving.lastStage : moving.stage,
                  stage: targetStage.id,
                  actualEndTime: targetStage.type === 'END' ? now : null,
                }
              : {}),
            pos: BigInt(index + 1),
            updateTime: now,
            updateUser: user.id,
          },
        })
      }
      if (dto.fields?.length) {
        await this.fieldValues.save(
          user.tenantId,
          'opportunity',
          moving.id,
          await this.moduleFieldsToCustomData(user, dto.fields),
          'update',
          tx,
        )
      }
    })
    return { id: moving.id, stage: targetStage.id, pos: insertAt + 1 }
  }

  async exportAll(user: AuthUser, dto: OpportunityExportDto) {
    return this.exportXlsx(user, dto, { fileName: dto.fileName, headList: dto.headList })
  }

  async exportSelected(user: AuthUser, dto: OpportunityExportSelectDto) {
    return this.exportXlsx(
      user,
      {},
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids },
    )
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType)
    return {
      filename: `商机${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          await this.prepareImportRow(user, row.values, fields, importType, row.resourceId)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '数据校验失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
      else successCount++
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async importXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          const prepared = await this.prepareImportRow(
            user,
            row.values,
            fields,
            importType,
            row.resourceId,
          )
          if (importType === 'ADD') await this.addOpportunity(user, prepared.add)
          else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.updateOpportunity(user, { id: row.resourceId, ...prepared.update })
          }
          successCount++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '导入失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async chart(user: AuthUser, dto: OpportunityChartDto) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const resolveField = (fieldId?: string) =>
      fieldId ? fields.find((field) => field.id === fieldId || field.key === fieldId) : undefined
    const categoryField = resolveField(dto.chartConfig.categoryAxis.fieldId)
    if (!categoryField) throw new BadRequestException('图表类别字段不存在')
    const subCategoryField = resolveField(dto.chartConfig.subCategoryAxis?.fieldId)
    if (dto.chartConfig.subCategoryAxis && !subCategoryField) {
      throw new BadRequestException('图表子类别字段不存在')
    }
    const aggregateMethod = dto.chartConfig.valueAxis.aggregateMethod ?? 'COUNT'
    const valueField = resolveField(dto.chartConfig.valueAxis.fieldId)
    if (aggregateMethod !== 'COUNT' && !valueField) {
      throw new BadRequestException('图表值字段不存在')
    }

    const items: OpportunityVO[] = []
    let page = 1
    const pageSize = 500
    while (true) {
      const result = await this.findAll(user, {
        page,
        pageSize,
        viewId: dto.viewId,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      })
      items.push(...result.items)
      if (items.length >= result.total || !result.items.length) break
      page++
    }

    type Bucket = {
      category: unknown
      categoryName: string
      subCategory: unknown
      subCategoryName: string
      values: number[]
      count: number
    }
    const buckets = new Map<string, Bucket>()
    for (const item of items) {
      const category = this.chartFieldValue(item, categoryField.key)
      const subCategory = subCategoryField
        ? this.chartFieldValue(item, subCategoryField.key)
        : null
      const key = JSON.stringify([category, subCategory])
      const bucket = buckets.get(key) ?? {
        category,
        categoryName: this.chartFieldLabel(categoryField, category),
        subCategory,
        subCategoryName: subCategoryField
          ? this.chartFieldLabel(subCategoryField, subCategory)
          : '',
        values: [],
        count: 0,
      }
      bucket.count++
      if (valueField) {
        const raw = this.chartFieldValue(item, valueField.key)
        const numeric = typeof raw === 'number' ? raw : Number(raw)
        if (Number.isFinite(numeric)) bucket.values.push(numeric)
      }
      buckets.set(key, bucket)
    }
    return [...buckets.values()].map((bucket) => ({
      categoryAxis: bucket.category == null ? '' : String(bucket.category),
      categoryAxisName: bucket.categoryName,
      subCategoryAxis: bucket.subCategory == null ? '' : String(bucket.subCategory),
      subCategoryAxisName: bucket.subCategoryName,
      valueAxis: this.aggregateChartValues(aggregateMethod, bucket.count, bucket.values),
    }))
  }

  async listStages(organizationId: string): Promise<OpportunityStageVO[]> {
    await this.ensureDefaultStages(organizationId)
    const rows = await this.prisma.opportunityStageConfig.findMany({
      where: { organizationId },
      orderBy: { pos: 'asc' },
    })
    return rows.map((stage) => this.stageToVO(stage))
  }

  async getStageConfig(user: AuthUser) {
    await this.ensureDefaultStages(user.tenantId)
    const [rows, grouped] = await Promise.all([
      this.prisma.opportunityStageConfig.findMany({
        where: { organizationId: user.tenantId },
        orderBy: { pos: 'asc' },
      }),
      this.prisma.opportunity.groupBy({
        by: ['stage'],
        where: { organizationId: user.tenantId },
        _count: { _all: true },
      }),
    ])
    const counts = new Map(grouped.map((item) => [item.stage, item._count._all]))
    const first = rows[0]
    return {
      stageConfigList: rows.map((stage) => ({
        id: stage.id,
        name: stage.name,
        type: stage.type,
        rate: stage.rate,
        afootRollBack: stage.afootRollBack,
        endRollBack: stage.endRollBack,
        pos: Number(stage.pos),
        stageHasData: (counts.get(stage.id) ?? 0) > 0,
      })),
      afootRollBack: first?.afootRollBack ?? true,
      endRollBack: first?.endRollBack ?? false,
    }
  }

  async addStageConfig(user: AuthUser, dto: OpportunityStageAddDto) {
    await this.ensureDefaultStages(user.tenantId)
    const stages = await this.prisma.opportunityStageConfig.findMany({
      where: { organizationId: user.tenantId },
      orderBy: { pos: 'asc' },
    })
    if (stages.length >= 15) throw new BadRequestException('商机阶段最多配置 15 个')
    const rate = Number(dto.rate)
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BadRequestException('赢率必须在 0-100 之间')
    }
    const type = dto.type ?? 'AFOOT'
    if (type === 'END' && rate !== 0 && rate !== 100) {
      throw new BadRequestException('完结阶段赢率只能为 0 或 100')
    }
    const targetIndex = dto.targetId ? stages.findIndex((stage) => stage.id === dto.targetId) : -1
    const firstEndIndex = stages.findIndex((stage) => stage.type === 'END')
    const defaultInsertAt =
      type === 'AFOOT' && firstEndIndex >= 0 ? firstEndIndex : stages.length
    const insertAt =
      targetIndex < 0
        ? defaultInsertAt
        : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    const first = stages[0]
    const now = BigInt(Date.now())
    const created = await this.prisma.opportunityStageConfig.create({
      data: {
        name: dto.name.trim(),
        type,
        rate: String(rate),
        afootRollBack: first?.afootRollBack ?? true,
        endRollBack: first?.endRollBack ?? false,
        pos: BigInt(insertAt + 1),
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      },
    })
    const ordered = stages.map((stage) => stage.id)
    ordered.splice(insertAt, 0, created.id)
    await this.sortStageIds(user, ordered)
    return created.id
  }

  async updateStageConfig(user: AuthUser, dto: OpportunityStageEditDto) {
    const stage = await this.ensureStage(user.tenantId, dto.id)
    const rate = dto.rate === undefined ? undefined : Number(dto.rate)
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 100)) {
      throw new BadRequestException('赢率必须在 0-100 之间')
    }
    if (stage.type === 'END' && rate !== undefined && rate !== 0 && rate !== 100) {
      throw new BadRequestException('完结阶段赢率只能为 0 或 100')
    }
    await this.prisma.opportunityStageConfig.update({
      where: { id: stage.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(rate !== undefined ? { rate: String(rate) } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
    })
  }

  async updateStageRollback(user: AuthUser, dto: OpportunityStageRollbackDto) {
    await this.ensureDefaultStages(user.tenantId)
    await this.prisma.opportunityStageConfig.updateMany({
      where: { organizationId: user.tenantId },
      data: {
        afootRollBack: dto.afootRollBack,
        endRollBack: dto.endRollBack,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
    })
  }

  async sortStageIds(user: AuthUser, ids: string[]) {
    const stages = await this.prisma.opportunityStageConfig.findMany({
      where: { organizationId: user.tenantId },
      select: { id: true },
    })
    const current = new Set(stages.map((stage) => stage.id))
    if (ids.length !== current.size || new Set(ids).size !== current.size || ids.some((id) => !current.has(id))) {
      throw new BadRequestException('阶段排序必须包含当前全部阶段且不能重复')
    }
    const now = BigInt(Date.now())
    await this.prisma.$transaction(
      ids.map((id, index) =>
        this.prisma.opportunityStageConfig.update({
          where: { id },
          data: { pos: BigInt(index + 1), updateTime: now, updateUser: user.id },
        }),
      ),
    )
  }

  async removeStage(user: AuthUser, id: string) {
    const stage = await this.ensureStage(user.tenantId, id)
    if (stage.type === 'END') throw new BadRequestException('成功/失败阶段不可删除')
    const runningCount = await this.prisma.opportunityStageConfig.count({
      where: { organizationId: user.tenantId, type: 'AFOOT' },
    })
    if (runningCount <= 1) throw new BadRequestException('至少保留一个进行中阶段')
    const count = await this.prisma.opportunity.count({
      where: { organizationId: user.tenantId, stage: id },
    })
    if (count > 0) throw new BadRequestException('该阶段下存在商机，无法删除')
    await this.prisma.opportunityStageConfig.delete({ where: { id } })
    await this.normalizeStagePositions(user.tenantId)
    return { id, name: stage.name }
  }

  async findAll(
    user: AuthUser,
    query: QueryOpportunitiesDto,
  ): Promise<PaginatedResult<OpportunityVO>> {
    const { page = 1, pageSize = 10, keyword, stageId, customerId } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const conditions = parseFilters(query.filters)
    const saved = query.viewId
      ? await this.userViews.resolveFilters(user, query.viewId, USER_VIEW_RESOURCE_TYPES.opportunity)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode)
        : null,
      conditions.length ? this.filterIds(user.tenantId, fields, conditions, 'AND') : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    const scope = await this.dataScope.directOwnerFilter(user, 'menu:opportunity')
    const homeFilter = this.homeFilters.parse(query.homeFilter, 'opportunity')
    const homeClause = homeFilter ? await this.homeFilters.opportunityWhere(user, homeFilter) : null

    const where: Prisma.OpportunityWhereInput = {
      organizationId: user.tenantId,
      AND: [
        scope as Prisma.OpportunityWhereInput,
        ...(homeClause ? [homeClause] : []),
      ],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(stageId ? { stage: stageId } : {}),
      ...(customerId ? { customerId } : {}),
      ...(keyword ? { name: { contains: keyword, mode: 'insensitive' } } : {}),
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.opportunity.findMany({
        where,
        include: refInclude,
        orderBy: { createTime: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunity.count({ where }),
    ])
    const [ownerMap, values, reasonMap] = await Promise.all([
      this.ownerNames(rows.map((row) => row.owner)),
      this.fieldValues.load(user.tenantId, 'opportunity', rows.map((row) => row.id)),
      this.failureReasonNames(user.tenantId),
    ])
    return {
      items: rows.map((row) =>
        this.toVO(row, fields, ownerMap, values.get(row.id) ?? {}, reasonMap),
      ),
      total,
      page,
      pageSize,
    }
  }

  async findOne(user: AuthUser, id: string): Promise<OpportunityVO> {
    const scope = await this.dataScope.directOwnerFilter(user, 'menu:opportunity')
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, organizationId: user.tenantId, AND: [scope as Prisma.OpportunityWhereInput] },
      include: refInclude,
    })
    if (!opportunity) throw new NotFoundException('商机不存在或不在你的数据范围内')
    return this.toSingleVO(user, opportunity)
  }

  async kanban(user: AuthUser): Promise<{
    stages: OpportunityStageVO[]
    items: Record<string, OpportunityVO[]>
  }> {
    const stages = await this.listStages(user.tenantId)
    const [scope, fields] = await Promise.all([
      this.dataScope.directOwnerFilter(user, 'menu:opportunity'),
      this.metadata.listFields(user.tenantId, MODULE),
    ])
    const rows = await this.prisma.opportunity.findMany({
      where: { organizationId: user.tenantId, AND: [scope as Prisma.OpportunityWhereInput] },
      include: refInclude,
      orderBy: [{ stage: 'asc' }, { pos: 'asc' }, { updateTime: 'desc' }],
      take: 500,
    })
    const [ownerMap, values, reasonMap] = await Promise.all([
      this.ownerNames(rows.map((row) => row.owner)),
      this.fieldValues.load(user.tenantId, 'opportunity', rows.map((row) => row.id)),
      this.failureReasonNames(user.tenantId),
    ])
    const items: Record<string, OpportunityVO[]> = Object.fromEntries(
      stages.map((stage) => [stage.id, []]),
    )
    for (const row of rows) {
      items[row.stage]?.push(
        this.toVO(row, fields, ownerMap, values.get(row.id) ?? {}, reasonMap),
      )
    }
    return {
      stages: stages.map((stage) => ({
        ...stage,
        count: items[stage.id]?.length ?? 0,
        amountSum: (items[stage.id] ?? []).reduce((sum, item) => sum + (item.amount ?? 0), 0),
      })),
      items,
    }
  }

  async create(user: AuthUser, dto: CreateOpportunityDto): Promise<OpportunityVO> {
    const customerId = dto.customerId || null
    if (customerId) await this.assertCustomer(user.tenantId, customerId)
    if (dto.contactId) {
      if (!customerId) throw new BadRequestException('选择联系人前请先选择客户')
      await this.assertContactBelongsToCustomer(user.tenantId, dto.contactId, customerId)
    }
    const stages = await this.listStages(user.tenantId)
    const stage = dto.stageId
      ? await this.ensureStage(user.tenantId, dto.stageId)
      : await this.ensureStage(user.tenantId, stages[0]?.id ?? '')
    const owner = await this.resolveOwner(user, dto.ownerId)
    const productIds = this.productIdsFromItems(dto.items)
    await this.validateProducts(user.tenantId, productIds)
    const possible = this.numberFromDto(dto, 'possible')
    const now = BigInt(Date.now())
    const pos = await this.nextPosition(user.tenantId, stage.id)
    const customData = dto.customData ?? {}

    const opportunity = await this.prisma.$transaction(async (tx) => {
      const created = await tx.opportunity.create({
        data: {
          customerId,
          name: dto.name,
          amount: dto.amount ?? null,
          possible,
          products: productIds.length ? JSON.stringify(productIds) : null,
          organizationId: user.tenantId,
          stage: stage.id,
          contactId: dto.contactId ?? null,
          owner: owner.id,
          updateUser: user.id,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          expectedEndTime: dto.expectedCloseAt ? BigInt(new Date(dto.expectedCloseAt).getTime()) : null,
          actualEndTime: stage.type === 'END' ? now : null,
          failureReason: null,
          pos,
        },
        include: refInclude,
      })
      await this.fieldValues.save(user.tenantId, 'opportunity', created.id, customData, 'create', tx)
      return created
    })

    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'BUSINESS_ADD',
      operatorId: user.id,
      recipientIds: [owner.id],
      excludeSelf: true,
      type: 'system',
      title: '新建商机',
      content: `${user.name} 新建了商机「${opportunity.name}」并将你设为负责人`,
      link: `/opportunities?id=${opportunity.id}`,
    })
    return this.toSingleVO(user, opportunity)
  }

  async update(user: AuthUser, id: string, dto: UpdateOpportunityDto): Promise<OpportunityVO> {
    const existing = await this.ensureInScope(user, id, 'opportunity:update')
    const customerId = dto.customerId !== undefined ? dto.customerId || null : existing.customerId
    if (customerId) await this.assertCustomer(user.tenantId, customerId)
    const contactId = dto.contactId !== undefined ? dto.contactId || null : existing.contactId
    if (contactId) {
      if (!customerId) throw new BadRequestException('选择联系人前请先选择客户')
      await this.assertContactBelongsToCustomer(user.tenantId, contactId, customerId)
    }
    const owner = dto.ownerId ? await this.resolveOwner(user, dto.ownerId) : null
    const productIds = dto.items !== undefined ? this.productIdsFromItems(dto.items) : null
    if (productIds) await this.validateProducts(user.tenantId, productIds)
    const customData = dto.customData
    const possible = this.numberFromDto(dto, 'possible')
    const now = BigInt(Date.now())
    const data: Prisma.OpportunityUncheckedUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(possible !== undefined ? { possible } : {}),
      ...(dto.customerId !== undefined ? { customerId } : {}),
      ...(dto.contactId !== undefined || dto.customerId !== undefined ? { contactId } : {}),
      ...(owner ? { owner: owner.id } : {}),
      ...(productIds ? { products: productIds.length ? JSON.stringify(productIds) : null } : {}),
      ...(dto.expectedCloseAt !== undefined
        ? { expectedEndTime: dto.expectedCloseAt ? BigInt(new Date(dto.expectedCloseAt).getTime()) : null }
        : {}),
      updateTime: now,
      updateUser: user.id,
    }
    const opportunity = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.opportunity.update({ where: { id }, data, include: refInclude })
      if (customData !== undefined) {
        await this.fieldValues.save(user.tenantId, 'opportunity', id, customData, 'update', tx)
      }
      return updated
    })
    if (owner && owner.id !== existing.owner) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'BUSINESS_TRANSFER',
        operatorId: user.id,
        recipientIds: [owner.id],
        excludeSelf: true,
        type: 'assign',
        title: '商机已转移给你',
        content: `${user.name} 将商机「${opportunity.name}」转移给你`,
        link: `/opportunities?id=${opportunity.id}`,
      })
    }
    return this.toSingleVO(user, opportunity)
  }

  async changeStage(user: AuthUser, id: string, dto: ChangeStageDto) {
    const existing = await this.ensureInScope(user, id, 'opportunity:stage')
    const [fromStage, targetStage] = await Promise.all([
      this.ensureStage(user.tenantId, existing.stage),
      this.ensureStage(user.tenantId, dto.stageId),
    ])
    if (fromStage.id !== targetStage.id) {
      if (fromStage.type === 'END' && !fromStage.endRollBack) {
        throw new BadRequestException('当前配置不允许从完结阶段回退')
      }
      if (
        fromStage.type === 'AFOOT' &&
        targetStage.type === 'AFOOT' &&
        targetStage.pos < fromStage.pos &&
        !fromStage.afootRollBack
      ) {
        throw new BadRequestException('当前配置不允许进行中阶段回退')
      }
    }
    const failureReason = this.isFailureStage(targetStage)
      ? await this.dictionaries.validateReason(
          user.tenantId,
          'OPPORTUNITY_FAIL_RS',
          dto.lostReason?.trim(),
        )
      : null
    const now = BigInt(Date.now())
    await this.prisma.opportunity.update({
      where: { id },
      data: {
        lastStage: existing.stage,
        stage: targetStage.id,
        actualEndTime: targetStage.type === 'END' ? now : null,
        failureReason: failureReason?.id ?? null,
        pos: await this.nextPosition(user.tenantId, targetStage.id),
        updateTime: now,
        updateUser: user.id,
      },
    })
    return { id, name: existing.name, stage: targetStage.name }
  }

  async stageLogs(user: AuthUser, id: string): Promise<StageLogVO[]> {
    await this.ensureInScope(user, id, 'menu:opportunity')
    return []
  }

  async remove(user: AuthUser, id: string) {
    const opportunity = await this.ensureInScope(user, id, 'opportunity:delete')
    await this.prisma.opportunity.delete({ where: { id } })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'BUSINESS_DELETED',
      operatorId: user.id,
      recipientIds: [opportunity.owner],
      excludeSelf: true,
      type: 'system',
      title: '商机已删除',
      content: `${user.name} 删除了商机「${opportunity.name}」`,
      link: '/opportunities',
    })
    return { id, name: opportunity.name }
  }

  async ensureDefaultStages(organizationId: string) {
    const count = await this.prisma.opportunityStageConfig.count({ where: { organizationId } })
    if (count > 0) return
    const now = BigInt(Date.now())
    await this.prisma.opportunityStageConfig.createMany({
      data: DEFAULT_STAGES.map((stage) => ({
        organizationId,
        name: stage.name,
        type: stage.type,
        rate: stage.rate,
        afootRollBack: true,
        endRollBack: false,
        pos: BigInt(stage.pos),
        createTime: now,
        updateTime: now,
        createUser: 'system',
        updateUser: 'system',
      })),
    })
  }

  private async normalizeStagePositions(organizationId: string) {
    const stages = await this.prisma.opportunityStageConfig.findMany({
      where: { organizationId },
      orderBy: { pos: 'asc' },
    })
    const running = stages.filter((stage) => stage.type === 'AFOOT')
    const ended = stages.filter((stage) => stage.type === 'END')
    await this.prisma.$transaction(
      [...running, ...ended].map((stage, index) =>
        this.prisma.opportunityStageConfig.update({
          where: { id: stage.id },
          data: { pos: BigInt(index + 1) },
        }),
      ),
    )
  }

  private async ensureStage(organizationId: string, id: string) {
    const stage = await this.prisma.opportunityStageConfig.findFirst({ where: { id, organizationId } })
    if (!stage) throw new NotFoundException('商机阶段不存在')
    return stage
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    const opportunity = await this.prisma.opportunity.findFirst({
      where: { id, organizationId: user.tenantId, AND: [scope as Prisma.OpportunityWhereInput] },
    })
    if (!opportunity) throw new NotFoundException('商机不存在或不在你的数据范围内')
    return opportunity
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id }
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new BadRequestException('请选择商机')
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    const rows = await this.prisma.opportunity.findMany({
      where: {
        id: { in: uniqueIds },
        organizationId: user.tenantId,
        AND: [scope as Prisma.OpportunityWhereInput],
      },
      select: { id: true, name: true, owner: true },
    })
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException('选中数据包含不存在或无权操作的商机')
    }
    return rows
  }

  private async moduleFieldsToCustomData(
    user: AuthUser,
    moduleFields?: Array<{ fieldId: string; fieldValue?: unknown }>,
  ) {
    if (!moduleFields?.length) return {}
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const map = new Map(
      fields
        .filter((field) => !field.system)
        .flatMap((field) => [
          [field.id, field],
          [field.key, field],
        ]),
    )
    const values: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`动态字段不存在：${item.fieldId}`)
      values[field.key] = item.fieldValue
    }
    return values
  }

  private async systemBatchUpdateData(
    user: AuthUser,
    key: string,
    value: unknown,
  ): Promise<Prisma.OpportunityUncheckedUpdateManyInput> {
    if (key === 'name') {
      const name = String(value ?? '').trim()
      if (!name) throw new BadRequestException('商机名称不能为空')
      return { name }
    }
    if (key === 'owner') {
      const owner = await this.resolveOwner(user, String(value ?? ''))
      return { owner: owner.id }
    }
    if (key === 'amount' || key === 'possible') {
      if (value === null || value === '') return { [key]: null }
      const number = Number(value)
      if (!Number.isFinite(number)) throw new BadRequestException('数值格式不正确')
      return { [key]: number }
    }
    if (key === 'expectedEndTime') {
      if (value === null || value === '') return { expectedEndTime: null }
      const millis = typeof value === 'number' ? value : new Date(String(value)).getTime()
      if (!Number.isFinite(millis)) throw new BadRequestException('结束时间格式不正确')
      return { expectedEndTime: BigInt(millis) }
    }
    if (key === 'products') {
      const ids = Array.isArray(value)
        ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))]
        : []
      await this.validateProducts(user.tenantId, ids)
      return { products: ids.length ? JSON.stringify(ids) : null }
    }
    if (key === 'customerId') {
      const customerId = value ? String(value) : null
      if (customerId) await this.assertCustomer(user.tenantId, customerId)
      return { customerId }
    }
    if (key === 'contactId') {
      throw new BadRequestException('联系人批量修改需要逐条校验客户关系，暂不支持')
    }
    throw new BadRequestException(`字段「${key}」不支持批量修改`)
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<OpportunityPageDto>,
    input: { fileName: string; headList: string[]; ids?: string[] },
  ) {
    const items = await this.collectExportItems(user, query, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['stageName', '商机阶段'],
      ['failureReason', '失败原因'],
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
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
          if (field) return [column.key, formatForExport(field, source)]
          return [column.key, source[column.key] ?? '']
        }),
      )
    })
    return this.exportTasks.create(user, {
      module: 'opportunity',
      fileName: input.fileName,
      columns,
      rows,
    })
  }

  private async collectExportItems(
    user: AuthUser,
    query: Partial<OpportunityPageDto>,
    ids?: string[],
  ) {
    const all: OpportunityVO[] = []
    let page = 1
    const pageSize = 500
    while (true) {
      const result = await this.findAll(user, {
        page,
        pageSize,
        keyword: query.keyword,
        viewId: query.viewId,
        filters: query.filters?.length ? JSON.stringify(query.filters) : undefined,
        homeFilter: query.homeFilter,
      })
      all.push(...result.items)
      if (all.length >= result.total || !result.items.length) break
      page++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size) {
      throw new BadRequestException('选中数据包含不存在或无权导出的商机')
    }
    return selected
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ): Promise<{ add: OpportunityAddDto; update: Omit<OpportunityUpdateDto, 'id'> }> {
    if (importType === 'UPDATE' && !resourceId) throw new BadRequestException('唯一ID不能为空')
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = []
    for (const field of fields) {
      if (field.system || values[field.key] === undefined) continue
      moduleFields.push({ fieldId: field.id, fieldValue: values[field.key] })
    }
    const name = values['name'] === undefined ? undefined : String(values['name']).trim()
    if (importType === 'ADD' && !name) throw new BadRequestException('商机名称不能为空')
    const products = this.normalizeImportedProducts(values['products'])
    const expectedEndTime = this.normalizeImportedMillis(values['expectedEndTime'])
    const numberValue = (key: string) => {
      if (values[key] === undefined || values[key] === null || values[key] === '') return undefined
      const number = Number(values[key])
      if (!Number.isFinite(number)) throw new BadRequestException(`「${fieldMap.get(key)?.label ?? key}」格式不正确`)
      return number
    }
    const common = {
      ...(name !== undefined ? { name } : {}),
      ...(values['customerId'] !== undefined ? { customerId: String(values['customerId'] || '') } : {}),
      ...(values['contactId'] !== undefined ? { contactId: String(values['contactId'] || '') } : {}),
      ...(values['owner'] !== undefined ? { owner: String(values['owner'] || '') } : {}),
      ...(values['amount'] !== undefined ? { amount: numberValue('amount') } : {}),
      ...(values['possible'] !== undefined ? { possible: numberValue('possible') } : {}),
      ...(values['products'] !== undefined ? { products } : {}),
      ...(values['expectedEndTime'] !== undefined ? { expectedEndTime } : {}),
      ...(moduleFields.length ? { moduleFields } : {}),
    }
    return {
      add: common as OpportunityAddDto,
      update: common as Omit<OpportunityUpdateDto, 'id'>,
    }
  }

  private normalizeImportedProducts(value: unknown): string[] | undefined {
    if (value === undefined) return undefined
    if (Array.isArray(value)) {
      return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    }
    const text = String(value ?? '').trim()
    if (!text) return []
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map((item) => String(item).trim()).filter(Boolean))]
      }
    } catch {
      // 非 JSON 时按逗号、顿号或分号分隔产品 ID。
    }
    return [...new Set(text.split(/[,，、;；]/).map((item) => item.trim()).filter(Boolean))]
  }

  private normalizeImportedMillis(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const millis = new Date(String(value)).getTime()
    if (!Number.isFinite(millis)) throw new BadRequestException('结束时间格式不正确')
    return millis
  }

  private chartFieldValue(item: OpportunityVO, key: string): unknown {
    const systemValues: Record<string, unknown> = {
      name: item.name,
      customerId: item.customerId,
      amount: item.amount,
      possible: item.possible,
      products: item.products,
      contactId: item.contactId,
      owner: item.owner,
      expectedEndTime: item.expectedEndTime,
      stage: item.stageId,
      failureReason: item.failureReason,
      createTime: item.createTime,
      updateTime: item.updateTime,
    }
    return isCustomFieldKey(key) ? item.customData[key] : systemValues[key]
  }

  private chartFieldLabel(field: FieldVO, value: unknown) {
    if (value == null || value === '') return '空'
    const option = field.options?.find((item) => item.value === value)
    return option?.label ?? String(value)
  }

  private aggregateChartValues(
    method: 'COUNT' | 'SUM' | 'AVG' | 'MAX' | 'MIN',
    count: number,
    values: number[],
  ) {
    if (method === 'COUNT') return count
    if (!values.length) return 0
    if (method === 'SUM') return values.reduce((sum, value) => sum + value, 0)
    if (method === 'AVG') return values.reduce((sum, value) => sum + value, 0) / values.length
    if (method === 'MAX') return Math.max(...values)
    return Math.min(...values)
  }

  private async ownerNames(ownerIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds.filter(Boolean))]
    if (!ids.length) return new Map()
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    })
    return new Map(users.map((user) => [user.id, user.name]))
  }

  private async failureReasonNames(organizationId: string) {
    const config = await this.dictionaries.config(organizationId, 'OPPORTUNITY_FAIL_RS')
    return new Map(config.dictList.map((item) => [item.id, item.name]))
  }

  private async toSingleVO(user: AuthUser, opportunity: OpportunityWithRefs): Promise<OpportunityVO> {
    const [fields, ownerMap, values, reasonMap] = await Promise.all([
      this.metadata.listFields(user.tenantId, MODULE),
      this.ownerNames([opportunity.owner]),
      this.fieldValues.load(user.tenantId, 'opportunity', [opportunity.id]),
      this.failureReasonNames(user.tenantId),
    ])
    return this.toVO(opportunity, fields, ownerMap, values.get(opportunity.id) ?? {}, reasonMap)
  }

  private toVO(
    opportunity: OpportunityWithRefs,
    fields: FieldVO[],
    ownerMap: Map<string, string>,
    customData: Record<string, unknown>,
    reasonMap: Map<string, string>,
  ): OpportunityVO {
    const amount = opportunity.amount === null ? null : Number(opportunity.amount)
    const possible = opportunity.possible === null ? null : Number(opportunity.possible)
    const products = this.parseProductIds(opportunity.products)
    const record: Record<string, unknown> = {
      name: opportunity.name,
      customerId: opportunity.customerId,
      amount,
      possible,
      products,
      contactId: opportunity.contactId,
      owner: opportunity.owner,
      expectedEndTime: this.bigintToNumber(opportunity.expectedEndTime),
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    const isWon = this.isSuccessStage(opportunity.stageConfig)
    const isLost = this.isFailureStage(opportunity.stageConfig)
    const actualEndIso = this.millisToIso(opportunity.actualEndTime)
    const failureReason = opportunity.failureReason
      ? (reasonMap.get(opportunity.failureReason) ?? opportunity.failureReason)
      : null
    return {
      id: opportunity.id,
      name: opportunity.name,
      customerId: opportunity.customerId ?? '',
      customerName: opportunity.customer?.name ?? undefined,
      contactId: opportunity.contactId,
      contactName: opportunity.contact?.name ?? null,
      stageId: opportunity.stage,
      stageName: opportunity.stageConfig.name,
      stageProbability: Number(opportunity.stageConfig.rate),
      isWon,
      isLost,
      amount,
      expectedCloseAt: this.millisToDate(opportunity.expectedEndTime),
      lostReason: failureReason,
      remark: null,
      ownerId: opportunity.owner,
      ownerName: ownerMap.get(opportunity.owner) ?? null,
      deptId: null,
      customData: { ...customData, ...formulas },
      wonAt: isWon ? actualEndIso : null,
      lostAt: isLost ? actualEndIso : null,
      createdAt: this.millisToIso(opportunity.createTime) ?? new Date(0).toISOString(),
      updatedAt: this.millisToIso(opportunity.updateTime) ?? new Date(0).toISOString(),
      possible,
      products,
      expectedEndTime: this.bigintToNumber(opportunity.expectedEndTime),
      actualEndTime: this.bigintToNumber(opportunity.actualEndTime),
      failureReason,
      owner: opportunity.owner,
      createTime: this.bigintToNumber(opportunity.createTime) ?? 0,
      updateTime: this.bigintToNumber(opportunity.updateTime) ?? 0,
      createUser: opportunity.createUser,
      updateUser: opportunity.updateUser,
      follower: opportunity.follower,
      followTime: this.bigintToNumber(opportunity.followTime),
      pos: this.bigintToNumber(opportunity.pos),
    }
  }

  private stageToVO(stage: OpportunityStageConfig): OpportunityStageVO {
    return {
      id: stage.id,
      name: stage.name,
      probability: Number(stage.rate),
      sort: Number(stage.pos),
      isWon: this.isSuccessStage(stage),
      isLost: this.isFailureStage(stage),
      system: stage.type === 'END',
    }
  }

  private isSuccessStage(stage: Pick<OpportunityStageConfig, 'type' | 'rate'>) {
    return stage.type === 'END' && Number(stage.rate) === 100
  }

  private isFailureStage(stage: Pick<OpportunityStageConfig, 'type' | 'rate'>) {
    return stage.type === 'END' && Number(stage.rate) === 0
  }

  private async assertCustomer(organizationId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, organizationId },
      select: { id: true },
    })
    if (!customer) throw new BadRequestException('客户不存在')
  }

  private async assertContactBelongsToCustomer(
    organizationId: string,
    contactId: string,
    customerId: string,
  ) {
    const contact = await this.prisma.customerContact.findFirst({
      where: { id: contactId, organizationId, customerId },
      select: { id: true },
    })
    if (!contact) throw new BadRequestException('联系人不存在或不属于当前客户')
  }

  private productIdsFromItems(items: CreateOpportunityDto['items'] | UpdateOpportunityDto['items']) {
    if (!items?.length) return []
    return [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))]
  }

  private parseProductIds(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }

  private async validateProducts(tenantId: string, productIds: string[]) {
    if (!productIds.length) return
    const count = await this.prisma.product.count({
      where: { organizationId: tenantId, id: { in: productIds } },
    })
    if (count !== productIds.length) throw new BadRequestException('意向产品包含不存在的数据')
  }

  private async nextPosition(organizationId: string, stage: string) {
    const row = await this.prisma.opportunity.aggregate({
      where: { organizationId, stage },
      _max: { pos: true },
    })
    return (row._max.pos ?? 0n) + 1n
  }

  private numberFromDto(dto: object, key: string): number | null | undefined {
    const value = (dto as Record<string, unknown>)[key]
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    const number = Number(value)
    if (!Number.isFinite(number)) throw new BadRequestException(`${key} 格式不正确`)
    return number
  }

  private systemFilterClause(
    field: FieldVO | undefined,
    condition: FilterCondition,
  ): Prisma.OpportunityWhereInput | null {
    if (!field || field.type === 'formula') return null
    const key = condition.key as keyof Prisma.OpportunityWhereInput
    const isDate = field.type === 'date' || field.type === 'datetime'
    const isNumeric = ['number', 'currency', 'percent'].includes(field.type)
    const rawValue = isDate
      ? BigInt(new Date(String(condition.value)).getTime())
      : isNumeric
        ? Number(condition.value)
        : condition.value
    const value = rawValue as never
    if (condition.op === 'eq') return { [key]: { equals: value } } as Prisma.OpportunityWhereInput
    if (condition.op === 'ne') return { NOT: { [key]: { equals: value } } } as Prisma.OpportunityWhereInput
    if (condition.op === 'contains') {
      return { [key]: { contains: String(condition.value), mode: 'insensitive' } } as Prisma.OpportunityWhereInput
    }
    if (condition.op === 'gt') return { [key]: { gt: value } } as Prisma.OpportunityWhereInput
    if (condition.op === 'gte') return { [key]: { gte: value } } as Prisma.OpportunityWhereInput
    if (condition.op === 'lt') return { [key]: { lt: value } } as Prisma.OpportunityWhereInput
    if (condition.op === 'lte') return { [key]: { lte: value } } as Prisma.OpportunityWhereInput
    if (condition.op === 'isEmpty') return { [key]: null } as Prisma.OpportunityWhereInput
    if (condition.op === 'notEmpty') return { NOT: { [key]: null } } as Prisma.OpportunityWhereInput
    return null
  }

  private async filterIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ): Promise<string[]> {
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.key, field],
        ...(field.key === 'owner' ? ([['ownerId', field]] as [string, FieldVO][]) : []),
      ]),
    )
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        const normalized = condition.key === 'ownerId' ? { ...condition, key: 'owner' } : condition
        if (normalized.key === 'stage') {
          const value = String(normalized.value ?? '')
          const rows = await this.prisma.opportunity.findMany({
            where: {
              organizationId,
              ...(normalized.op === 'ne' ? { NOT: { stage: value } } : { stage: value }),
            },
            select: { id: true },
          })
          return new Set(rows.map((row) => row.id))
        }
        const field = fieldMap.get(normalized.key)
        if (!field) return new Set<string>()
        if (!field.system || isCustomFieldKey(normalized.key)) {
          return new Set(
            await this.fieldValues.filterResourceIds(organizationId, 'opportunity', [normalized]),
          )
        }
        const clause = this.systemFilterClause(field, normalized)
        if (!clause) return new Set<string>()
        const rows = await this.prisma.opportunity.findMany({
          where: { organizationId, AND: [clause] },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }),
    )
    if (!sets.length) return []
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [...sets.slice(1).reduce((result, set) => new Set([...result].filter((id) => set.has(id))), sets[0]!)]
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private bigintToNumber(value: bigint | null) {
    return value === null ? null : Number(value)
  }

  private millisToIso(value: bigint | null) {
    return value === null ? null : new Date(Number(value)).toISOString()
  }

  private millisToDate(value: bigint | null) {
    return value === null ? null : new Date(Number(value)).toISOString().slice(0, 10)
  }
}
