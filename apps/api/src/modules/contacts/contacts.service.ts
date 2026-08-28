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
import { buildFilterClauses, parseFilters } from '../../common/filter-builder'
import { DataScopeService } from '../../common/services/data-scope.service'
import { CustomerAccessService } from '../../customers/customer-access.service'
import { Prisma, type CustomerContact } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
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
const contactInclude = {
  customer: { select: { name: true, owner: true } },
} as const

type ContactWithRelations = Prisma.CustomerContactGetPayload<{ include: typeof contactInclude }>

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
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
    const builtInView = query.scopeView
    const saved = query.viewId
      ? await this.userViews.resolveFilters(user, query.viewId, USER_VIEW_RESOURCE_TYPES.contact)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, saved.conditions, saved.searchMode)
        : null,
      adHoc.length ? this.filterIds(user.tenantId, adHoc, 'AND') : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    const scope = await this.resolveListScope(user, builtInView)
    const where: Prisma.CustomerContactWhereInput = {
      organizationId: user.tenantId,
      AND: [scope],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.enable !== undefined ? { enable: query.enable === 'true' } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { phone: { contains: keyword } },
            ],
          }
        : {}),
    }

    const orderBy = this.contactOrderBy(sort, fields)
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customerContact.findMany({
        where,
        include: contactInclude,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customerContact.count({ where }),
    ])
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
      total,
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
      valueAxis: this.aggregateChartValues(method, bucket.count, bucket.values),
    }))
  }

  /** 客户详情内嵌联系人：继续沿用 W1.2 协作语义。 */
  async listByCustomer(user: AuthUser, customerId: string): Promise<ContactVO[]> {
    if (!customerId) throw new BadRequestException('缺少 customerId')
    const access = await this.customerAccess.assertRead(user, customerId)
    const rows = await this.prisma.customerContact.findMany({
      where: {
        organizationId: user.tenantId,
        customerId,
        ...(!access.dataScope && access.collaborationType === 'COLLABORATION'
          ? { owner: user.id }
          : {}),
      },
      include: contactInclude,
      orderBy: { createTime: 'asc' },
    })
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const [values, ownerNames] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'customerContact',
        rows.map((item) => item.id),
      ),
      this.userNames(rows.map((item) => item.owner)),
    ])
    return rows.map((item) =>
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
    const contact = await this.prisma.$transaction(async (tx) => {
      const created = await tx.customerContact.create({
        data: {
          customerId: data.customerId ?? null,
          name: data.name,
          phone: data.phone ?? null,
          owner: owner.id,
          enable: true,
          disableReason: null,
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
        include: contactInclude,
      })
      await this.fieldValues.save(
        user.tenantId,
        'customerContact',
        created.id,
        customData ?? {},
        'create',
        tx,
      )
      return created
    })
    await this.notifications.send({
      tenantId: user.tenantId,
      event: 'CUSTOMER_CONCAT_ADD',
      operatorId: user.id,
      recipientIds: [contact.customer?.owner],
      excludeSelf: true,
      type: 'system',
      title: '客户新增联系人',
      content: contact.customer
        ? `${user.name} 为客户「${contact.customer.name}」新增联系人「${contact.name}」`
        : `${user.name} 新增联系人「${contact.name}」`,
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
    const contact = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.customerContact.update({
        where: { id },
        data: {
          ...(rest.name !== undefined ? { name: rest.name } : {}),
          ...(rest.phone !== undefined ? { phone: rest.phone } : {}),
          ...(customerId ? { customerId } : {}),
          ...(owner ? { owner: owner.id } : {}),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
        include: contactInclude,
      })
      if (customData) {
        await this.fieldValues.save(user.tenantId, 'customerContact', id, customData, 'update', tx)
      }
      return updated
    })
    return this.toSingleVO(user, contact)
  }

  async enable(user: AuthUser, id: string): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    await this.assertWrite(
      user,
      existing,
      this.pickPermission(user, 'contact:update', 'customer:update'),
    )
    const contact = await this.prisma.customerContact.update({
      where: { id },
      data: {
        enable: true,
        disableReason: null,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
      include: contactInclude,
    })
    return this.toSingleVO(user, contact)
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
    const contact = await this.prisma.customerContact.update({
      where: { id },
      data: {
        enable: false,
        disableReason: normalized,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      },
      include: contactInclude,
    })
    return this.toSingleVO(user, contact)
  }

  async checkOpportunity(user: AuthUser, id: string): Promise<{ linked: boolean; count: number }> {
    await this.ensureReadable(user, id)
    const count = await this.prisma.opportunity.count({
      where: { tenantId: user.tenantId, contactId: id },
    })
    return { linked: count > 0, count }
  }

  async remove(user: AuthUser, id: string) {
    const contact = await this.ensureExists(user, id)
    await this.assertWrite(
      user,
      contact,
      this.pickPermission(user, 'contact:delete', 'customer:delete'),
    )
    const linked = await this.prisma.opportunity.count({
      where: { tenantId: user.tenantId, contactId: id },
    })
    if (linked > 0) throw new BadRequestException('联系人已关联商机，请先在商机中解除联系人关联')
    await this.prisma.$transaction(async (tx) => {
      await Promise.all([
        tx.customerContactField.deleteMany({ where: { resourceId: id } }),
        tx.customerContactFieldBlob.deleteMany({ where: { resourceId: id } }),
        tx.attachment.deleteMany({
          where: { tenantId: user.tenantId, targetType: 'contact', targetId: id },
        }),
      ])
      await tx.customerContact.delete({ where: { id } })
    })
    return { id, name: contact.name }
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    const scope = (await this.dataScope.directOwnerFilter(
      user,
      'contact:read',
    )) as Prisma.CustomerContactWhereInput
    const contacts = await this.prisma.customerContact.findMany({
      where: { organizationId: user.tenantId, id: { in: dto.ids }, AND: [scope] },
    })
    if (contacts.length !== dto.ids.length) {
      throw new ForbiddenException('选中联系人包含不存在或不在你数据范围内的数据')
    }

    if (field.key === 'owner' || field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string') throw new BadRequestException('负责人值无效')
      const owner = await this.resolveOwner(user, dto.fieldValue)
      await this.prisma.customerContact.updateMany({
        where: { organizationId: user.tenantId, id: { in: dto.ids } },
        data: { owner: owner.id, updateTime: BigInt(Date.now()), updateUser: user.id },
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }
    if (field.key === 'customerId') {
      if (typeof dto.fieldValue !== 'string') throw new BadRequestException('客户值无效')
      await this.customerAccess.assertCollaborateWrite(user, dto.fieldValue, 'contact:update')
      await this.prisma.customerContact.updateMany({
        where: { organizationId: user.tenantId, id: { in: dto.ids } },
        data: { customerId: dto.fieldValue, updateTime: BigInt(Date.now()), updateUser: user.id },
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }
    if (field.key === 'enable') {
      const enable = Boolean(dto.fieldValue)
      await this.prisma.customerContact.updateMany({
        where: { organizationId: user.tenantId, id: { in: dto.ids } },
        data: {
          enable,
          ...(enable ? { disableReason: null } : {}),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    if (!field.system) {
      await this.prisma.$transaction((tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'customerContact',
          contacts.map((contact) => contact.id),
          field.id,
          dto.fieldValue,
          tx,
        ),
      )
    } else if (field.key === 'name' || field.key === 'phone') {
      await this.prisma.customerContact.updateMany({
        where: { organizationId: user.tenantId, id: { in: dto.ids } },
        data: {
          [field.key]: dto.fieldValue,
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
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
            await this.prisma.customerContact.update({
              where: { id: row.resourceId },
              data: {
                enable: true,
                disableReason: null,
                updateTime: BigInt(Date.now()),
                updateUser: user.id,
              },
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
    return this.exportTasks.create(user, {
      module: MODULE,
      fileName: input.fileName,
      columns,
      rows,
    })
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

  private async ensureReadable(user: AuthUser, id: string): Promise<ContactWithRelations> {
    const contact = await this.prisma.customerContact.findFirst({
      where: { id, organizationId: user.tenantId },
      include: contactInclude,
    })
    if (!contact) throw new NotFoundException('联系人不存在')
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

  private async assertWrite(user: AuthUser, contact: CustomerContact, permission: string) {
    if (await this.dataScope.matchesDirectOwner(user, contact.owner, permission)) return
    if (!contact.customerId) throw new ForbiddenException('联系人尚未关联客户')
    const access = await this.customerAccess.assertRead(user, contact.customerId)
    if (access.dataScope) return
    if (access.collaborationType === 'COLLABORATION' && contact.owner === user.id) return
    throw new ForbiddenException('无权维护该联系人')
  }

  private async ensureIndependentInScope(user: AuthUser, id: string) {
    const scope = (await this.dataScope.directOwnerFilter(
      user,
      'contact:import',
    )) as Prisma.CustomerContactWhereInput
    return this.prisma.customerContact.findFirst({
      where: { id, organizationId: user.tenantId, AND: [scope] },
    })
  }

  private async resolveListScope(
    user: AuthUser,
    builtInView?: string,
  ): Promise<Prisma.CustomerContactWhereInput> {
    if (!builtInView) {
      return (await this.dataScope.directOwnerFilter(
        user,
        'contact:read',
      )) as Prisma.CustomerContactWhereInput
    }
    if (builtInView === 'SELF') return { owner: user.id }
    if (builtInView === 'ALL') {
      const effective = await this.dataScope.resolveScope(user, 'contact:read')
      if (!effective.all) throw new ForbiddenException('当前角色没有全部联系人数据权限')
      return {}
    }
    if (builtInView === 'DEPT') {
      const effective = await this.dataScope.resolveScope(user, 'contact:read')
      if (!effective.all && effective.deptIds.length === 0) {
        throw new ForbiddenException('当前角色没有部门联系人数据权限')
      }
      if (effective.all) return {}
      const deptIds = effective.deptIds
      if (deptIds.length === 0) return { owner: user.id }
      const owners = await this.prisma.user.findMany({
        where: { tenantId: user.tenantId, status: 'ACTIVE', deptId: { in: deptIds } },
        select: { id: true },
      })
      return { owner: { in: [...new Set([user.id, ...owners.map((item) => item.id)])] } }
    }
    return (await this.dataScope.directOwnerFilter(
      user,
      'contact:read',
    )) as Prisma.CustomerContactWhereInput
  }

  private pickPermission(user: AuthUser, preferred: string, fallback: string) {
    return hasPermission(user.permissions, preferred) ? preferred : fallback
  }

  private async ensureExists(user: AuthUser, id: string) {
    const contact = await this.prisma.customerContact.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!contact) throw new NotFoundException('联系人不存在')
    return contact
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    if (!ownerId || ownerId === user.id) return { id: user.id, deptId: user.deptId }
    const direct = await this.prisma.user.findFirst({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        OR: [{ id: ownerId }, { email: { equals: ownerId, mode: 'insensitive' } }],
      },
      select: { id: true, deptId: true },
    })
    if (direct) return direct
    const byName = await this.prisma.user.findMany({
      where: { tenantId: user.tenantId, status: 'ACTIVE', name: ownerId },
      select: { id: true, deptId: true },
      take: 2,
    })
    if (byName.length === 0) throw new BadRequestException('联系人负责人不存在或已禁用')
    if (byName.length > 1) throw new BadRequestException('负责人名称不唯一，请填写邮箱')
    return byName[0]
  }

  private async resolveImportCustomer(user: AuthUser, value: string) {
    const input = value.trim()
    if (!input) throw new BadRequestException('客户不能为空')
    const direct = await this.prisma.customer.findFirst({
      where: { organizationId: user.tenantId, id: input },
      select: { id: true },
    })
    if (direct) return direct.id
    const matches = await this.prisma.customer.findMany({
      where: { organizationId: user.tenantId, name: input },
      select: { id: true },
      take: 2,
    })
    if (matches.length === 0) throw new BadRequestException(`客户「${input}」不存在`)
    if (matches.length > 1)
      throw new BadRequestException(`客户名称「${input}」不唯一，请填写客户 ID`)
    return matches[0].id
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
      const duplicate = await this.prisma.customerContact.findFirst({
        where: {
          organizationId: tenantId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          ...(key === 'name' ? { name: value } : { phone: value }),
        },
        select: { id: true },
      })
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
    const byIdentity = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
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

  private contactOrderBy(
    sort: ContactSortDto | undefined,
    fields: FieldVO[],
  ): Prisma.CustomerContactOrderByWithRelationInput[] {
    if (!sort) return [{ createTime: 'desc' }, { id: 'asc' }]
    const field = fields.find((item) => item.id === sort.fieldId || item.key === sort.fieldId)
    if (!field || field.key.startsWith('cf_')) return [{ createTime: 'desc' }, { id: 'asc' }]
    const direction = sort.direction.toLowerCase() as Prisma.SortOrder
    const keyMap: Record<string, keyof Prisma.CustomerContactOrderByWithRelationInput> = {
      name: 'name',
      phone: 'phone',
      owner: 'owner',
      ownerId: 'owner',
      customerId: 'customerId',
      enable: 'enable',
      createTime: 'createTime',
      updateTime: 'updateTime',
    }
    const key = keyMap[field.key]
    if (!key) return [{ createTime: 'desc' }, { id: 'asc' }]
    return [{ [key]: direction } as Prisma.CustomerContactOrderByWithRelationInput, { id: 'asc' }]
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
            await this.fieldValues.filterResourceIds(organizationId, 'customerContact', [
              condition,
            ]),
          )
        }
        const normalized = condition.key === 'ownerId' ? { ...condition, key: 'owner' } : condition
        const clauses = buildFilterClauses(fieldMap, [normalized])
        const rows = await this.prisma.customerContact.findMany({
          where: { organizationId, AND: clauses as Prisma.CustomerContactWhereInput[] },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
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

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async userNames(ids: Array<string | null>): Promise<Map<string | null, string>> {
    const userIds = [...new Set(ids.filter((id): id is string => Boolean(id)))]
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true },
        })
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
