import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FieldVO, FilterCondition, ImportResultVO } from '@micromatrix/shared'
import { not, or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { formatForExport } from '../../common/export-format'
import { PrismaService } from '../../prisma/prisma.service'
import { createLegacyId32 } from '../../common/legacy-id'
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import {
  BusinessTitleAddDto,
  BusinessTitleApprovalDto,
  BusinessTitleExportDto,
  BusinessTitleExportSelectDto,
  BusinessTitlePageDto,
  BusinessTitleUpdateDto,
} from './dto/contract-invoice.dto'

const CONFIG_TO_DTO: Record<string, keyof BusinessTitleAddDto> = {
  name: 'name',
  identification_number: 'identificationNumber',
  opening_bank: 'openingBank',
  bank_account: 'bankAccount',
  registration_address: 'registrationAddress',
  phone_number: 'phoneNumber',
  registered_capital: 'registeredCapital',
  company_size: 'companySize',
  registration_number: 'registrationNumber',
  province: 'province',
  city: 'city',
  scale: 'scale',
  industry: 'industry',
  remark: 'remark',
}

function businessTitleField(
  key: string,
  label: string,
  type: FieldVO['type'] = 'text',
  options: FieldVO['options'] = null,
  showInList = true,
): FieldVO {
  return {
    id: `businessTitle:${key}`,
    module: 'businessTitle',
    key,
    label,
    type,
    required: false,
    system: true,
    hidden: false,
    options,
    config: null,
    sort: 0,
    span: 12,
    showInList,
    listWidth: null,
  }
}

const BUSINESS_TITLE_FIELDS: FieldVO[] = [
  businessTitleField('id', '唯一ID', 'text', null, false),
  businessTitleField('companyNumber', '工商编号', 'number'),
  businessTitleField('name', '工商抬头名称'),
  businessTitleField('type', '抬头类型', 'select', [
    { label: '自定义', value: 'CUSTOM' },
    { label: '第三方', value: 'THIRD_PARTY' },
  ]),
  businessTitleField('identificationNumber', '纳税人识别号'),
  businessTitleField('openingBank', '开户行'),
  businessTitleField('bankAccount', '银行账号'),
  businessTitleField('registrationAddress', '注册地址'),
  businessTitleField('phoneNumber', '电话'),
  businessTitleField('registeredCapital', '注册资本'),
  businessTitleField('companySize', '企业规模'),
  businessTitleField('registrationNumber', '注册号'),
  businessTitleField('province', '省份'),
  businessTitleField('city', '城市'),
  businessTitleField('scale', '规模'),
  businessTitleField('industry', '行业'),
  businessTitleField('remark', '备注', 'textarea', null, false),
  businessTitleField('approvalStatus', '审批状态', 'select', [
    { label: '未审批', value: 'NONE' },
    { label: '审批中', value: 'APPROVING' },
    { label: '已通过', value: 'APPROVED' },
    { label: '已驳回', value: 'UNAPPROVED' },
    { label: '已撤回', value: 'REVOKED' },
  ]),
  businessTitleField('createTime', '创建时间', 'datetime', null, false),
  businessTitleField('updateTime', '更新时间', 'datetime', null, false),
]

const BUSINESS_TITLE_IMPORT_KEYS = new Set([
  'name',
  'type',
  'identificationNumber',
  'openingBank',
  'bankAccount',
  'registrationAddress',
  'phoneNumber',
  'registeredCapital',
  'companySize',
  'registrationNumber',
  'province',
  'city',
  'scale',
  'industry',
  'remark',
])

type BusinessTitleCollection = ReturnType<
  PrismaService['client']['orm']['public']['BusinessTitle']['where']
>

const NULLABLE_VARCHAR_255_FILTER_KEYS = [
  'identificationNumber',
  'openingBank',
  'bankAccount',
  'registrationAddress',
  'phoneNumber',
  'registeredCapital',
  'companySize',
  'registrationNumber',
  'province',
  'city',
  'scale',
  'industry',
  'remark',
] as const

type NullableVarchar255FilterKey = (typeof NULLABLE_VARCHAR_255_FILTER_KEYS)[number]
type NullableVarchar50FilterKey = 'type' | 'approvalStatus'
type BigIntFilterKey = 'companyNumber' | 'createTime' | 'updateTime'

@Injectable()
export class BusinessTitleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  async form(user: AuthUser) {
    const configs = await this.config(user)
    const required = new Set(
      configs
        .filter((item) => item.required)
        .map((item) => CONFIG_TO_DTO[item.field])
        .filter((key): key is keyof BusinessTitleAddDto => Boolean(key)),
    )
    return {
      formKey: 'businessTitle',
      formProp: {},
      fields: BUSINESS_TITLE_FIELDS.map((field, sort) => ({
        ...field,
        sort,
        required: required.has(field.key as keyof BusinessTitleAddDto),
      })),
    }
  }

  async page(user: AuthUser, dto: BusinessTitlePageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    let rowsQuery = this.prisma.client.orm.public.BusinessTitle.where({
      organizationId: user.tenantId,
    })
    const keyword = dto.keyword?.trim()
    if (keyword) {
      rowsQuery = rowsQuery.where((row) =>
        or(row.name.ilike(`%${keyword}%`), row.identificationNumber.ilike(`%${keyword}%`)),
      )
    }
    const conditions = (dto.filters ?? []).filter((condition) => this.isDirectCondition(condition))
    if (conditions.length) {
      if (dto.filterMode === 'OR') {
        const matched = new Set<string>()
        for (const condition of conditions) {
          const ids = await this.applyDirectCondition(rowsQuery, condition).select('id').all()
          ids.forEach(({ id }) => matched.add(id))
        }
        if (!matched.size) return { list: [], total: 0, current, pageSize }
        rowsQuery = rowsQuery.where((row) => row.id.in([...matched]))
      } else {
        for (const condition of conditions)
          rowsQuery = this.applyDirectCondition(rowsQuery, condition)
      }
    }
    const [rows, total] = await Promise.all([
      rowsQuery
        .orderBy([(row) => row.updateTime.desc(), (row) => row.id.desc()])
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .all(),
      rowsQuery.aggregate((agg) => ({ count: agg.count() })).then((result) => result.count),
    ])
    return { list: rows.map((row) => this.toVO(row)), total, current, pageSize }
  }

  async get(user: AuthUser, id: string) {
    return this.toVO(await this.ensure(user, id))
  }

  async options(user: AuthUser) {
    const rows = await this.prisma.client.orm.public.BusinessTitle.where({
      organizationId: user.tenantId,
      approvalStatus: 'APPROVED',
    })
      .orderBy([(row) => row.name.asc(), (row) => row.id.asc()])
      .all()
    return rows.map((row) => this.toVO(row))
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.importFields(user)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType)
    return {
      filename: `工商抬头${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.importFields(user)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    return this.runImport(user, rows, importType, false)
  }

  async importXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    const fields = await this.importFields(user)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    return this.runImport(user, rows, importType, true)
  }

  exportAll(user: AuthUser, dto: BusinessTitleExportDto) {
    return this.exportXlsx(user, dto, dto.fileName, dto.headList)
  }

  exportSelected(user: AuthUser, dto: BusinessTitleExportSelectDto) {
    return this.exportXlsx(user, {}, dto.fileName, dto.headList, dto.ids)
  }

  async add(user: AuthUser, dto: BusinessTitleAddDto) {
    await this.assertName(user, dto.name)
    await this.assertRequired(user, dto as unknown as Record<string, unknown>)
    const now = BigInt(Date.now())
    const row = await this.prisma.client.orm.public.BusinessTitle.create({
      id: createLegacyId32(),
      ...this.data(dto),
      name: dto.name.trim(),
      approvalStatus: (dto.type ?? 'CUSTOM') === 'CUSTOM' ? 'APPROVING' : 'APPROVED',
      organizationId: user.tenantId,
      createTime: now,
      updateTime: now,
      createUser: user.id,
      updateUser: user.id,
    })
    return this.toVO(row)
  }

  async update(user: AuthUser, dto: BusinessTitleUpdateDto) {
    const current = await this.ensure(user, dto.id)
    if (dto.name && dto.name.trim() !== current.name) await this.assertName(user, dto.name, dto.id)
    const merged = { ...this.toVO(current), ...dto }
    await this.assertRequired(user, merged)
    const nextType = dto.type ?? (current._type as 'CUSTOM' | 'THIRD_PARTY' | null) ?? 'CUSTOM'
    const row = await this.prisma.client.orm.public.BusinessTitle.where({
      id: dto.id,
    }).update({
      ...this.data(dto),
      approvalStatus: nextType === 'CUSTOM' ? 'APPROVING' : 'APPROVED',
      unapprovedReason: null,
      updateTime: BigInt(Date.now()),
      updateUser: user.id,
    })
    if (!row) throw new NotFoundException('工商抬头不存在')
    return this.toVO(row)
  }

  async hasInvoice(user: AuthUser, id: string) {
    await this.ensure(user, id)
    const count = await this.prisma.client.orm.public.ContractInvoice.where({
      businessTitleId: id,
    }).aggregate((agg) => ({ count: agg.count() }))
    return count.count > 0
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensure(user, id)
    if (await this.hasInvoice(user, id))
      throw new BadRequestException('该工商抬头已被发票引用，无法删除')
    await this.prisma.client.orm.public.BusinessTitle.where({ id: id }).deleteAndCount()
    return { id, name: row.name }
  }

  async approval(user: AuthUser, dto: BusinessTitleApprovalDto) {
    await this.ensure(user, dto.id)
    await this.prisma.client.orm.public.BusinessTitle.where({ id: dto.id }).update({
      approvalStatus: dto.approvalStatus,
      unapprovedReason:
        dto.approvalStatus === 'UNAPPROVED'
          ? dto.reason?.trim()
            ? dto.reason.trim()
            : null
          : null,
      updateTime: BigInt(Date.now()),
      updateUser: user.id,
    })
    return this.get(user, dto.id)
  }

  async revoke(user: AuthUser, id: string) {
    const row = await this.ensure(user, id)
    if (!['APPROVING', 'APPROVED', 'UNAPPROVED'].includes(row.approvalStatus ?? '')) {
      throw new BadRequestException('当前工商抬头状态不可撤回')
    }
    await this.prisma.client.orm.public.BusinessTitle.where({ id: id }).update({
      approvalStatus: 'REVOKED',
      updateTime: BigInt(Date.now()),
      updateUser: user.id,
    })
    return this.get(user, id)
  }

  config(user: AuthUser) {
    return this.prisma.client.orm.public.BusinessTitleConfig.where({
      organizationId: user.tenantId,
    })
      .orderBy((row) => row.field.asc())
      .all()
  }

  async switchRequired(user: AuthUser, id: string) {
    const row = await this.prisma.client.orm.public.BusinessTitleConfig.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row) throw new NotFoundException('工商抬头配置不存在')
    return this.prisma.client.orm.public.BusinessTitleConfig.where({ id: id }).update({
      required: !row.required,
    })
  }

  private async ensure(user: AuthUser, id: string) {
    const row = await this.prisma.client.orm.public.BusinessTitle.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row) throw new NotFoundException('工商抬头不存在')
    return row
  }

  private async assertName(user: AuthUser, name: string, excludeId?: string) {
    let rows = this.prisma.client.orm.public.BusinessTitle.where({
      organizationId: user.tenantId,
      name: name.trim(),
    })
    if (excludeId) rows = rows.where((row) => row.id.neq(excludeId))
    const row = await rows.select('id').first()
    if (row) throw new BadRequestException('工商抬头已存在')
  }

  private async assertRequired(user: AuthUser, dto: Record<string, unknown>) {
    const configs = await this.prisma.client.orm.public.BusinessTitleConfig.where({
      organizationId: user.tenantId,
      required: true,
    }).all()
    for (const config of configs) {
      const key = CONFIG_TO_DTO[config.field]
      if (!key) continue
      const value = dto[key]
      if (value === undefined || value === null || String(value).trim() === '') {
        throw new BadRequestException(`工商抬头必填字段不能为空：${config.field}`)
      }
    }
  }

  private data(dto: Partial<BusinessTitleAddDto>) {
    return {
      name: dto.name === undefined ? undefined : dto.name.trim(),
      _type: dto.type === undefined ? undefined : dto.type,
      identificationNumber:
        dto.identificationNumber === undefined
          ? undefined
          : dto.identificationNumber?.trim()
            ? dto.identificationNumber.trim()
            : null,
      openingBank:
        dto.openingBank === undefined
          ? undefined
          : dto.openingBank?.trim()
            ? dto.openingBank.trim()
            : null,
      bankAccount:
        dto.bankAccount === undefined
          ? undefined
          : dto.bankAccount?.trim()
            ? dto.bankAccount.trim()
            : null,
      registrationAddress:
        dto.registrationAddress === undefined
          ? undefined
          : dto.registrationAddress?.trim()
            ? dto.registrationAddress.trim()
            : null,
      phoneNumber:
        dto.phoneNumber === undefined
          ? undefined
          : dto.phoneNumber?.trim()
            ? dto.phoneNumber.trim()
            : null,
      registeredCapital:
        dto.registeredCapital === undefined
          ? undefined
          : dto.registeredCapital?.trim()
            ? dto.registeredCapital.trim()
            : null,
      companySize:
        dto.companySize === undefined
          ? undefined
          : dto.companySize?.trim()
            ? dto.companySize.trim()
            : null,
      registrationNumber:
        dto.registrationNumber === undefined
          ? undefined
          : dto.registrationNumber?.trim()
            ? dto.registrationNumber.trim()
            : null,
      province:
        dto.province === undefined ? undefined : dto.province?.trim() ? dto.province.trim() : null,
      city: dto.city === undefined ? undefined : dto.city?.trim() ? dto.city.trim() : null,
      scale: dto.scale === undefined ? undefined : dto.scale?.trim() ? dto.scale.trim() : null,
      industry:
        dto.industry === undefined ? undefined : dto.industry?.trim() ? dto.industry.trim() : null,
      remark: dto.remark === undefined ? undefined : dto.remark?.trim() ? dto.remark.trim() : null,
    }
  }

  private async importFields(user: AuthUser) {
    const form = await this.form(user)
    return form.fields.filter((field) => BUSINESS_TITLE_IMPORT_KEYS.has(field.key))
  }

  private async runImport(
    user: AuthUser,
    rows: Array<{
      rowNum: number
      resourceId?: string
      values: Record<string, unknown>
      errors: string[]
    }>,
    importType: ImportType,
    persist: boolean,
  ): Promise<ImportResultVO> {
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          const input = this.prepareImport(row.values)
          if (importType === 'ADD') {
            if (!input.name) throw new BadRequestException('工商抬头名称不能为空')
            if (persist) await this.add(user, input as BusinessTitleAddDto)
            else {
              await this.assertName(user, input.name)
              await this.assertRequired(user, input as Record<string, unknown>)
            }
          } else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            const current = await this.ensure(user, row.resourceId)
            if (input.name && input.name !== current.name) {
              await this.assertName(user, input.name, row.resourceId)
            }
            await this.assertRequired(user, { ...this.toVO(current), ...input })
            if (persist) await this.update(user, { id: row.resourceId, ...input })
          }
          successCount++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '导入校验失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: row.rowNum, errMsg: errors.join('；') })
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  private prepareImport(values: Record<string, unknown>): Partial<BusinessTitleAddDto> {
    const result: Record<string, unknown> = {}
    for (const key of BUSINESS_TITLE_IMPORT_KEYS) {
      if (values[key] === undefined) continue
      if (key === 'type') {
        const value = String(values[key]).trim()
        if (!['CUSTOM', 'THIRD_PARTY'].includes(value))
          throw new BadRequestException('抬头类型不正确')
        result[key] = value
      } else {
        result[key] = String(values[key]).trim()
      }
    }
    return result as Partial<BusinessTitleAddDto>
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<BusinessTitlePageDto>,
    fileName: string,
    headList: string[],
    ids?: string[],
  ) {
    return this.exportTasks.enqueue(user, {
      module: 'businessTitle',
      fileName,
      payload: { version: 1, query, input: { headList, ids } },
    })
  }

  async buildQueuedExport(
    user: AuthUser,
    payload: QueuedExportTaskPayload,
  ): Promise<ExportBuildResult> {
    const input = payload.input as { headList: string[]; ids?: string[] }
    return this.buildExportXlsx(
      user,
      payload.query as Partial<BusinessTitlePageDto>,
      input.headList,
      input.ids,
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<BusinessTitlePageDto>,
    headList: string[],
    ids?: string[],
  ): Promise<ExportBuildResult> {
    const items = await this.collectItems(user, query, ids)
    const fieldMap = new Map(BUSINESS_TITLE_FIELDS.map((field) => [field.key, field]))
    const columns = headList.map((key) => {
      const field = fieldMap.get(key)
      if (!field) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field.label }
    })
    const rows = items.map((item) =>
      Object.fromEntries(
        columns.map(({ key }) => [
          key,
          formatForExport(fieldMap.get(key) as FieldVO, item as Record<string, unknown>),
        ]),
      ),
    )
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
  }

  private async collectItems(user: AuthUser, query: Partial<BusinessTitlePageDto>, ids?: string[]) {
    const all: Awaited<ReturnType<BusinessTitleService['page']>>['list'] = []
    let current = 1
    while (true) {
      const result = await this.page(user, { ...query, current, pageSize: 500 })
      all.push(...result.list)
      if (all.length >= result.total || !result.list.length) break
      current++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size) {
      throw new BadRequestException('选中数据包含不存在或无权导出的工商抬头')
    }
    return selected
  }

  private isDirectCondition(condition: FilterCondition): boolean {
    return (
      BUSINESS_TITLE_FIELDS.some((field) => field.key === condition.key) && condition.key !== 'id'
    )
  }

  private applyDirectCondition(
    collection: BusinessTitleCollection,
    condition: FilterCondition,
  ): BusinessTitleCollection {
    const key = condition.key
    if (key === 'name') return this.applyNameCondition(collection, condition)
    if (key === 'type' || key === 'approvalStatus') {
      return this.applyNullableVarchar50Condition(collection, key, condition)
    }
    if ((NULLABLE_VARCHAR_255_FILTER_KEYS as readonly string[]).includes(key)) {
      return this.applyNullableVarchar255Condition(
        collection,
        key as NullableVarchar255FilterKey,
        condition,
      )
    }
    if (key === 'companyNumber' || key === 'createTime' || key === 'updateTime') {
      return this.applyBigIntCondition(collection, key, condition)
    }
    return collection
  }

  private applyNameCondition(
    collection: BusinessTitleCollection,
    condition: FilterCondition,
  ): BusinessTitleCollection {
    if (condition.op === 'isEmpty') {
      return collection.where((row) => row.id.eq(''))
    }
    if (condition.op === 'notEmpty') return collection
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (value) => String(value ?? ''),
    )
    if (condition.op === 'in') return collection.where((row) => row.name.in(values))
    if (condition.op === 'notIn') return collection.where((row) => not(row.name.in(values)))
    const value = values[0]!
    if (condition.op === 'eq') return collection.where((row) => row.name.eq(value))
    if (condition.op === 'ne') return collection.where((row) => row.name.neq(value))
    if (condition.op === 'contains') {
      return collection.where((row) => row.name.ilike(`%${String(condition.value ?? '')}%`))
    }
    if (condition.op === 'notContains') {
      return collection.where((row) => not(row.name.ilike(`%${String(condition.value ?? '')}%`)))
    }
    if (condition.op === 'gt') return collection.where((row) => row.name.gt(value))
    if (condition.op === 'gte') return collection.where((row) => row.name.gte(value))
    if (condition.op === 'lt') return collection.where((row) => row.name.lt(value))
    if (condition.op === 'lte') return collection.where((row) => row.name.lte(value))
    return collection
  }

  private applyNullableVarchar50Condition(
    collection: BusinessTitleCollection,
    key: NullableVarchar50FilterKey,
    condition: FilterCondition,
  ): BusinessTitleCollection {
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (value) => String(value ?? ''),
    )
    return collection.where((row) => {
      const field = key === 'type' ? row._type : row.approvalStatus
      if (condition.op === 'isEmpty') return field.isNull()
      if (condition.op === 'notEmpty') return field.isNotNull()
      if (condition.op === 'in') return field.in(values)
      if (condition.op === 'notIn') return not(field.in(values))
      const value = values[0]!
      if (condition.op === 'eq') return field.eq(value)
      if (condition.op === 'ne') return field.neq(value)
      if (condition.op === 'contains') return field.ilike(`%${String(condition.value ?? '')}%`)
      if (condition.op === 'notContains') {
        return not(field.ilike(`%${String(condition.value ?? '')}%`))
      }
      if (condition.op === 'gt') return field.gt(value)
      if (condition.op === 'gte') return field.gte(value)
      if (condition.op === 'lt') return field.lt(value)
      if (condition.op === 'lte') return field.lte(value)
      return field.eq(value)
    })
  }

  private applyNullableVarchar255Condition(
    collection: BusinessTitleCollection,
    key: NullableVarchar255FilterKey,
    condition: FilterCondition,
  ): BusinessTitleCollection {
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (value) => String(value ?? ''),
    )
    return collection.where((row) => {
      const field =
        key === 'identificationNumber'
          ? row.identificationNumber
          : key === 'openingBank'
            ? row.openingBank
            : key === 'bankAccount'
              ? row.bankAccount
              : key === 'registrationAddress'
                ? row.registrationAddress
                : key === 'phoneNumber'
                  ? row.phoneNumber
                  : key === 'registeredCapital'
                    ? row.registeredCapital
                    : key === 'companySize'
                      ? row.companySize
                      : key === 'registrationNumber'
                        ? row.registrationNumber
                        : key === 'province'
                          ? row.province
                          : key === 'city'
                            ? row.city
                            : key === 'scale'
                              ? row.scale
                              : key === 'industry'
                                ? row.industry
                                : row.remark
      if (condition.op === 'isEmpty') return field.isNull()
      if (condition.op === 'notEmpty') return field.isNotNull()
      if (condition.op === 'in') return field.in(values)
      if (condition.op === 'notIn') return not(field.in(values))
      const value = values[0]!
      if (condition.op === 'eq') return field.eq(value)
      if (condition.op === 'ne') return field.neq(value)
      if (condition.op === 'contains') return field.ilike(`%${String(condition.value ?? '')}%`)
      if (condition.op === 'notContains') {
        return not(field.ilike(`%${String(condition.value ?? '')}%`))
      }
      if (condition.op === 'gt') return field.gt(value)
      if (condition.op === 'gte') return field.gte(value)
      if (condition.op === 'lt') return field.lt(value)
      if (condition.op === 'lte') return field.lte(value)
      return field.eq(value)
    })
  }

  private applyBigIntCondition(
    collection: BusinessTitleCollection,
    key: BigIntFilterKey,
    condition: FilterCondition,
  ): BusinessTitleCollection {
    if (condition.op === 'isEmpty') {
      return collection.where((row) => row.id.eq(''))
    }
    if (condition.op === 'notEmpty') return collection
    if (condition.op === 'contains' || condition.op === 'notContains') return collection
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (value) => BigInt(Number(value)),
    )
    return collection.where((row) => {
      const field =
        key === 'companyNumber'
          ? row.companyNumber
          : key === 'createTime'
            ? row.createTime
            : row.updateTime
      if (condition.op === 'in') return field.in(values)
      if (condition.op === 'notIn') return not(field.in(values))
      const value = values[0]!
      if (condition.op === 'eq') return field.eq(value)
      if (condition.op === 'ne') return field.neq(value)
      if (condition.op === 'gt') return field.gt(value)
      if (condition.op === 'gte') return field.gte(value)
      if (condition.op === 'lt') return field.lt(value)
      if (condition.op === 'lte') return field.lte(value)
      return field.eq(value)
    })
  }

  private toVO(row: Awaited<ReturnType<BusinessTitleService['ensure']>>) {
    return {
      id: row.id,
      name: row.name,
      type: row._type,
      identificationNumber: row.identificationNumber,
      openingBank: row.openingBank,
      bankAccount: row.bankAccount,
      registrationAddress: row.registrationAddress,
      phoneNumber: row.phoneNumber,
      registeredCapital: row.registeredCapital,
      companySize: row.companySize,
      registrationNumber: row.registrationNumber,
      approvalStatus: row.approvalStatus,
      unapprovedReason: row.unapprovedReason,
      province: row.province,
      city: row.city,
      scale: row.scale,
      industry: row.industry,
      remark: row.remark,
      companyNumber: Number(row.companyNumber),
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      createUser: row.createUser,
      updateUser: row.updateUser,
    }
  }
}
