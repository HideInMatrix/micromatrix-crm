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
import { not } from '@prisma/orm-postgres/orm-client'
import { prisma8Numeric } from '../../prisma/prisma8-values.js'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import { DictionariesService } from '../dictionaries/dictionaries.service'
import { HomeFilterService } from '../home/home-filter.service'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
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

type Opportunity = {
  id: string
  customerId: string | null
  name: string
  amount: unknown
  possible: unknown
  products: string | null
  organizationId: string
  lastStage: string | null
  stage: string
  contactId: string | null
  owner: string
  updateUser: string
  createTime: bigint
  updateTime: bigint
  createUser: string
  follower: string | null
  followTime: bigint | null
  expectedEndTime: bigint | null
  actualEndTime: bigint | null
  failureReason: string | null
  pos: bigint | null
}

type OpportunityStageConfig = {
  id: string
  name: string
  type: string
  rate: string
  afootRollBack: boolean
  endRollBack: boolean
  pos: bigint
  organizationId: string
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
}

type OpportunityHomeClause = {
  owner?: string | { in?: string[] }
  stageConfig?: { type?: string; rate?: string }
  createTime?: { gte?: bigint; lte?: bigint }
  expectedEndTime?: { gte?: bigint; lte?: bigint }
  actualEndTime?: { gte?: bigint; lte?: bigint }
}

type OpportunityHomeWhere = {
  AND?: OpportunityHomeClause[]
}

type OpportunitySystemBatchUpdate =
  | { kind: 'name'; value: string }
  | { kind: 'owner'; value: string }
  | { kind: 'amount' | 'possible'; value: number | null }
  | { kind: 'expectedEndTime'; value: bigint | null }
  | { kind: 'products'; value: string | null }
  | { kind: 'customerId'; value: string | null }

