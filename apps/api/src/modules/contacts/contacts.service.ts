import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import {
  type ContactVO,
  type FieldVO,
  type FilterCondition,
  type ImportResultVO,
  type PaginatedResult,
  hasPermission,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { BatchAffectResult, ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import { formatForExport } from '../../common/export-format'
import { parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { CustomerAccessService } from '../../customers/customer-access.service'
import { not, or } from '@prisma/orm-postgres/orm-client'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar.js'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
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
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import {
  ContactAddDto,
  ContactChartDto,
  type ContactModuleFieldValueDto,
  type ContactPageDto,
  type ContactSortDto,
  ContactUpdateDto,
  CreateContactDto,
  QueryContactsDto,
  UpdateContactDto,
} from './dto/contact.dto'

const MODULE = 'contact'

type ContactRow = {
  id: string
  customerId: string | null
  name: string
  phone: string | null
  owner: string
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
  enable: boolean
  disableReason: string | null
  organizationId: string
}

type ContactWithRelations = ContactRow & {
  customer: { name: string; owner: string | null } | null
}

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly customerAccess: CustomerAccessService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly notifications: BusinessNotificationsService,
  ) {}

  getModuleForm(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, MODULE)
  }

  async page(user: AuthUser, dto: ContactPageDto) {
    const result = await this.findAll(
      user,
      {
        page: dto.current,
        pageSize: dto.pageSize,
        keyword: dto.keyword,
        viewId: dto.viewId,
        scopeView: dto.scopeView,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
        filterMode: dto.filterMode,
      },
      dto.sort,
    )
    return {
      list: result.items,
      total: result.total,
      current: result.page,
      pageSize: result.pageSize,
      optionMap: {},
    }
  }

  async addAccountContact(user: AuthUser, dto: ContactAddDto) {
    return this.create(user, {
      customerId: dto.customerId,
      ownerId: dto.owner,
      name: dto.name,
      phone: dto.phone,
      customData: await this.moduleFieldsToCustomData(user, dto.moduleFields),
    })
  }

  async updateAccountContact(user: AuthUser, dto: ContactUpdateDto) {
    return this.update(user, dto.id, {
      customerId: dto.customerId,
      ownerId: dto.owner,
      name: dto.name,
      phone: dto.phone,
      customData:
        dto.moduleFields === undefined
          ? undefined
          : await this.moduleFieldsToCustomData(user, dto.moduleFields),
    })
  }

  /** Cordys 独立联系人页：按联系人 owner/dept 数据范围分页。 */
  async findAll(
    user: AuthUser,
    query: QueryContactsDto,
    sort?: ContactSortDto,
  ): Promise<PaginatedResult<ContactVO>> {
    this.assertIndependentReadPermission(user)
    const { page = 1, pageSize = 10, keyword } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const adHoc = parseFilters(query.filters)
    const saved = query.viewId
      ? await this.userViews.resolveFilters(user, query.viewId, USER_VIEW_RESOURCE_TYPES.contact)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      adHoc.length ? this.filterIds(user.tenantId, adHoc, query.filterMode ?? 'AND') : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    const ownerIds = await this.resolveListOwnerIds(user, query.scopeView)
    let dbQuery = this.prisma8.client.orm.public.CustomerContact.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    if (ownerIds) dbQuery = dbQuery.where((row) => row.owner.in(prisma8Varchars(ownerIds, 32)))
    if (filteredIds) dbQuery = dbQuery.where((row) => row.id.in(prisma8Varchars(filteredIds, 32)))
    if (query.customerId) dbQuery = dbQuery.where({ customerId: prisma8Varchar(query.customerId, 32) })
    if (query.enable !== undefined) dbQuery = dbQuery.where({ enable: query.enable === 'true' })
    if (keyword) {
      dbQuery = dbQuery.where((row) =>
        or(row.name.ilike(`%${keyword}%`), row.phone.ilike(`%${keyword}%`)),
      )
    }
    const ordered = this.applyContactSort(dbQuery, sort, fields)
    const [baseRows, aggregate] = await Promise.all([
      ordered.offset((page - 1) * pageSize).limit(pageSize).all(),
      dbQuery.aggregate((value) => ({ count: value.count() })),
    ])
    const items = await this.attachCustomers(baseRows)
    const [values, ownerNames] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customerContact',
        items.map((item) => item.id),
      ),
      this.userNames(items.map((item) => item.owner)),
    ])
    return {
      items: items.map((item) =>
        this.toVO(item, fields, values.get(item.id) ?? {}, ownerNames.get(item.owner) ?? null),
      ),
      total: aggregate.count,
      page,
      pageSize,
    }
  }

  tab(user: AuthUser) {
    const roles = user.roles.filter((role) => hasPermission(role.permissions, 'contact:read'))
    return {
      all: roles.some((role) => role.dataScope === 'ALL' || role.dataScope === 'CUSTOM'),
      dept: roles.some((role) => ['ALL', 'DEPT_AND_CHILD', 'CUSTOM'].includes(role.dataScope)),
    }
  }

  async chart(user: AuthUser, dto: ContactChartDto) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const resolveField = (fieldId?: string) =>
      fieldId ? fields.find((field) => field.id === fieldId || field.key === fieldId) : undefined
    const categoryField = resolveField(dto.chartConfig.categoryAxis.fieldId)
    if (!categoryField) throw new BadRequestException('图表类别字段不存在')
    const subCategoryField = resolveField(dto.chartConfig.subCategoryAxis?.fieldId)
    if (dto.chartConfig.subCategoryAxis && !subCategoryField) {
      throw new BadRequestException('图表子类别字段不存在')
    }
    const method = dto.chartConfig.valueAxis.aggregateMethod ?? 'COUNT'
    const valueField = resolveField(dto.chartConfig.valueAxis.fieldId)
    if (method !== 'COUNT' && !valueField) throw new BadRequestException('图表值字段不存在')

    const items: ContactVO[] = []
    let page = 1
    while (true) {
      const result = await this.findAll(user, {
        page,
        pageSize: 100,
        viewId: dto.viewId,
        scopeView: dto.scopeView,
        filters: dto.filters?.length ? JSON.stringify(dto.filters) : undefined,
      })
      items.push(...result.items)
      if (items.length >= result.total || result.items.length === 0) break
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
      valueAxis: this.aggregateChartValues(method, bucket.count, bucket.values),
    }))
  }

  /** 客户详情内嵌联系人：继续沿用 W1.2 协作语义。 */
  async listByCustomer(user: AuthUser, customerId: string): Promise<ContactVO[]> {
    if (!customerId) throw new BadRequestException('缺少 customerId')
    const access = await this.customerAccess.assertRead(user, customerId)
    let query = this.prisma8.client.orm.public.CustomerContact.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      customerId: prisma8Varchar(customerId, 32),
    })
    if (!access.dataScope && access.collaborationType === 'COLLABORATION') {
      query = query.where({ owner: prisma8Varchar(user.id, 32) })
    }
    const rows = await query.orderBy((row) => row.createTime.asc()).all()
    const items = await this.attachCustomers(rows)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const [values, ownerNames] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customerContact',
        items.map((item) => item.id),
      ),
      this.userNames(items.map((item) => item.owner)),
    ])
    return items.map((item) =>
      this.toVO(item, fields, values.get(item.id) ?? {}, ownerNames.get(item.owner) ?? null),
    )
  }

  async findOne(user: AuthUser, id: string): Promise<ContactVO> {
    const contact = await this.ensureReadable(user, id)
    return this.toSingleVO(user, contact)
  }

  async create(user: AuthUser, dto: CreateContactDto): Promise<ContactVO> {
    const permission = this.pickPermission(user, 'contact:create', 'customer:create')
    const access = dto.customerId
      ? await this.customerAccess.assertCollaborateWrite(user, dto.customerId, permission)
      : null
    if (access && !access.dataScope && dto.ownerId && dto.ownerId !== user.id) {
      throw new ForbiddenException('协作用户只能将联系人负责人设为自己')
    }
    const owner = await this.resolveOwner(user, dto.ownerId)
    const { ownerId: _ownerId, customData, ...data } = dto
    await this.fieldValues.validate(user.tenantId, 'customerContact', customData ?? {}, {
      mode: 'create',
    })
    await this.assertContactUniqueRules(user.tenantId, data)
    const now = BigInt(Date.now())
    const contactId = await this.prisma8.client.transaction(async (tx) => {
      const created = await tx.orm.public.CustomerContact.create({
        id: prisma8Id32(),
        customerId: data.customerId ? prisma8Varchar(data.customerId, 32) : null,
        name: prisma8Varchar(data.name, 255),
        phone: data.phone ? prisma8Varchar(data.phone, 30) : null,
        owner: prisma8Varchar(owner.id, 32),
        enable: true,
        disableReason: null,
        organizationId: prisma8Varchar(user.tenantId, 32),
        createTime: now,
        updateTime: now,
        createUser: prisma8Varchar(user.id, 32),
        updateUser: prisma8Varchar(user.id, 32),
      })
      await this.fieldValues.save(
        user.tenantId,
        'customerContact',
        created.id,
        customData ?? {},
        'create',
        tx,
        user.id,
      )
      return String(created.id)
    })
    const contact = await this.loadContactWithRelations(user.tenantId, contactId)
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_CONCAT_ADD',
      operatorId: user.id,
      recipientIds: [contact.customer?.owner],
      excludeSelf: true,
      type: 'system',
      templateContext: {
        operator: user.name,
        cName: contact.name,
        name: contact.customer?.name ?? '',
      },
      link: '/contacts',
    })
    return this.toSingleVO(user, contact)
  }

  async update(user: AuthUser, id: string, dto: UpdateContactDto): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    const permission = this.pickPermission(user, 'contact:update', 'customer:update')
    await this.assertWrite(user, existing, permission)
    if (dto.customerId && dto.customerId !== existing.customerId) {
      await this.customerAccess.assertCollaborateWrite(user, dto.customerId, permission)
    }
    const { customerId, ownerId, customData, ...rest } = dto
    await this.fieldValues.validate(user.tenantId, 'customerContact', customData ?? {}, {
      mode: 'update',
      resourceId: id,
    })
    await this.assertContactUniqueRules(user.tenantId, rest, existing.id)
    const owner = ownerId ? await this.resolveOwner(user, ownerId) : null
    await this.prisma8.client.transaction(async (tx) => {
      const updated = await tx.orm.public.CustomerContact.where({
        id: prisma8Varchar(id, 32),
      }).update({
        ...(rest.name !== undefined ? { name: prisma8Varchar(rest.name, 255) } : {}),
        ...(rest.phone !== undefined
          ? { phone: rest.phone ? prisma8Varchar(rest.phone, 30) : null }
          : {}),
        ...(customerId ? { customerId: prisma8Varchar(customerId, 32) } : {}),
        ...(owner ? { owner: prisma8Varchar(owner.id, 32) } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(user.id, 32),
      })
      if (!updated) throw new NotFoundException('联系人不存在')
      if (customData) {
        await this.fieldValues.save(
          user.tenantId,
          'customerContact',
          id,
          customData,
          'update',
          tx,
          user.id,
        )
      }
    })
    const contact = await this.loadContactWithRelations(user.tenantId, id)
    return this.toSingleVO(user, contact)
  }

  async enable(user: AuthUser, id: string): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    await this.assertWrite(
      user,
      existing,
      this.pickPermission(user, 'contact:update', 'customer:update'),
    )
    const updated = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      enable: true,
      disableReason: null,
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
    if (!updated) throw new NotFoundException('联系人不存在')
    return this.toSingleVO(user, await this.loadContactWithRelations(user.tenantId, id))
  }

  async disable(user: AuthUser, id: string, reason: string): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    await this.assertWrite(
      user,
      existing,
      this.pickPermission(user, 'contact:update', 'customer:update'),
    )
    const normalized = reason.trim()
    if (!normalized) throw new BadRequestException('请填写停用原因')
    const updated = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).update({
      enable: false,
      disableReason: prisma8Varchar(normalized, 255),
      updateTime: BigInt(Date.now()),
      updateUser: prisma8Varchar(user.id, 32),
    })
    if (!updated) throw new NotFoundException('联系人不存在')
    return this.toSingleVO(user, await this.loadContactWithRelations(user.tenantId, id))
  }

  async checkOpportunity(user: AuthUser, id: string): Promise<{ linked: boolean; count: number }> {
    await this.ensureReadable(user, id)
    const aggregate = await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      contactId: prisma8Varchar(id, 32),
    }).aggregate((value) => ({ count: value.count() }))
    return { linked: aggregate.count > 0, count: aggregate.count }
  }

  async remove(user: AuthUser, id: string) {
    const contact = await this.ensureExists(user, id)
    await this.assertWrite(
      user,
      contact,
      this.pickPermission(user, 'contact:delete', 'customer:delete'),
    )
    const linked = await this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      contactId: prisma8Varchar(id, 32),
    }).aggregate((value) => ({ count: value.count() }))
    if (linked.count > 0) throw new BadRequestException('联系人已关联商机，请先在商机中解除联系人关联')
    await this.prisma8.client.transaction(async (tx) => {
      await Promise.all([
        tx.orm.public.CustomerContactField.where({ resourceId: prisma8Varchar(id, 32) }).deleteAll(),
        tx.orm.public.CustomerContactFieldBlob.where({ resourceId: prisma8Varchar(id, 32) }).deleteAll(),
        tx.orm.public.Attachments.where({
          tenantId: user.tenantId,
          targetType: 'contact',
          targetId: id,
        }).deleteAll(),
      ])
      await tx.orm.public.CustomerContact.where({ id: prisma8Varchar(id, 32) }).deleteAndCount()
    })
    return { id, name: contact.name }
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    const uniqueIds = [...new Set(dto.ids)]
    const contacts = uniqueIds.length
      ? await this.prisma8.client.orm.public.CustomerContact.where({
          organizationId: prisma8Varchar(user.tenantId, 32),
        })
          .where((row) => row.id.in(prisma8Varchars(uniqueIds, 32)))
          .all()
      : []
    if (contacts.length !== uniqueIds.length) {
      throw new ForbiddenException('选中联系人包含不存在或不在你数据范围内的数据')
    }
    for (const contact of contacts) {
      if (!(await this.dataScope.matchesDirectOwner(user, contact.owner, 'contact:read'))) {
        throw new ForbiddenException('选中联系人包含不存在或不在你数据范围内的数据')
      }
    }
    const base = this.prisma8.client.orm.public.CustomerContact.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).where((row) => row.id.in(prisma8Varchars(uniqueIds, 32)))
    const audit = { updateTime: BigInt(Date.now()), updateUser: prisma8Varchar(user.id, 32) }

    if (field.key === 'owner' || field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string') throw new BadRequestException('负责人值无效')
      const owner = await this.resolveOwner(user, dto.fieldValue)
      await base.updateAndCount({ owner: prisma8Varchar(owner.id, 32), ...audit })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }
    if (field.key === 'customerId') {
      if (typeof dto.fieldValue !== 'string') throw new BadRequestException('客户值无效')
      await this.customerAccess.assertCollaborateWrite(user, dto.fieldValue, 'contact:update')
      await base.updateAndCount({ customerId: prisma8Varchar(dto.fieldValue, 32), ...audit })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }
    if (field.key === 'enable') {
      const enable = Boolean(dto.fieldValue)
      await base.updateAndCount({
        enable,
        ...(enable ? { disableReason: null } : {}),
        ...audit,
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    if (!field.system) {
      await this.prisma8.client.transaction((tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'customerContact',
          contacts.map((contact) => contact.id),
          field.id,
          dto.fieldValue,
          tx,
        ),
      )
    } else if (field.key === 'name') {
      await base.updateAndCount({
        name: prisma8Varchar(String(dto.fieldValue ?? ''), 255),
        ...audit,
      })
    } else if (field.key === 'phone') {
      await base.updateAndCount({
        phone:
          dto.fieldValue === null || dto.fieldValue === undefined || dto.fieldValue === ''
            ? null
            : prisma8Varchar(String(dto.fieldValue), 30),
        ...audit,
      })
    } else {
      throw new BadRequestException('该系统字段不支持批量修改')
    }
    return { success: dto.ids.length, fail: 0, failedIds: [] }
  }

  async importTemplate(user: AuthUser) {
    this.assertIndependentImportPermission(user)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    // Cordys 联系人模板下载与导入类型无关；模板同时保留“唯一ID”列，ADD 会忽略该列，UPDATE 使用该列定位。
    const data = await this.spreadsheet.buildImportTemplate(fields, 'UPDATE', {
      excludeKeys: ['enable'],
    })
    return {
      filename: '联系人导入模板.xlsx',
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    this.assertIndependentImportPermission(user)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: ['enable'],
    })
    const errors: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const rowErrors = [...row.errors]
      if (rowErrors.length === 0) {
        try {
          await this.prepareImportRow(user, row.values, fields, importType, row.resourceId)
        } catch (error) {
          rowErrors.push(error instanceof Error ? error.message : '联系人校验失败')
        }
      }
      if (rowErrors.length) errors.push({ rowNum: row.rowNum, errMsg: rowErrors.join('；') })
      else successCount++
    }
    return { successCount, failCount: errors.length, errorMessages: errors }
  }

  async importXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    this.assertIndependentImportPermission(user)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: ['enable'],
    })
    const errors: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const rowErrors = [...row.errors]
      if (rowErrors.length === 0) {
        try {
          const prepared = await this.prepareImportRow(
            user,
            row.values,
            fields,
            importType,
            row.resourceId,
          )
          if (importType === 'ADD') {
            await this.create(user, prepared as CreateContactDto)
          } else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, row.resourceId, prepared)
            await this.prisma8.client.orm.public.CustomerContact.where({
              id: prisma8Varchar(row.resourceId, 32),
              organizationId: prisma8Varchar(user.tenantId, 32),
            }).update({
              enable: true,
              disableReason: null,
              updateTime: BigInt(Date.now()),
              updateUser: prisma8Varchar(user.id, 32),
            })
          }
          successCount++
        } catch (error) {
          rowErrors.push(error instanceof Error ? error.message : '联系人导入失败')
        }
      }
      if (rowErrors.length) errors.push({ rowNum: row.rowNum, errMsg: rowErrors.join('；') })
    }
    return { successCount, failCount: errors.length, errorMessages: errors }
  }

  async exportXlsx(
    user: AuthUser,
    query: QueryContactsDto,
    input: { fileName: string; headList: string[]; ids?: string[] },
  ) {
    return this.exportTasks.enqueue(user, {
      module: MODULE,
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
      payload.query as QueryContactsDto,
      payload.input as { headList: string[]; ids?: string[] },
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: QueryContactsDto,
    input: { headList: string[]; ids?: string[] },
  ): Promise<ExportBuildResult> {
    if (!hasPermission(user.permissions, 'contact:export'))
      throw new ForbiddenException('无联系人导出权限')
    const items = await this.collectExportItems(user, query, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extra = new Map([
      ['disableReason', '停用原因'],
      ['createdAt', '创建时间'],
      ['updatedAt', '更新时间'],
    ])
    const columns = input.headList.map((key) => {
      const field = fieldMap.get(key) ?? (key === 'ownerId' ? fieldMap.get('owner') : undefined)
      const extraLabel = extra.get(key)
      if (!field && !extraLabel) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extraLabel as string) }
    })
    const rows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          if (column.key === 'customerId') return [column.key, item.customerName ?? '']
          if (column.key === 'ownerId') return [column.key, item.ownerName ?? '']
          if (column.key === 'enable') return [column.key, item.enable ? '启用' : '停用']
          const field = fieldMap.get(column.key)
          return [column.key, field ? formatForExport(field, source) : (source[column.key] ?? '')]
        }),
      )
    })
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ): Promise<UpdateContactDto> {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const dto: UpdateContactDto = {}
    const customData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
      const field = fieldMap.get(key)
      if (!field || field.hidden || field.type === 'formula' || key === 'enable') continue
      this.metadata.validateBatchFieldValue(field, value)
      if (key === 'customerId') {
        dto.customerId = await this.resolveImportCustomer(user, String(value))
      } else if (key === 'owner' || key === 'ownerId') {
        dto.ownerId = (await this.resolveOwner(user, String(value))).id
      } else if (key.startsWith('cf_')) {
        customData[key] = value
      } else {
        ;(dto as Record<string, unknown>)[key] = value
      }
    }
    if (Object.keys(customData).length > 0) dto.customData = customData
    await this.fieldValues.validate(user.tenantId, 'customerContact', customData, {
      mode: importType === 'ADD' ? 'create' : 'update',
      resourceId: importType === 'UPDATE' ? resourceId : undefined,
    })
    if (importType === 'ADD') {
      if (!dto.name?.trim()) throw new BadRequestException('联系人姓名不能为空')
      if (dto.customerId) {
        await this.customerAccess.assertCollaborateWrite(user, dto.customerId, 'contact:import')
      }
    } else {
      if (!resourceId) throw new BadRequestException('唯一ID不能为空')
      const existing = await this.ensureIndependentInScope(user, resourceId)
      if (!existing) throw new BadRequestException('联系人不存在或不在你的数据范围内')
      if (dto.customerId && dto.customerId !== existing.customerId) {
        await this.customerAccess.assertCollaborateWrite(user, dto.customerId, 'contact:import')
      }
    }
    return dto
  }

  private async collectExportItems(user: AuthUser, query: QueryContactsDto, ids?: string[]) {
    const all: ContactVO[] = []
    let page = 1
    const pageSize = 500
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
      throw new ForbiddenException('选中数据包含不存在或无权导出的联系人')
    return selected
  }

  private async attachCustomers<T extends ContactRow>(rows: T[]): Promise<Array<T & { customer: { name: string; owner: string | null } | null }>> {
    const customerIds = [...new Set(rows.flatMap((row) => (row.customerId ? [String(row.customerId)] : [])))]
    const customers = customerIds.length
      ? await this.prisma8.client.orm.public.Customer.where((row) =>
          row.id.in(prisma8Varchars(customerIds, 32)),
        )
          .select('id', 'name', 'owner')
          .all()
      : []
    const customerMap = new Map(customers.map((item) => [String(item.id), item]))
    return rows.map((row) => ({
      ...row,
      customer: row.customerId
        ? (() => {
            const customer = customerMap.get(String(row.customerId))
            return customer ? { name: customer.name, owner: customer.owner ? String(customer.owner) : null } : null
          })()
        : null,
    }))
  }

  private async loadContactWithRelations(organizationId: string, id: string): Promise<ContactWithRelations> {
    const row = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    }).first()
    if (!row) throw new NotFoundException('联系人不存在')
    const [contact] = await this.attachCustomers([row])
    return contact!
  }

  private async ensureReadable(user: AuthUser, id: string): Promise<ContactWithRelations> {
    const contact = await this.loadContactWithRelations(user.tenantId, id)
    if (
      hasPermission(user.permissions, 'contact:read') &&
      (await this.dataScope.matchesDirectOwner(user, contact.owner, 'contact:read'))
    ) {
      return contact
    }
    if (!contact.customerId) throw new NotFoundException('联系人尚未关联客户')
    const access = await this.customerAccess.assertRead(user, contact.customerId)
    if (access.dataScope || access.pool) return contact
    if (access.collaborationType === 'COLLABORATION' && contact.owner === user.id) return contact
    throw new NotFoundException('联系人不存在或无权访问')
  }

  private async assertWrite(user: AuthUser, contact: ContactRow, permission: string) {
    if (await this.dataScope.matchesDirectOwner(user, contact.owner, permission)) return
    if (!contact.customerId) throw new ForbiddenException('联系人尚未关联客户')
    const access = await this.customerAccess.assertRead(user, contact.customerId)
    if (access.dataScope) return
    if (access.collaborationType === 'COLLABORATION' && contact.owner === user.id) return
    throw new ForbiddenException('无权维护该联系人')
  }

  private async ensureIndependentInScope(user: AuthUser, id: string) {
    const row = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!row) return null
    return (await this.dataScope.matchesDirectOwner(user, row.owner, 'contact:import')) ? row : null
  }

  private async resolveListOwnerIds(user: AuthUser, builtInView?: string): Promise<string[] | null> {
    if (!builtInView) {
      const scope = await this.dataScope.directOwnerFilter(user, 'contact:read')
      const owner = scope.owner
      if (!owner) return null
      return typeof owner === 'string' ? [owner] : [...owner.in]
    }
    if (builtInView === 'SELF') return [user.id]
    if (builtInView === 'ALL') {
      const effective = await this.dataScope.resolveScope(user, 'contact:read')
      if (!effective.all) throw new ForbiddenException('当前角色没有全部联系人数据权限')
      return null
    }
    if (builtInView === 'DEPT') {
      const effective = await this.dataScope.resolveScope(user, 'contact:read')
      if (!effective.all && effective.deptIds.length === 0) {
        throw new ForbiddenException('当前角色没有部门联系人数据权限')
      }
      if (effective.all) return null
      if (effective.deptIds.length === 0) return [user.id]
      const owners = await this.prisma8.client.orm.public.Users.where({
        tenantId: user.tenantId,
        status: 'ACTIVE',
      })
        .where((row) => row.deptId.in(effective.deptIds))
        .select('id')
        .all()
      return [...new Set([user.id, ...owners.map((item) => item.id)])]
    }
    const scope = await this.dataScope.directOwnerFilter(user, 'contact:read')
    const owner = scope.owner
    if (!owner) return null
    return typeof owner === 'string' ? [owner] : [...owner.in]
  }

  private pickPermission(user: AuthUser, preferred: string, fallback: string) {
    return hasPermission(user.permissions, preferred) ? preferred : fallback
  }

  private async ensureExists(user: AuthUser, id: string): Promise<ContactRow> {
    const contact = await this.prisma8.client.orm.public.CustomerContact.where({
      id: prisma8Varchar(id, 32),
      organizationId: prisma8Varchar(user.tenantId, 32),
    }).first()
    if (!contact) throw new NotFoundException('联系人不存在')
    return contact
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const direct = await this.prisma8.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .where((row) => or(row.id.eq(ownerId), row.email.ilike(ownerId)))
      .select('id', 'deptId')
      .first()
    if (direct) return direct
    const byName = await this.prisma8.client.orm.public.Users.where({
      tenantId: user.tenantId,
      status: 'ACTIVE',
      name: ownerId,
    })
      .select('id', 'deptId')
      .limit(2)
      .all()
    if (byName.length === 0) throw new BadRequestException('联系人负责人不存在或已禁用')
    if (byName.length > 1) throw new BadRequestException('负责人名称不唯一，请填写邮箱')
    return byName[0]!
  }

  private async resolveImportCustomer(user: AuthUser, value: string) {
    const input = value.trim()
    if (!input) throw new BadRequestException('客户不能为空')
    const direct = await this.prisma8.client.orm.public.Customer.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      id: prisma8Varchar(input, 32),
    })
      .select('id')
      .first()
    if (direct) return direct.id
    const matches = await this.prisma8.client.orm.public.Customer.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
      name: prisma8Varchar(input, 255),
    })
      .select('id')
      .limit(2)
      .all()
    if (matches.length === 0) throw new BadRequestException(`客户「${input}」不存在`)
    if (matches.length > 1)
      throw new BadRequestException(`客户名称「${input}」不唯一，请填写客户 ID`)
    return matches[0]!.id
  }

  private assertIndependentReadPermission(user: AuthUser) {
    if (!hasPermission(user.permissions, 'contact:read'))
      throw new ForbiddenException('无联系人查看权限')
  }

  private async assertContactUniqueRules(
    tenantId: string,
    values: { name?: string; phone?: string | null },
    excludeId?: string,
  ) {
    const fields = await this.metadata.fieldsMap(tenantId, MODULE)
    const checks = [
      ['name', values.name],
      ['phone', values.phone],
    ] as const
    for (const [key, raw] of checks) {
      if (!fields.get(key)?.config?.unique || raw === undefined || raw === null || raw === '')
        continue
      const value = raw.trim()
      if (!value) continue
      let query = this.prisma8.client.orm.public.CustomerContact.where({
        organizationId: prisma8Varchar(tenantId, 32),
      })
      if (excludeId) query = query.where((row) => row.id.neq(prisma8Varchar(excludeId, 32)))
      query = key === 'name'
        ? query.where({ name: prisma8Varchar(value, 255) })
        : query.where({ phone: prisma8Varchar(value, 30) })
      const duplicate = await query.select('id').first()
      if (duplicate) throw new BadRequestException(`「${fields.get(key)?.label ?? key}」不能重复`)
    }
  }

  private assertIndependentImportPermission(user: AuthUser) {
    if (!hasPermission(user.permissions, 'contact:import'))
      throw new ForbiddenException('无联系人导入权限')
  }

  private async moduleFieldsToCustomData(
    user: AuthUser,
    moduleFields?: ContactModuleFieldValueDto[],
  ): Promise<Record<string, unknown>> {
    if (!moduleFields?.length) return {}
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const byIdentity = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const result: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = byIdentity.get(item.fieldId)
      if (!field) throw new BadRequestException(`动态字段「${item.fieldId}」不存在`)
      if (field.system || !field.key.startsWith('cf_')) {
        throw new BadRequestException(`字段「${field.label}」不是可写动态字段`)
      }
      result[field.key] = item.fieldValue
    }
    return result
  }

  private applyContactSort(
    query: ReturnType<typeof this.prisma8.client.orm.public.CustomerContact.where>,
    sort: ContactSortDto | undefined,
    fields: FieldVO[],
  ) {
    if (!sort) {
      return query.orderBy([(row) => row.createTime.desc(), (row) => row.id.asc()])
    }
    const field = fields.find((item) => item.id === sort.fieldId || item.key === sort.fieldId)
    if (!field || field.key.startsWith('cf_')) {
      return query.orderBy([(row) => row.createTime.desc(), (row) => row.id.asc()])
    }
    const asc = sort.direction.toLowerCase() === 'asc'
    if (field.key === 'name')
      return query.orderBy([(row) => (asc ? row.name.asc() : row.name.desc()), (row) => row.id.asc()])
    if (field.key === 'phone')
      return query.orderBy([(row) => (asc ? row.phone.asc() : row.phone.desc()), (row) => row.id.asc()])
    if (field.key === 'owner' || field.key === 'ownerId')
      return query.orderBy([(row) => (asc ? row.owner.asc() : row.owner.desc()), (row) => row.id.asc()])
    if (field.key === 'customerId')
      return query.orderBy([(row) => (asc ? row.customerId.asc() : row.customerId.desc()), (row) => row.id.asc()])
    if (field.key === 'enable')
      return query.orderBy([(row) => row.createTime.desc(), (row) => row.id.asc()])
    if (field.key === 'updateTime')
      return query.orderBy([(row) => (asc ? row.updateTime.asc() : row.updateTime.desc()), (row) => row.id.asc()])
    if (field.key === 'createTime')
      return query.orderBy([(row) => (asc ? row.createTime.asc() : row.createTime.desc()), (row) => row.id.asc()])
    return query.orderBy([(row) => row.createTime.desc(), (row) => row.id.asc()])
  }

  private chartFieldValue(item: ContactVO, key: string): unknown {
    const systemValues: Record<string, unknown> = {
      customerId: item.customerId,
      name: item.name,
      phone: item.phone,
      owner: item.ownerId,
      ownerId: item.ownerId,
      enable: item.enable,
      createTime: item.createdAt,
      updateTime: item.updatedAt,
    }
    return key.startsWith('cf_') ? item.customData[key] : systemValues[key]
  }

  private chartFieldLabel(field: FieldVO, value: unknown) {
    if (value == null || value === '') return '空'
    return field.options?.find((item) => item.value === value)?.label ?? String(value)
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

  private async filterIds(
    organizationId: string,
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ): Promise<string[]> {
    const fields = await this.metadata.listFields(organizationId, MODULE)
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.key, field],
        ...(field.key === 'owner' ? ([['ownerId', field]] as [string, FieldVO][]) : []),
      ]),
    )
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key.startsWith('cf_')) {
          return new Set(
            await this.fieldValues.filterResourceIds(organizationId, 'customerContact', [condition]),
          )
        }
        const normalized = condition.key === 'ownerId' ? { ...condition, key: 'owner' } : condition
        const field = fieldMap.get(normalized.key)
        let query = this.prisma8.client.orm.public.CustomerContact.where({
          organizationId: prisma8Varchar(organizationId, 32),
        })
        if (field && field.type !== 'formula') query = this.applyContactDirectFilter(query, normalized, field)
        const rows = await query.select('id').all()
        return new Set(rows.map((row) => String(row.id)))
      }),
    )
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce(
          (result, set) => new Set([...result].filter((id) => set.has(id))),
          sets[0] ?? new Set<string>(),
        ),
    ]
  }

  private applyContactDirectFilter(
    collection: ReturnType<typeof this.prisma8.client.orm.public.CustomerContact.where>,
    condition: FilterCondition,
    _field: FieldVO,
  ) {
    const key = condition.key
    const impossible = () => collection.where((row) => row.id.eq(prisma8Varchar('', 32)))
    const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]

    if (key === 'enable') {
      const values = rawValues.map((value) => value === true || value === 'true')
      const value = values[0]!
      if (condition.op === 'isEmpty') return impossible()
      if (condition.op === 'notEmpty') return collection
      return collection.where((row) => {
        if (condition.op === 'eq') return row.enable.eq(value)
        if (condition.op === 'ne') return row.enable.neq(value)
        if (condition.op === 'in') return row.enable.in(values)
        if (condition.op === 'notIn') return not(row.enable.in(values))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    if (key === 'createTime' || key === 'updateTime') {
      if (condition.op === 'isEmpty') return impossible()
      if (condition.op === 'notEmpty') return collection
      const values: bigint[] = []
      for (const raw of rawValues) {
        const direct = Number(raw)
        const millis = Number.isFinite(direct) && String(raw ?? '').trim() !== ''
          ? direct
          : new Date(String(raw)).getTime()
        if (!Number.isFinite(millis)) return impossible()
        values.push(BigInt(Math.trunc(millis)))
      }
      const value = values[0]!
      return collection.where((row) => {
        const column = key === 'createTime' ? row.createTime : row.updateTime
        if (condition.op === 'eq') return column.eq(value)
        if (condition.op === 'ne') return column.neq(value)
        if (condition.op === 'in') return column.in(values)
        if (condition.op === 'notIn') return not(column.in(values))
        if (condition.op === 'gt') return column.gt(value)
        if (condition.op === 'gte') return column.gte(value)
        if (condition.op === 'lt') return column.lt(value)
        if (condition.op === 'lte') return column.lte(value)
        return row.id.eq(prisma8Varchar('', 32))
      })
    }

    if (key === 'name') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.name.eq(prisma8Varchar('', 255)))
      if (condition.op === 'notEmpty') return collection.where((row) => row.name.neq(prisma8Varchar('', 255)))
      const values = rawValues.map((value) => prisma8Varchar(String(value ?? ''), 255))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.name.eq(value)
        if (condition.op === 'ne') return row.name.neq(value)
        if (condition.op === 'in') return row.name.in(values)
        if (condition.op === 'notIn') return not(row.name.in(values))
        if (condition.op === 'contains') return row.name.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains') return not(row.name.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }
    if (key === 'phone') {
      if (condition.op === 'isEmpty')
        return collection.where((row) => or(row.phone.isNull(), row.phone.eq(prisma8Varchar('', 30))))
      if (condition.op === 'notEmpty')
        return collection.where((row) => not(or(row.phone.isNull(), row.phone.eq(prisma8Varchar('', 30)))))
      const values = rawValues.map((value) => prisma8Varchar(String(value ?? ''), 30))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.phone.eq(value)
        if (condition.op === 'ne') return row.phone.neq(value)
        if (condition.op === 'in') return row.phone.in(values)
        if (condition.op === 'notIn') return not(row.phone.in(values))
        if (condition.op === 'contains') return row.phone.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains') return not(row.phone.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }
    if (key === 'customerId') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.customerId.isNull())
      if (condition.op === 'notEmpty') return collection.where((row) => row.customerId.isNotNull())
      const values = rawValues.map((value) => prisma8Varchar(String(value ?? ''), 32))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.customerId.eq(value)
        if (condition.op === 'ne') return row.customerId.neq(value)
        if (condition.op === 'in') return row.customerId.in(values)
        if (condition.op === 'notIn') return not(row.customerId.in(values))
        if (condition.op === 'contains') return row.customerId.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains') return not(row.customerId.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }
    if (key === 'owner') {
      if (condition.op === 'isEmpty') return impossible()
      if (condition.op === 'notEmpty') return collection
      const values = rawValues.map((value) => prisma8Varchar(String(value ?? ''), 32))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.owner.eq(value)
        if (condition.op === 'ne') return row.owner.neq(value)
        if (condition.op === 'in') return row.owner.in(values)
        if (condition.op === 'notIn') return not(row.owner.in(values))
        if (condition.op === 'contains') return row.owner.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains') return not(row.owner.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq(prisma8Varchar('', 32))
      })
    }
    return collection
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async userNames(ids: Array<string | null>): Promise<Map<string | null, string>> {
    const userIds = [...new Set(ids.filter((id): id is string => Boolean(id)))]
    const users = userIds.length
      ? await this.prisma8.client.orm.public.Users.where((row) => row.id.in(userIds))
          .select('id', 'name')
          .all()
      : []
    return new Map(users.map((user) => [user.id, user.name]))
  }

  private async toSingleVO(user: AuthUser, contact: ContactWithRelations): Promise<ContactVO> {
    const [fields, values, names] = await Promise.all([
      this.metadata.listFields(user.tenantId, MODULE),
      this.fieldValues.load(user.tenantId, 'customerContact', [contact.id]),
      this.userNames([contact.owner]),
    ])
    return this.toVO(
      contact,
      fields,
      values.get(contact.id) ?? {},
      names.get(contact.owner) ?? null,
    )
  }

  private toVO(
    contact: ContactWithRelations,
    fields: FieldVO[],
    customData: Record<string, unknown>,
    ownerName: string | null,
  ): ContactVO {
    const record: Record<string, unknown> = {
      customerId: contact.customerId,
      ownerId: contact.owner,
      name: contact.name,
      phone: contact.phone,
      enable: contact.enable,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: contact.id,
      customerId: contact.customerId ?? '',
      customerName: contact.customer?.name ?? null,
      ownerId: contact.owner,
      ownerName,
      deptId: null,
      name: contact.name,
      phone: contact.phone,
      enable: contact.enable,
      disableReason: contact.disableReason,
      customData: { ...customData, ...formulas },
      createdAt: new Date(Number(contact.createTime)).toISOString(),
      updatedAt: new Date(Number(contact.updateTime)).toISOString(),
    }
  }
}
