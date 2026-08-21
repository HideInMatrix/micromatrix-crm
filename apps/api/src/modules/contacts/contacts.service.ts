import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
  type ContactVO,
  type FieldVO,
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
import { Prisma, type Contact } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { MetadataService } from '../metadata/metadata.service'
import { NotificationsService } from '../notifications/notifications.service'
import { SavedViewsService } from '../saved-views/saved-views.service'
import { CreateContactDto, QueryContactsDto, UpdateContactDto } from './dto/contact.dto'

const MODULE = 'contact'
const contactInclude = {
  customer: { select: { name: true, ownerId: true } },
  owner: { select: { name: true } },
} as const

type ContactWithRelations = Prisma.ContactGetPayload<{ include: typeof contactInclude }>

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerAccess: CustomerAccessService,
    private readonly dataScope: DataScopeService,
    private readonly metadata: MetadataService,
    private readonly savedViews: SavedViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Cordys 独立联系人页：按联系人 owner/dept 数据范围分页。 */
  async findAll(user: AuthUser, query: QueryContactsDto): Promise<PaginatedResult<ContactVO>> {
    this.assertIndependentReadPermission(user)
    const { page = 1, pageSize = 10, keyword } = query
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const adHoc = buildFilterClauses(fieldMap, parseFilters(query.filters))
    const builtInView = query.scopeView
    const saved = query.viewId
      ? await this.savedViews.resolveFilters(user, query.viewId, MODULE)
      : null
    const savedClauses = saved ? buildFilterClauses(fieldMap, saved.conditions) : []
    const filterClauses = [
      ...(savedClauses.length === 0
        ? []
        : saved?.searchMode === 'OR'
          ? [{ OR: savedClauses }]
          : savedClauses),
      ...adHoc,
    ]
    const scope = await this.resolveListScope(user, builtInView)
    const where: Prisma.ContactWhereInput = {
      tenantId: user.tenantId,
      AND: [scope, ...(filterClauses as Prisma.ContactWhereInput[])],
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

    const [items, total] = await this.prisma.$transaction([
      this.prisma.contact.findMany({
        where,
        include: contactInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contact.count({ where }),
    ])
    return { items: items.map((item) => this.toVO(item, fields)), total, page, pageSize }
  }

  tab(user: AuthUser) {
    const roles = user.roles.filter((role) => hasPermission(role.permissions, 'contact:read'))
    return {
      all: roles.some((role) => role.dataScope === 'ALL' || role.dataScope === 'CUSTOM'),
      dept: roles.some((role) =>
        ['ALL', 'DEPT_AND_CHILD', 'CUSTOM'].includes(role.dataScope),
      ),
    }
  }

  /** 客户详情内嵌联系人：继续沿用 W1.2 协作语义。 */
  async listByCustomer(user: AuthUser, customerId: string): Promise<ContactVO[]> {
    if (!customerId) throw new BadRequestException('缺少 customerId')
    const access = await this.customerAccess.assertRead(user, customerId)
    if (!access.dataScope && !access.pool && access.collaborationType === 'READ_ONLY') return []
    const rows = await this.prisma.contact.findMany({
      where: {
        tenantId: user.tenantId,
        customerId,
        ...(!access.dataScope && !access.pool && access.collaborationType === 'COLLABORATION'
          ? { ownerId: user.id }
          : {}),
      },
      include: contactInclude,
      orderBy: { createdAt: 'asc' },
    })
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    return rows.map((item) => this.toVO(item, fields))
  }

  async findOne(user: AuthUser, id: string): Promise<ContactVO> {
    const contact = await this.ensureReadable(user, id)
    return this.toVO(contact, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async create(user: AuthUser, dto: CreateContactDto): Promise<ContactVO> {
    const access = await this.customerAccess.assertCollaborateWrite(
      user,
      dto.customerId,
      this.pickPermission(user, 'contact:create', 'customer:create'),
    )
    if (!access.dataScope && dto.ownerId && dto.ownerId !== user.id) {
      throw new ForbiddenException('协作用户只能将联系人负责人设为自己')
    }
    const owner = await this.resolveOwner(user, dto.ownerId)
    const { ownerId: _ownerId, customData, ...data } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: true,
    })
    await this.assertContactUniqueRules(user.tenantId, data)
    const contact = await this.prisma.contact.create({
      data: {
        ...data,
        tenantId: user.tenantId,
        ownerId: owner.id,
        deptId: owner.deptId,
        enable: true,
        disableReason: null,
        customData: validated as Prisma.InputJsonValue,
      },
      include: contactInclude,
    })
    if (contact.customer.ownerId && contact.customer.ownerId !== user.id) {
      await this.notifications.notify(user.tenantId, contact.customer.ownerId, {
        type: 'system',
        title: '客户新增联系人',
        content: `${user.name} 为客户「${contact.customer.name}」新增联系人「${contact.name}」`,
        link: '/contacts',
      })
    }
    return this.toVO(contact, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async update(user: AuthUser, id: string, dto: UpdateContactDto): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    const permission = this.pickPermission(user, 'contact:update', 'customer:update')
    await this.assertWrite(user, existing, permission)
    if (dto.customerId && dto.customerId !== existing.customerId) {
      await this.customerAccess.assertCollaborateWrite(user, dto.customerId, permission)
    }
    const { customerId, ownerId, customData, ...rest } = dto
    const validated = await this.metadata.validateCustomData(user.tenantId, MODULE, customData, {
      requireAll: false,
    })
    await this.assertContactUniqueRules(user.tenantId, rest, existing.id)
    const owner = ownerId ? await this.resolveOwner(user, ownerId) : null
    const data: Prisma.ContactUpdateInput = {
      ...rest,
      ...(customerId ? { customer: { connect: { id: customerId } } } : {}),
      ...(owner ? { owner: { connect: { id: owner.id } }, deptId: owner.deptId } : {}),
      customData: {
        ...((existing.customData as Record<string, unknown> | null) ?? {}),
        ...validated,
      } as Prisma.InputJsonValue,
    }
    const contact = await this.prisma.contact.update({ where: { id }, data, include: contactInclude })
    return this.toVO(contact, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async enable(user: AuthUser, id: string): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    await this.assertWrite(user, existing, this.pickPermission(user, 'contact:update', 'customer:update'))
    const contact = await this.prisma.contact.update({
      where: { id },
      data: { enable: true, disableReason: null },
      include: contactInclude,
    })
    return this.toVO(contact, await this.metadata.listFields(user.tenantId, MODULE))
  }

  async disable(user: AuthUser, id: string, reason: string): Promise<ContactVO> {
    const existing = await this.ensureExists(user, id)
    await this.assertWrite(user, existing, this.pickPermission(user, 'contact:update', 'customer:update'))
    const normalized = reason.trim()
    if (!normalized) throw new BadRequestException('请填写停用原因')
    const contact = await this.prisma.contact.update({
      where: { id },
      data: { enable: false, disableReason: normalized },
      include: contactInclude,
    })
    return this.toVO(contact, await this.metadata.listFields(user.tenantId, MODULE))
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
    await this.assertWrite(user, contact, this.pickPermission(user, 'contact:delete', 'customer:delete'))
    const linked = await this.prisma.opportunity.count({
      where: { tenantId: user.tenantId, contactId: id },
    })
    if (linked > 0) throw new BadRequestException('联系人已关联商机，请先在商机中解除联系人关联')
    await this.prisma.$transaction([
      this.prisma.attachment.deleteMany({
        where: { tenantId: user.tenantId, targetType: 'contact', targetId: id },
      }),
      this.prisma.contact.delete({ where: { id } }),
    ])
    return { id, name: contact.name }
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto): Promise<BatchAffectResult> {
    const field = await this.metadata.resolveEditableField(user.tenantId, MODULE, dto.fieldId)
    this.metadata.validateBatchFieldValue(field, dto.fieldValue)
    const scope = (await this.dataScope.scopeFilter(user, 'contact:read')) as Prisma.ContactWhereInput
    const contacts = await this.prisma.contact.findMany({
      where: { tenantId: user.tenantId, id: { in: dto.ids }, AND: [scope] },
    })
    if (contacts.length !== dto.ids.length) {
      throw new ForbiddenException('选中联系人包含不存在或不在你数据范围内的数据')
    }

    if (field.key === 'ownerId') {
      if (typeof dto.fieldValue !== 'string') throw new BadRequestException('负责人值无效')
      const owner = await this.resolveOwner(user, dto.fieldValue)
      await this.prisma.contact.updateMany({
        where: { tenantId: user.tenantId, id: { in: dto.ids } },
        data: { ownerId: owner.id, deptId: owner.deptId },
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }
    if (field.key === 'customerId') {
      if (typeof dto.fieldValue !== 'string') throw new BadRequestException('客户值无效')
      await this.customerAccess.assertCollaborateWrite(user, dto.fieldValue, 'contact:update')
      await this.prisma.contact.updateMany({
        where: { tenantId: user.tenantId, id: { in: dto.ids } },
        data: { customerId: dto.fieldValue },
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }
    if (field.key === 'enable') {
      const enable = Boolean(dto.fieldValue)
      await this.prisma.contact.updateMany({
        where: { tenantId: user.tenantId, id: { in: dto.ids } },
        data: { enable, ...(enable ? { disableReason: null } : {}) },
      })
      return { success: dto.ids.length, fail: 0, failedIds: [] }
    }

    for (const contact of contacts) {
      if (field.key.startsWith('cf_')) {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: {
            customData: {
              ...((contact.customData as Record<string, unknown> | null) ?? {}),
              [field.key]: dto.fieldValue,
            } as Prisma.InputJsonValue,
          },
        })
      } else {
        await this.prisma.contact.update({
          where: { id: contact.id },
          data: { [field.key]: dto.fieldValue } as Prisma.ContactUpdateInput,
        })
      }
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
          const prepared = await this.prepareImportRow(user, row.values, fields, importType, row.resourceId)
          if (importType === 'ADD') {
            await this.create(user, prepared as CreateContactDto)
          } else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, row.resourceId, prepared)
            await this.prisma.contact.update({
              where: { id: row.resourceId },
              data: { enable: true, disableReason: null },
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
    if (!hasPermission(user.permissions, 'contact:export')) throw new ForbiddenException('无联系人导出权限')
    const items = await this.collectExportItems(user, query, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(fields.filter((field) => !field.hidden).map((field) => [field.key, field]))
    const extra = new Map([
      ['disableReason', '停用原因'],
      ['createdAt', '创建时间'],
      ['updatedAt', '更新时间'],
    ])
    const columns = input.headList.map((key) => {
      const field = fieldMap.get(key)
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
      } else if (key === 'ownerId') {
        dto.ownerId = (await this.resolveOwner(user, String(value))).id
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
      if (!dto.customerId) throw new BadRequestException('客户不能为空')
      if (!dto.name?.trim()) throw new BadRequestException('联系人姓名不能为空')
      await this.customerAccess.assertCollaborateWrite(user, dto.customerId, 'contact:import')
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
    if (selected.length !== wanted.size) throw new ForbiddenException('选中数据包含不存在或无权导出的联系人')
    return selected
  }

  private async ensureReadable(user: AuthUser, id: string): Promise<ContactWithRelations> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId },
      include: contactInclude,
    })
    if (!contact) throw new NotFoundException('联系人不存在')
    if (
      hasPermission(user.permissions, 'contact:read') &&
      (await this.dataScope.matchesResource(user, contact.ownerId, contact.deptId, 'contact:read'))
    ) {
      return contact
    }
    const access = await this.customerAccess.assertRead(user, contact.customerId)
    if (access.dataScope || access.pool) return contact
    if (access.collaborationType === 'COLLABORATION' && contact.ownerId === user.id) return contact
    throw new NotFoundException('联系人不存在或无权访问')
  }

  private async assertWrite(user: AuthUser, contact: Contact, permission: string) {
    if (await this.dataScope.matchesResource(user, contact.ownerId, contact.deptId, permission)) return
    const access = await this.customerAccess.assertRead(user, contact.customerId)
    if (access.dataScope) return
    if (access.collaborationType === 'COLLABORATION' && contact.ownerId === user.id) return
    throw new ForbiddenException('无权维护该联系人')
  }

  private async ensureIndependentInScope(user: AuthUser, id: string) {
    const scope = (await this.dataScope.scopeFilter(user, 'contact:import')) as Prisma.ContactWhereInput
    return this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId, AND: [scope] },
    })
  }

  private async resolveListScope(
    user: AuthUser,
    builtInView?: string,
  ): Promise<Prisma.ContactWhereInput> {
    if (!builtInView) {
      return (await this.dataScope.scopeFilter(user, 'contact:read')) as Prisma.ContactWhereInput
    }
    if (builtInView === 'SELF') return { ownerId: user.id }
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
      if (deptIds.length === 0) return { ownerId: user.id }
      return { OR: [{ ownerId: user.id }, { deptId: { in: deptIds } }] }
    }
    return (await this.dataScope.scopeFilter(user, 'contact:read')) as Prisma.ContactWhereInput
  }

  private pickPermission(user: AuthUser, preferred: string, fallback: string) {
    return hasPermission(user.permissions, preferred) ? preferred : fallback
  }

  private async ensureExists(user: AuthUser, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId: user.tenantId },
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
      where: { tenantId: user.tenantId, id: input },
      select: { id: true },
    })
    if (direct) return direct.id
    const matches = await this.prisma.customer.findMany({
      where: { tenantId: user.tenantId, name: input },
      select: { id: true },
      take: 2,
    })
    if (matches.length === 0) throw new BadRequestException(`客户「${input}」不存在`)
    if (matches.length > 1) throw new BadRequestException(`客户名称「${input}」不唯一，请填写客户 ID`)
    return matches[0].id
  }

  private assertIndependentReadPermission(user: AuthUser) {
    if (!hasPermission(user.permissions, 'contact:read')) throw new ForbiddenException('无联系人查看权限')
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
      if (!fields.get(key)?.config?.unique || raw === undefined || raw === null || raw === '') continue
      const value = raw.trim()
      if (!value) continue
      const duplicate = await this.prisma.contact.findFirst({
        where: {
          tenantId,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          ...(key === 'name' ? { name: value } : { phone: value }),
        },
        select: { id: true },
      })
      if (duplicate) throw new BadRequestException(`「${fields.get(key)?.label ?? key}」不能重复`)
    }
  }

  private assertIndependentImportPermission(user: AuthUser) {
    if (!hasPermission(user.permissions, 'contact:import')) throw new ForbiddenException('无联系人导入权限')
  }

  private toVO(contact: ContactWithRelations, fields: FieldVO[]): ContactVO {
    const customData = (contact.customData as Record<string, unknown> | null) ?? {}
    const record: Record<string, unknown> = {
      customerId: contact.customerId,
      ownerId: contact.ownerId,
      name: contact.name,
      phone: contact.phone,
      enable: contact.enable,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: contact.id,
      customerId: contact.customerId,
      customerName: contact.customer.name,
      ownerId: contact.ownerId,
      ownerName: contact.owner?.name ?? null,
      deptId: contact.deptId,
      name: contact.name,
      phone: contact.phone,
      enable: contact.enable,
      disableReason: contact.disableReason,
      customData: { ...customData, ...formulas },
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    }
  }
}