type OpportunityWithRefs = Opportunity & {
  customer: { name: string } | null
  contact: { name: string } | null
  stageConfig: OpportunityStageConfig
}

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
    private readonly prisma8: Prisma8Service,
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
      return {
        list: result.items,
        stages: result.stages,
        total: Object.values(result.items).flat().length,
      }
    }
    const result = await this.findAll(user, {
      page: dto.current,
      pageSize: dto.pageSize,
      keyword: dto.keyword,
      viewId: dto.viewId,
      filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      filterMode: dto.filterMode,
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
      filterMode: dto.filterMode,
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
      await this.prisma8.client.orm.public.Opportunity.where({
        id: prisma8Varchar(result.id, 32),
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).update({
        follower: dto.follower ? prisma8Varchar(dto.follower, 32) : null,
        followTime: dto.followTime === undefined ? null : BigInt(dto.followTime),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
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
      await this.prisma8.client.orm.public.Opportunity.where({
        id: prisma8Varchar(dto.id, 32),
        organizationId: prisma8Varchar(user.tenantId, 32),
      }).update({
        ...(dto.follower !== undefined
          ? { follower: dto.follower ? prisma8Varchar(dto.follower, 32) : null }
          : {}),
        ...(dto.followTime !== undefined
          ? { followTime: dto.followTime === null ? null : BigInt(dto.followTime) }
          : {}),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
    }
    return this.findOne(user, result.id)
  }

  async batchTransfer(user: AuthUser, dto: OpportunityTransferDto) {
    const owner = await this.resolveOwner(user, dto.owner)
    const rows = await this.assertBatchInScope(user, dto.ids, 'opportunity:transfer')
    const now = BigInt(Date.now())
    await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .where((row) => row.id.in(prisma8Varchars(rows.map((item) => item.id), 32)))
      .updateAndCount({
        owner: prisma8Varchar(owner.id, 32),
        updateTime: now,
        updateUser: prisma8Varchar(user.id, 32),
      })
    return { count: rows.length }
  }

  async batchDelete(user: AuthUser, ids: string[]) {
    const rows = await this.assertBatchInScope(user, ids, 'opportunity:delete')
    await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .where((row) => row.id.in(prisma8Varchars(rows.map((item) => item.id), 32)))
      .deleteAll()
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
      return this.prisma8.client.transaction(async (tx) =>
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
    await this.applySystemBatchUpdate(
      user,
      rows.map((row) => row.id),
      data,
    )
    return { count: rows.length }
  }

  async getTabEnable(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, 'menu:opportunity')
    return { all: scope.all, dept: !scope.all && scope.deptIds.length > 0 }
  }

  async contactList(user: AuthUser, opportunityId: string) {
    const opportunity = await this.ensureInScope(user, opportunityId, 'menu:opportunity')
    if (!opportunity.customerId) return { list: [] }
    const contacts = await this.prisma8.client.orm.public.CustomerContact.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      customerId: prisma8Varchar(opportunity.customerId, 32),
      enable: true,
    })
      .orderBy((row) => row.createTime.asc())
      .select('id', 'name', 'phone', 'owner')
      .all()
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
    const targetRows = await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      stage: prisma8Varchar(targetStage.id, 32),
    })
      .where((row) => row.id.neq(prisma8Varchar(moving.id, 32)))
      .orderBy([(row) => row.pos.asc(), (row) => row.updateTime.asc()])
      .select('id')
      .all()
    const ordered = targetRows.map((row) => String(row.id))
    const targetIndex = dto.dropNodeId ? ordered.indexOf(dto.dropNodeId) : -1
    const insertAt =
      targetIndex < 0 ? ordered.length : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    ordered.splice(insertAt, 0, moving.id)
    const now = BigInt(Date.now())
    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, id] of ordered.entries()) {
        const updated = await tx.orm.public.Opportunity.where({
          id: prisma8Varchar(id, 32),
        }).update({
          ...(id === moving.id
            ? {
                lastStage:
                  moving.stage === targetStage.id
                    ? moving.lastStage
                      ? prisma8Varchar(moving.lastStage, 32)
                      : null
                    : prisma8Varchar(moving.stage, 32),
                stage: prisma8Varchar(targetStage.id, 32),
                actualEndTime: targetStage.type === 'END' ? now : null,
              }
            : {}),
          pos: BigInt(index + 1),
          updateTime: now,
          updateUser: prisma8Varchar(user.id, 32),
        })
        if (!updated) throw new NotFoundException('商机不存在或无权访问')
      }
      if (dto.fields?.length) {
        await this.fieldValues.save(
          user.tenantId,
          'opportunity',
          moving.id,
          await this.moduleFieldsToCustomData(user, dto.fields),
          'update',
          tx,
          user.id,
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

  async importXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
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
      const subCategory = subCategoryField ? this.chartFieldValue(item, subCategoryField.key) : null
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
    const rows = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .orderBy((row) => row.pos.asc())
      .all()
    return rows.map((stage) => this.stageToVO(this.normalizeStage(stage)))
  }

  async getStageConfig(user: AuthUser) {
    await this.ensureDefaultStages(user.tenantId)
    const rawRows = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .orderBy((row) => row.pos.asc())
      .all()
    const rows = rawRows.map((stage) => this.normalizeStage(stage))
    const counts = new Map<string, number>()
    await Promise.all(
      rows.map(async (stage) => {
        const aggregate = await this.prisma8.client.orm.public.Opportunity.where({
          organizationId: prisma8Varchar(user.tenantId, 32),
          stage: prisma8Varchar(stage.id, 32),
        }).aggregate((value) => ({ count: value.count() }))
        counts.set(stage.id, aggregate.count)
      }),
    )
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
    const rawStages = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .orderBy((row) => row.pos.asc())
      .all()
    const stages = rawStages.map((stage) => this.normalizeStage(stage))
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
    const defaultInsertAt = type === 'AFOOT' && firstEndIndex >= 0 ? firstEndIndex : stages.length
    const insertAt =
      targetIndex < 0 ? defaultInsertAt : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    const first = stages[0]
    const now = BigInt(Date.now())
    const created = await this.prisma8.client.orm.public.OpportunityStageConfig.create({
      id: prisma8Id32(),
      name: prisma8Varchar(dto.name.trim(), 16),
      _type: prisma8Varchar(type, 50),
      rate: prisma8Varchar(String(rate), 10),
      afootRollBack: first?.afootRollBack ?? true,
      endRollBack: first?.endRollBack ?? false,
      pos: BigInt(insertAt + 1),
      organizationId: prisma8Varchar(user.tenantId, 32),
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(user.id, 32),
      updateUser: prisma8Varchar(user.id, 32),
    })
    const ordered = stages.map((stage) => stage.id)
    ordered.splice(insertAt, 0, String(created.id))
    await this.sortStageIds(user, ordered)
    return String(created.id)
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
    await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      id: prisma8Varchar(stage.id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      name: dto.name === undefined ? undefined : prisma8Varchar(dto.name.trim(), 16),
      rate: rate === undefined ? undefined : prisma8Varchar(String(rate), 10),
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
  }

  async updateStageRollback(user: AuthUser, dto: OpportunityStageRollbackDto) {
    await this.ensureDefaultStages(user.tenantId)
    await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).updateAndCount({
      afootRollBack: dto.afootRollBack,
      endRollBack: dto.endRollBack,
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
  }

  async sortStageIds(user: AuthUser, ids: string[]) {
    const stages = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .select('id')
      .all()
    const current = new Set(stages.map((stage) => String(stage.id)))
    if (
      ids.length !== current.size ||
      new Set(ids).size !== current.size ||
      ids.some((id) => !current.has(id))
    ) {
      throw new BadRequestException('阶段排序必须包含当前全部阶段且不能重复')
    }
    const now = BigInt(Date.now())
    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, id] of ids.entries()) {
        await tx.orm.public.OpportunityStageConfig.where({
          id: prisma8Varchar(id, 32),
          organizationId: prisma8Varchar(user.tenantId, 32),
        }).update({
          pos: BigInt(index + 1),
          updateTime: now,
          updateUser: prisma8Varchar(user.id, 32),
        })
      }
    })
  }

  async removeStage(user: AuthUser, id: string) {
    const stage = await this.ensureStage(user.tenantId, id)
    if (stage.type === 'END') throw new BadRequestException('成功/失败阶段不可删除')
    const runningAggregate = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      _type: prisma8Varchar('AFOOT', 50),
    }).aggregate((value) => ({ count: value.count() }))
    if (runningAggregate.count <= 1) throw new BadRequestException('至少保留一个进行中阶段')
    const opportunityAggregate = await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      stage: prisma8Varchar(id, 32),
    }).aggregate((value) => ({ count: value.count() }))
    if (opportunityAggregate.count > 0) throw new BadRequestException('该阶段下存在商机，无法删除')
    await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).delete()
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
      ? await this.userViews.resolveFilters(
          user,
          query.viewId,
          USER_VIEW_RESOURCE_TYPES.opportunity,
        )
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode)
        : null,
      conditions.length
        ? this.filterIds(user.tenantId, fields, conditions, query.filterMode ?? 'AND')
        : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    let db = this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    const scope = await this.dataScope.directOwnerFilter(user, 'menu:opportunity')
    const ownerScope = scope.owner
    if (typeof ownerScope === 'string') {
      db = db.where({ owner: prisma8Varchar(ownerScope, 32) })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      db = db.where((row) => row.owner.in(prisma8Varchars(ownerIds, 32)))
    }
    const homeFilter = this.homeFilters.parse(query.homeFilter, 'opportunity')
    if (homeFilter) {
      const homeWhere = (await this.homeFilters.opportunityWhere(
        user,
        homeFilter,
      )) as unknown as OpportunityHomeWhere
      db = await this.applyHomeOpportunityWhere(db, user.tenantId, homeWhere)
    }
    if (filteredIds) db = db.where((row) => row.id.in(prisma8Varchars(filteredIds, 32)))
    if (stageId) db = db.where({ stage: prisma8Varchar(stageId, 32) })
    if (customerId) db = db.where({ customerId: prisma8Varchar(customerId, 32) })
    if (keyword) db = db.where((row) => row.name.ilike('%' + keyword + '%'))

    const [baseRows, aggregate] = await Promise.all([
      db.orderBy((row) => row.createTime.desc())
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      db.aggregate((value) => ({ count: value.count() })),
    ])
    const rows = await this.attachOpportunityRefs(baseRows as unknown as Opportunity[])
    const [ownerMap, values, reasonMap] = await Promise.all([
      this.ownerNames(rows.map((row) => row.owner)),
      this.fieldValues.load(
        user.tenantId,
        'opportunity',
        rows.map((row) => row.id),
      ),
      this.failureReasonNames(user.tenantId),
    ])
    return {
      items: rows.map((row) =>
        this.toVO(row, fields, ownerMap, values.get(row.id) ?? {}, reasonMap),
      ),
      total: aggregate.count,
      page,
      pageSize,
    }
  }

  async findOne(user: AuthUser, id: string): Promise<OpportunityVO> {
    const opportunity = await this.ensureInScope(user, id, 'menu:opportunity')
    const full = await this.loadOpportunityWithRefs(opportunity)
    return this.toSingleVO(user, full)
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
    let db = this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    const ownerScope = scope.owner
    if (typeof ownerScope === 'string') {
      db = db.where({ owner: prisma8Varchar(ownerScope, 32) })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      db = db.where((row) => row.owner.in(prisma8Varchars(ownerIds, 32)))
    }
    const baseRows = await db
      .orderBy([(row) => row.stage.asc(), (row) => row.pos.asc(), (row) => row.updateTime.desc()])
      .limit(500)
      .all()
    const rows = await this.attachOpportunityRefs(baseRows as unknown as Opportunity[])
    const [ownerMap, values, reasonMap] = await Promise.all([
      this.ownerNames(rows.map((row) => row.owner)),
      this.fieldValues.load(
        user.tenantId,
        'opportunity',
        rows.map((row) => row.id),
      ),
      this.failureReasonNames(user.tenantId),
    ])
    const items: Record<string, OpportunityVO[]> = Object.fromEntries(
      stages.map((stage) => [stage.id, []]),
    )
    for (const row of rows) {
      items[row.stage]?.push(this.toVO(row, fields, ownerMap, values.get(row.id) ?? {}, reasonMap))
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

    const opportunityId = await this.prisma8.client.transaction(async (tx) => {
      const created = await tx.orm.public.Opportunity.create({
        id: prisma8Id32(),
        customerId: customerId ? prisma8Varchar(customerId, 32) : null,
        name: prisma8Varchar(dto.name, 255),
        amount: dto.amount == null ? null : prisma8Numeric(dto.amount, 20, 10),
        possible: possible == null ? null : prisma8Numeric(possible, 20, 10),
        products: productIds.length
          ? prisma8Varchar(JSON.stringify(productIds), 1000)
          : null,
        organizationId: prisma8Varchar(user.tenantId, 32),
        stage: prisma8Varchar(stage.id, 32),
        contactId: dto.contactId ? prisma8Varchar(dto.contactId, 32) : null,
        owner: prisma8Varchar(owner.id, 32),
        updateUser: prisma8Varchar(user.id, 32),
        createTime: now,
        updateTime: now,
        createUser: prisma8Varchar(user.id, 32),
        expectedEndTime: dto.expectedCloseAt
          ? BigInt(new Date(dto.expectedCloseAt).getTime())
          : null,
        actualEndTime: stage.type === 'END' ? now : null,
        failureReason: null,
        pos,
      })
      await this.fieldValues.save(
        user.tenantId,
        'opportunity',
        created.id,
        customData,
        'create',
        tx,
        user.id,
      )
      return String(created.id)
    })
    const createdRow = await this.prisma8.client.orm.public.Opportunity.where({
      id: prisma8Varchar(opportunityId, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!createdRow) throw new NotFoundException('商机不存在')
    const opportunity = await this.loadOpportunityWithRefs(createdRow as unknown as Opportunity)

    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'BUSINESS_ADD',
      operatorId: user.id,
      recipientIds: [owner.id],
      excludeSelf: true,
      type: 'system',
      templateContext: { name: opportunity.name },
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
    await this.prisma8.client.transaction(async (tx) => {
      const updated = await tx.orm.public.Opportunity.where({ id: prisma8Varchar(id, 32) }).update({
        ...(dto.name !== undefined ? { name: prisma8Varchar(dto.name, 255) } : {}),
        ...(dto.amount !== undefined
          ? { amount: dto.amount == null ? null : prisma8Numeric(dto.amount, 20, 10) }
          : {}),
        ...(possible !== undefined
          ? { possible: possible == null ? null : prisma8Numeric(possible, 20, 10) }
          : {}),
        ...(dto.customerId !== undefined
          ? { customerId: customerId ? prisma8Varchar(customerId, 32) : null }
          : {}),
        ...(dto.contactId !== undefined || dto.customerId !== undefined
          ? { contactId: contactId ? prisma8Varchar(contactId, 32) : null }
          : {}),
        ...(owner ? { owner: prisma8Varchar(owner.id, 32) } : {}),
        ...(productIds
          ? {
              products: productIds.length
                ? prisma8Varchar(JSON.stringify(productIds), 1000)
                : null,
            }
          : {}),
        ...(dto.expectedCloseAt !== undefined
          ? {
              expectedEndTime: dto.expectedCloseAt
                ? BigInt(new Date(dto.expectedCloseAt).getTime())
                : null,
            }
          : {}),
        updateTime: now,
        updateUser: prisma8Varchar(user.id, 32),
      })
      if (!updated) throw new NotFoundException('商机不存在或无权访问')
      if (customData !== undefined) {
        await this.fieldValues.save(
          user.tenantId,
          'opportunity',
          id,
          customData,
          'update',
          tx,
          user.id,
        )
      }
    })
    const updatedRow = await this.prisma8.client.orm.public.Opportunity.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!updatedRow) throw new NotFoundException('商机不存在')
    const opportunity = await this.loadOpportunityWithRefs(updatedRow as unknown as Opportunity)
    if (owner && owner.id !== existing.owner) {
      await this.notifications.send({
        tenantId: user.tenantId,
        event: 'BUSINESS_TRANSFER',
        operatorId: user.id,
        recipientIds: [owner.id],
        excludeSelf: true,
        type: 'assign',
        templateContext: { name: opportunity.name },
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
    await this.prisma8.client.orm.public.Opportunity.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      lastStage: prisma8Varchar(existing.stage, 32),
      stage: prisma8Varchar(targetStage.id, 32),
      actualEndTime: targetStage.type === 'END' ? now : null,
      failureReason: failureReason?.id ? prisma8Varchar(failureReason.id, 50) : null,
      pos: await this.nextPosition(user.tenantId, targetStage.id),
      updateTime: now,
      updateUser: prisma8Varchar(user.id, 32),
    })
    return { id, name: existing.name, stage: targetStage.name }
  }

  async stageLogs(user: AuthUser, id: string): Promise<StageLogVO[]> {
    await this.ensureInScope(user, id, 'menu:opportunity')
    return []
  }

  async remove(user: AuthUser, id: string) {
    const opportunity = await this.ensureInScope(user, id, 'opportunity:delete')
    await this.prisma8.client.orm.public.Opportunity.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).delete()
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'BUSINESS_DELETED',
      operatorId: user.id,
      recipientIds: [opportunity.owner],
      excludeSelf: true,
      type: 'system',
      templateContext: { name: opportunity.name },
      link: '/opportunities',
    })
    return { id, name: opportunity.name }
  }

  async ensureDefaultStages(organizationId: string) {
    const aggregate = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(organizationId, 32),
    }).aggregate((value) => ({ count: value.count() }))
    if (aggregate.count > 0) return
    const now = BigInt(Date.now())
    await this.prisma8.client.transaction(async (tx) => {
      for (const stage of DEFAULT_STAGES) {
        await tx.orm.public.OpportunityStageConfig.create({
          id: prisma8Id32(),
          organizationId: prisma8Varchar(organizationId, 32),
          name: prisma8Varchar(stage.name, 16),
          _type: prisma8Varchar(stage.type, 50),
          rate: prisma8Varchar(stage.rate, 10),
          afootRollBack: true,
          endRollBack: false,
          pos: BigInt(stage.pos),
          createTime: now,
          updateTime: now,
          createUser: prisma8Varchar('system', 32),
          updateUser: prisma8Varchar('system', 32),
        })
      }
    })
  }

  private async normalizeStagePositions(organizationId: string) {
    const rawStages = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .orderBy((row) => row.pos.asc())
      .all()
    const stages = rawStages.map((stage) => this.normalizeStage(stage))
    const running = stages.filter((stage) => stage.type === 'AFOOT')
    const ended = stages.filter((stage) => stage.type === 'END')
    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, stage] of [...running, ...ended].entries()) {
        await tx.orm.public.OpportunityStageConfig.where({
          id: prisma8Varchar(stage.id, 32),
          organizationId: prisma8Varchar(organizationId, 32),
        }).update({ pos: BigInt(index + 1) })
      }
    })
  }

  private async ensureStage(organizationId: string, id: string) {
    const stage = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    }).first()
    if (!stage) throw new NotFoundException('商机阶段不存在')
    return this.normalizeStage(stage)
  }

  private async ensureInScope(user: AuthUser, id: string, permission: string) {
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    let query = this.prisma8.client.orm.public.Opportunity.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    const ownerScope = scope.owner
    if (typeof ownerScope === 'string') {
      query = query.where({ owner: prisma8Varchar(ownerScope, 32) })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      query = query.where((row) => row.owner.in(prisma8Varchars(ownerIds, 32)))
    }
    const opportunity = await query.first()
    if (!opportunity) throw new NotFoundException('商机不存在或不在你的数据范围内')
    return opportunity as unknown as Opportunity
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id }
    const owner = await this.prisma8.client.orm.public.Users.where({
      id: ownerId,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new BadRequestException('请选择商机')
    const scope = await this.dataScope.directOwnerFilter(user, permission)
    let query = this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
      .where((row) => row.id.in(prisma8Varchars(uniqueIds, 32)))
    const ownerScope = scope.owner
    if (typeof ownerScope === 'string') {
      query = query.where({ owner: prisma8Varchar(ownerScope, 32) })
    } else if (ownerScope?.in) {
      const ownerIds = ownerScope.in
      query = query.where((row) => row.owner.in(prisma8Varchars(ownerIds, 32)))
    }
    const rows = await query.select('id', 'name', 'owner').all()
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException('选中数据包含不存在或无权操作的商机')
    }
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      owner: String(row.owner),
    }))
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
  ): Promise<OpportunitySystemBatchUpdate> {
    if (key === 'name') {
      const name = String(value ?? '').trim()
      if (!name) throw new BadRequestException('商机名称不能为空')
      return { kind: 'name', value: name }
    }
    if (key === 'owner') {
      const owner = await this.resolveOwner(user, String(value ?? ''))
      return { kind: 'owner', value: owner.id }
    }
    if (key === 'amount' || key === 'possible') {
      if (value === null || value === '') return { kind: key, value: null }
      const number = Number(value)
      if (!Number.isFinite(number)) throw new BadRequestException('数值格式不正确')
      return { kind: key, value: number }
    }
    if (key === 'expectedEndTime') {
      if (value === null || value === '') return { kind: 'expectedEndTime', value: null }
      const millis = typeof value === 'number' ? value : new Date(String(value)).getTime()
      if (!Number.isFinite(millis)) throw new BadRequestException('结束时间格式不正确')
      return { kind: 'expectedEndTime', value: BigInt(millis) }
    }
    if (key === 'products') {
      const ids = Array.isArray(value)
        ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))]
        : []
      await this.validateProducts(user.tenantId, ids)
      return { kind: 'products', value: ids.length ? JSON.stringify(ids) : null }
    }
    if (key === 'customerId') {
      const customerId = value ? String(value) : null
      if (customerId) await this.assertCustomer(user.tenantId, customerId)
      return { kind: 'customerId', value: customerId }
    }
    if (key === 'contactId') {
      throw new BadRequestException('联系人批量修改需要逐条校验客户关系，暂不支持')
    }
    throw new BadRequestException('字段「' + key + '」不支持批量修改')
  }

  private async applySystemBatchUpdate(
    user: AuthUser,
    ids: string[],
    data: OpportunitySystemBatchUpdate,
  ) {
    const query = this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).where((row) => row.id.in(prisma8Varchars(ids, 32)))
    const common = {
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    }
    if (data.kind === 'name') {
      await query.updateAndCount({ ...common, name: prisma8Varchar(data.value, 255) })
      return
    }
    if (data.kind === 'owner') {
      await query.updateAndCount({ ...common, owner: prisma8Varchar(data.value, 32) })
      return
    }
    if (data.kind === 'amount') {
      await query.updateAndCount({
        ...common,
        amount: data.value === null ? null : prisma8Numeric(data.value, 20, 10),
      })
      return
    }
    if (data.kind === 'possible') {
      await query.updateAndCount({
        ...common,
        possible: data.value === null ? null : prisma8Numeric(data.value, 20, 10),
      })
      return
    }
    if (data.kind === 'expectedEndTime') {
      await query.updateAndCount({ ...common, expectedEndTime: data.value })
      return
    }
    if (data.kind === 'products') {
      await query.updateAndCount({
        ...common,
        products: data.value === null ? null : prisma8Varchar(data.value, 1000),
      })
      return
    }
    if (data.kind === 'customerId') {
      await query.updateAndCount({
        ...common,
        customerId: data.value === null ? null : prisma8Varchar(data.value, 32),
      })
    }
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<OpportunityPageDto>,
    input: { fileName: string; headList: string[]; ids?: string[] },
  ) {
    return this.exportTasks.enqueue(user, {
      module: 'opportunity',
      fileName: input.fileName,
      payload: {
        version: 1,
        query,
        input: { headList: input.headList, ids: input.ids },
      },
    })
  }

  async buildQueuedExport(
    user: AuthUser,
    payload: QueuedExportTaskPayload,
  ): Promise<ExportBuildResult> {
    return this.buildExportXlsx(
      user,
      payload.query as Partial<OpportunityPageDto>,
      payload.input as { headList: string[]; ids?: string[] },
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<OpportunityPageDto>,
    input: { headList: string[]; ids?: string[] },
  ): Promise<ExportBuildResult> {
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
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
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
      if (!Number.isFinite(number))
        throw new BadRequestException(`「${fieldMap.get(key)?.label ?? key}」格式不正确`)
      return number
    }
    const common = {
      ...(name !== undefined ? { name } : {}),
      ...(values['customerId'] !== undefined
        ? { customerId: String(values['customerId'] || '') }
        : {}),
      ...(values['contactId'] !== undefined
        ? { contactId: String(values['contactId'] || '') }
        : {}),
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
    return [
      ...new Set(
        text
          .split(/[,，、;；]/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ]
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

  private normalizeStage(stage: {
    id: string
    name: string
    _type: string
    rate: string
    afootRollBack: boolean
    endRollBack: boolean
    pos: bigint
    organizationId: string
    createTime: bigint
    updateTime: bigint
    createUser: string
    updateUser: string
  }): OpportunityStageConfig {
    return {
      id: String(stage.id),
      name: String(stage.name),
      type: String(stage._type),
      rate: String(stage.rate),
      afootRollBack: stage.afootRollBack,
      endRollBack: stage.endRollBack,
      pos: stage.pos,
      organizationId: String(stage.organizationId),
      createTime: stage.createTime,
      updateTime: stage.updateTime,
      createUser: String(stage.createUser),
      updateUser: String(stage.updateUser),
    }
  }

  private async attachOpportunityRefs(rows: Opportunity[]): Promise<OpportunityWithRefs[]> {
    if (!rows.length) return []
    const customerIds = [
      ...new Set(rows.flatMap((row) => (row.customerId ? [String(row.customerId)] : []))),
    ]
    const contactIds = [
      ...new Set(rows.flatMap((row) => (row.contactId ? [String(row.contactId)] : []))),
    ]
    const stageIds = [...new Set(rows.map((row) => String(row.stage)))]
    const [customers, contacts, rawStages] = await Promise.all([
      customerIds.length
        ? this.prisma8.client.orm.public.Customer.where((row) =>
            row.id.in(prisma8Varchars(customerIds, 32)),
          )
            .select('id', 'name')
            .all()
        : Promise.resolve([]),
      contactIds.length
        ? this.prisma8.client.orm.public.CustomerContact.where((row) =>
            row.id.in(prisma8Varchars(contactIds, 32)),
          )
            .select('id', 'name')
            .all()
        : Promise.resolve([]),
      this.prisma8.client.orm.public.OpportunityStageConfig.where((row) =>
        row.id.in(prisma8Varchars(stageIds, 32)),
      ).all(),
    ])
    const customerMap = new Map(customers.map((item) => [String(item.id), String(item.name)]))
    const contactMap = new Map(contacts.map((item) => [String(item.id), String(item.name)]))
    const stageMap = new Map(
      rawStages.map((item) => {
        const stage = this.normalizeStage(item)
        return [stage.id, stage] as const
      }),
    )
    return rows.flatMap((row) => {
      const stageConfig = stageMap.get(String(row.stage))
      if (!stageConfig) return []
      return [
        {
          ...row,
          customer: row.customerId
            ? { name: customerMap.get(String(row.customerId)) ?? '' }
            : null,
          contact: row.contactId ? { name: contactMap.get(String(row.contactId)) ?? '' } : null,
          stageConfig,
        },
      ]
    })
  }

  private async loadOpportunityWithRefs(row: Opportunity): Promise<OpportunityWithRefs> {
    const rows = await this.attachOpportunityRefs([row])
    const full = rows[0]
    if (!full) throw new NotFoundException('商机阶段不存在')
    return full
  }

  private async applyHomeOpportunityWhere(
    collection: ReturnType<typeof this.prisma8.client.orm.public.Opportunity.where>,
    organizationId: string,
    where: OpportunityHomeWhere,
  ) {
    let query = collection
    for (const clause of where.AND ?? []) {
      const ownerScope = clause.owner
      if (typeof ownerScope === 'string') {
        query = query.where({ owner: prisma8Varchar(ownerScope, 32) })
      } else if (ownerScope?.in) {
        const ownerIds = ownerScope.in
        query = query.where((row) => row.owner.in(prisma8Varchars(ownerIds, 32)))
      }
      if (clause.stageConfig) {
        let stages = this.prisma8.client.orm.public.OpportunityStageConfig.where({
          organizationId: prisma8Varchar(organizationId, 32),
        })
        if (clause.stageConfig.type) {
          stages = stages.where({
            _type: prisma8Varchar(clause.stageConfig.type, 50),
          })
        }
        if (clause.stageConfig.rate) {
          stages = stages.where({
            rate: prisma8Varchar(clause.stageConfig.rate, 10),
          })
        }
        const stageRows = await stages.select('id').all()
        const stageIds = stageRows.map((stage) => String(stage.id))
        query = stageIds.length
          ? query.where((row) => row.stage.in(prisma8Varchars(stageIds, 32)))
          : query.where((row) => row.id.eq(prisma8Varchar('', 32)))
      }
      if (clause.createTime?.gte !== undefined) {
        const value = clause.createTime.gte
        query = query.where((row) => row.createTime.gte(value))
      }
      if (clause.createTime?.lte !== undefined) {
        const value = clause.createTime.lte
        query = query.where((row) => row.createTime.lte(value))
      }
      if (clause.expectedEndTime?.gte !== undefined) {
        const value = clause.expectedEndTime.gte
        query = query.where((row) => row.expectedEndTime.gte(value))
      }
      if (clause.expectedEndTime?.lte !== undefined) {
        const value = clause.expectedEndTime.lte
        query = query.where((row) => row.expectedEndTime.lte(value))
      }
      if (clause.actualEndTime?.gte !== undefined) {
        const value = clause.actualEndTime.gte
        query = query.where((row) => row.actualEndTime.gte(value))
      }
      if (clause.actualEndTime?.lte !== undefined) {
        const value = clause.actualEndTime.lte
        query = query.where((row) => row.actualEndTime.lte(value))
      }
    }
    return query
  }

  private async ownerNames(ownerIds: string[]): Promise<Map<string, string>> {
    const ids = [...new Set(ownerIds.filter(Boolean))]
    if (!ids.length) return new Map()
    const users = await this.prisma8.client.orm.public.Users.where((row) => row.id.in(ids))
      .select('id', 'name')
      .all()
    return new Map(users.map((user) => [user.id, user.name]))
  }

  private async failureReasonNames(organizationId: string) {
    const config = await this.dictionaries.config(organizationId, 'OPPORTUNITY_FAIL_RS')
    return new Map(config.dictList.map((item) => [item.id, item.name]))
  }

  private async toSingleVO(
    user: AuthUser,
    opportunity: OpportunityWithRefs,
  ): Promise<OpportunityVO> {
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
    const customer = await this.prisma8.client.orm.public.Customer.where({
      id: prisma8Varchar(customerId, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .select('id')
      .first()
    if (!customer) throw new BadRequestException('客户不存在')
  }

  private async assertContactBelongsToCustomer(
    organizationId: string,
    contactId: string,
    customerId: string,
  ) {
    const contact = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(contactId, 32),
      organizationId: prisma8Varchar(organizationId, 32),
      customerId: prisma8Varchar(customerId, 32),
    })
      .select('id')
      .first()
    if (!contact) throw new BadRequestException('联系人不存在或不属于当前客户')
  }

  private productIdsFromItems(
    items: CreateOpportunityDto['items'] | UpdateOpportunityDto['items'],
  ) {
    if (!items?.length) return []
    return [
      ...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id))),
    ]
  }

  private parseProductIds(value: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : []
    } catch {
      return []
    }
  }

  private async validateProducts(tenantId: string, productIds: string[]) {
    if (!productIds.length) return
    const aggregate = await this.prisma8.client.orm.public.Product.where({
      organizationId: prisma8Varchar(tenantId, 32),
    })
      .where((row) => row.id.in(prisma8Varchars(productIds, 32)))
      .aggregate((value) => ({ count: value.count() }))
    if (aggregate.count !== productIds.length) {
      throw new BadRequestException('意向产品包含不存在的数据')
    }
  }

  private async nextPosition(organizationId: string, stage: string) {
    const row = await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(organizationId, 32),
      stage: prisma8Varchar(stage, 32),
    })
      .orderBy((item) => item.pos.desc())
      .select('pos')
      .first()
    return (row?.pos ?? 0n) + 1n
  }

  private numberFromDto(dto: object, key: string): number | null | undefined {
    const value = (dto as Record<string, unknown>)[key]
    if (value === undefined) return undefined
    if (value === null || value === '') return null
    const number = Number(value)
    if (!Number.isFinite(number)) throw new BadRequestException(`${key} 格式不正确`)
    return number
  }

  private applyOpportunitySystemFilter(
    collection: ReturnType<typeof this.prisma8.client.orm.public.Opportunity.where>,
    field: FieldVO | undefined,
    condition: FilterCondition,
  ) {
    const impossible = () => collection.where((row) => row.id.eq(prisma8Varchar('', 32)))
    if (!field || field.type === 'formula') return impossible()
    const key = condition.key === 'ownerId' ? 'owner' : condition.key
    const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
    const nullableKeys = new Set([
      'customerId',
      'amount',
      'possible',
      'products',
      'lastStage',
      'contactId',
      'follower',
      'followTime',
      'expectedEndTime',
      'actualEndTime',
      'failureReason',
      'pos',
    ])

    if (condition.op === 'isEmpty') {
      if (!nullableKeys.has(key)) return impossible()
      if (key === 'customerId') return collection.where((row) => row.customerId.isNull())
      if (key === 'amount') return collection.where((row) => row.amount.isNull())
      if (key === 'possible') return collection.where((row) => row.possible.isNull())
      if (key === 'products') return collection.where((row) => row.products.isNull())
      if (key === 'lastStage') return collection.where((row) => row.lastStage.isNull())
      if (key === 'contactId') return collection.where((row) => row.contactId.isNull())
      if (key === 'follower') return collection.where((row) => row.follower.isNull())
      if (key === 'followTime') return collection.where((row) => row.followTime.isNull())
      if (key === 'expectedEndTime') return collection.where((row) => row.expectedEndTime.isNull())
      if (key === 'actualEndTime') return collection.where((row) => row.actualEndTime.isNull())
      if (key === 'failureReason') return collection.where((row) => row.failureReason.isNull())
      return collection.where((row) => row.pos.isNull())
    }
    if (condition.op === 'notEmpty') {
      if (!nullableKeys.has(key)) return collection
      if (key === 'customerId') return collection.where((row) => row.customerId.isNotNull())
      if (key === 'amount') return collection.where((row) => row.amount.isNotNull())
      if (key === 'possible') return collection.where((row) => row.possible.isNotNull())
      if (key === 'products') return collection.where((row) => row.products.isNotNull())
      if (key === 'lastStage') return collection.where((row) => row.lastStage.isNotNull())
      if (key === 'contactId') return collection.where((row) => row.contactId.isNotNull())
      if (key === 'follower') return collection.where((row) => row.follower.isNotNull())
      if (key === 'followTime') return collection.where((row) => row.followTime.isNotNull())
      if (key === 'expectedEndTime') return collection.where((row) => row.expectedEndTime.isNotNull())
      if (key === 'actualEndTime') return collection.where((row) => row.actualEndTime.isNotNull())
      if (key === 'failureReason') return collection.where((row) => row.failureReason.isNotNull())
      return collection.where((row) => row.pos.isNotNull())
    }

    if (key === 'amount' || key === 'possible') {
      const numbers = rawValues.map(Number)
      if (numbers.some((value) => !Number.isFinite(value))) return impossible()
      const values = numbers.map((value) => prisma8Numeric(value, 20, 10))
      const value = values[0]!
      if (key === 'amount') {
        return collection.where((row) => {
          if (condition.op === 'eq') return row.amount.eq(value)
          if (condition.op === 'ne') return row.amount.neq(value)
          if (condition.op === 'in') return row.amount.in(values)
          if (condition.op === 'notIn') return not(row.amount.in(values))
          if (condition.op === 'gt') return row.amount.gt(value)
          if (condition.op === 'gte') return row.amount.gte(value)
          if (condition.op === 'lt') return row.amount.lt(value)
          if (condition.op === 'lte') return row.amount.lte(value)
          return row.id.eq(prisma8Varchar('', 32))
        })
      }
      return collection.where((row) => {
        if (condition.op === 'eq') return row.possible.eq(value)
        if (condition.op === 'ne') return row.possible.neq(value)
        if (condition.op === 'in') return row.possible.in(values)
        if (condition.op === 'notIn') return not(row.possible.in(values))
        if (condition.op === 'gt') return row.possible.gt(value)
        if (condition.op === 'gte') return row.possible.gte(value)
        if (condition.op === 'lt') return row.possible.lt(value)
        if (condition.op === 'lte') return row.possible.lte(value)
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    if (
      key === 'followTime' ||
      key === 'expectedEndTime' ||
      key === 'actualEndTime' ||
      key === 'createTime' ||
      key === 'updateTime' ||
      key === 'pos'
    ) {
      const values: bigint[] = []
      for (const raw of rawValues) {
        const direct = Number(raw)
        const millis =
          (key === 'pos' && Number.isFinite(direct)) ||
          (Number.isFinite(direct) && String(raw ?? '').trim() !== '')
            ? direct
            : new Date(String(raw)).getTime()
        if (!Number.isFinite(millis)) return impossible()
        values.push(BigInt(Math.trunc(millis)))
      }
      const value = values[0]!
      return collection.where((row) => {
        const target =
          key === 'followTime'
            ? row.followTime
            : key === 'expectedEndTime'
              ? row.expectedEndTime
              : key === 'actualEndTime'
                ? row.actualEndTime
                : key === 'createTime'
                  ? row.createTime
                  : key === 'updateTime'
                    ? row.updateTime
                    : row.pos
        if (condition.op === 'eq') return target.eq(value)
        if (condition.op === 'ne') return target.neq(value)
        if (condition.op === 'in') return target.in(values)
        if (condition.op === 'notIn') return not(target.in(values))
        if (condition.op === 'gt') return target.gt(value)
        if (condition.op === 'gte') return target.gte(value)
        if (condition.op === 'lt') return target.lt(value)
        if (condition.op === 'lte') return target.lte(value)
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    if (key === 'name') {
      const values = rawValues.map((item) => prisma8Varchar(String(item ?? ''), 255))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.name.eq(value)
        if (condition.op === 'ne') return row.name.neq(value)
        if (condition.op === 'in') return row.name.in(values)
        if (condition.op === 'notIn') return not(row.name.in(values))
        if (condition.op === 'contains') return row.name.ilike('%' + String(condition.value ?? '') + '%')
        if (condition.op === 'notContains') return not(row.name.ilike('%' + String(condition.value ?? '') + '%'))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    if (key === 'products') {
      const values = rawValues.map((item) => prisma8Varchar(String(item ?? ''), 1000))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.products.eq(value)
        if (condition.op === 'ne') return row.products.neq(value)
        if (condition.op === 'in') return row.products.in(values)
        if (condition.op === 'notIn') return not(row.products.in(values))
        if (condition.op === 'contains') return row.products.ilike('%' + String(condition.value ?? '') + '%')
        if (condition.op === 'notContains') return not(row.products.ilike('%' + String(condition.value ?? '') + '%'))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    if (key === 'failureReason') {
      const values = rawValues.map((item) => prisma8Varchar(String(item ?? ''), 50))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.failureReason.eq(value)
        if (condition.op === 'ne') return row.failureReason.neq(value)
        if (condition.op === 'in') return row.failureReason.in(values)
        if (condition.op === 'notIn') return not(row.failureReason.in(values))
        if (condition.op === 'contains') return row.failureReason.ilike('%' + String(condition.value ?? '') + '%')
        if (condition.op === 'notContains') return not(row.failureReason.ilike('%' + String(condition.value ?? '') + '%'))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    const values = rawValues.map((item) => prisma8Varchar(String(item ?? ''), 32))
    const value = values[0]!
    return collection.where((row) => {
      const target =
        key === 'customerId'
          ? row.customerId
          : key === 'lastStage'
            ? row.lastStage
            : key === 'stage'
              ? row.stage
              : key === 'contactId'
                ? row.contactId
                : key === 'owner'
                  ? row.owner
                  : key === 'follower'
                    ? row.follower
                    : key === 'createUser'
                      ? row.createUser
                      : row.updateUser
      if (condition.op === 'eq') return target.eq(value)
      if (condition.op === 'ne') return target.neq(value)
      if (condition.op === 'in') return target.in(values)
      if (condition.op === 'notIn') return not(target.in(values))
      if (condition.op === 'contains') return target.ilike('%' + String(condition.value ?? '') + '%')
      if (condition.op === 'notContains') return not(target.ilike('%' + String(condition.value ?? '') + '%'))
      return row.id.eq(prisma8Varchar('', 32))
    })
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
        const field = fieldMap.get(normalized.key)
        if (!field) return new Set<string>()
        if (!field.system || isCustomFieldKey(normalized.key)) {
          return new Set(
            await this.fieldValues.filterResourceIds(organizationId, 'opportunity', [normalized]),
          )
        }
        let query = this.prisma8.client.orm.public.Opportunity.where({
          organizationId: prisma8Varchar(organizationId, 32),
        })
        query = this.applyOpportunitySystemFilter(query, field, normalized)
        const rows = await query.select('id').all()
        return new Set(rows.map((row) => String(row.id)))
      }),
    )
    if (!sets.length) return []
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce((result, set) => new Set([...result].filter((id) => set.has(id))), sets[0]!),
    ]
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
