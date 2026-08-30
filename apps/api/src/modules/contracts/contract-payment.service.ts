import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type ImportResultVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { formatForExport } from '../../common/export-format'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { ExportTasksService } from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import { ContractsService } from './contracts.service'
import {
  ContractPaymentBatchUpdateDto,
  ContractPaymentExportDto,
  ContractPaymentExportSelectDto,
  ContractPaymentPageDto,
  ContractPaymentPlanAddDto,
  ContractPaymentPlanUpdateDto,
  ContractPaymentRecordAddDto,
  ContractPaymentRecordUpdateDto,
  ContractPaymentSortDto,
} from './dto/contract-payment.dto'

const PLAN_FORM_KEY = 'contractPaymentPlan'
const RECORD_FORM_KEY = 'contractPaymentRecord'
const PLAN_READ_PERMISSION = 'CONTRACT_PAYMENT_PLAN:READ'
const RECORD_READ_PERMISSION = 'CONTRACT_PAYMENT_RECORD:READ'
const PLAN_STATUSES = new Set(['PENDING', 'PARTIALLY_COMPLETED', 'COMPLETED'])

type PaymentResourceType = 'contractPaymentPlan' | 'contractPaymentRecord'

function intersectIds(left: string[] | null, right: string[] | null): string[] | null {
  if (left === null) return right
  if (right === null) return left
  const rightSet = new Set(right)
  return left.filter((id) => rightSet.has(id))
}

function moduleFieldsFromCustomData(fields: FieldVO[], values: Record<string, unknown>) {
  return fields
    .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(values, field.key))
    .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
}

function paymentExportSource(
  fields: FieldVO[],
  item: Record<string, unknown> & { moduleFields?: Array<{ fieldId: string; fieldValue?: unknown }> },
) {
  const source: Record<string, unknown> = { ...item }
  const custom = new Map((item.moduleFields ?? []).map((field) => [field.fieldId, field.fieldValue]))
  for (const field of fields) {
    if (!field.system) source[field.key] = custom.get(field.id)
  }
  return source
}

function importedNumber(values: Record<string, unknown>, key: string, label: string) {
  if (values[key] === undefined || values[key] === null || values[key] === '') return undefined
  const value = Number(values[key])
  if (!Number.isFinite(value)) throw new BadRequestException(`「${label}」格式不正确`)
  return value
}

function importedMillis(values: Record<string, unknown>, key: string, label: string) {
  if (values[key] === undefined || values[key] === null || values[key] === '') return undefined
  if (typeof values[key] === 'number' && Number.isFinite(values[key])) return values[key] as number
  const millis = new Date(String(values[key])).getTime()
  if (!Number.isFinite(millis)) throw new BadRequestException(`「${label}」格式不正确`)
  return millis
}

function parseFilterValue(
  key: string,
  condition: FilterCondition,
  dateKeys: Set<string>,
  numberKeys: Set<string>,
) {
  let raw: unknown = condition.value
  if (dateKeys.has(key)) {
    const direct = Number(condition.value)
    const millis = Number.isFinite(direct) && String(condition.value ?? '').trim() !== ''
      ? direct
      : new Date(String(condition.value)).getTime()
    if (!Number.isFinite(millis)) return null
    raw = BigInt(Math.trunc(millis))
  } else if (numberKeys.has(key)) {
    const number = Number(condition.value)
    if (!Number.isFinite(number)) return null
    raw = number
  }
  return raw
}

function directFilterClause<T extends object>(
  key: string,
  condition: FilterCondition,
  dateKeys: Set<string>,
  numberKeys: Set<string>,
): T | null {
  const raw = parseFilterValue(key, condition, dateKeys, numberKeys)
  if (raw === null) return null
  const value = raw as never
  if (condition.op === 'eq') return { [key]: { equals: value } } as T
  if (condition.op === 'ne') return { NOT: { [key]: { equals: value } } } as T
  if (condition.op === 'contains') {
    if (dateKeys.has(key) || numberKeys.has(key)) return null
    return { [key]: { contains: String(condition.value ?? ''), mode: 'insensitive' } } as T
  }
  if (condition.op === 'gt') return { [key]: { gt: value } } as T
  if (condition.op === 'gte') return { [key]: { gte: value } } as T
  if (condition.op === 'lt') return { [key]: { lt: value } } as T
  if (condition.op === 'lte') return { [key]: { lte: value } } as T
  if (condition.op === 'isEmpty') return { [key]: null } as T
  if (condition.op === 'notEmpty') return { NOT: { [key]: null } } as T
  return null
}

@Injectable()
export class ContractPaymentPlanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly dataScope: DataScopeService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, PLAN_FORM_KEY)
  }

  async page(user: AuthUser, dto: ContractPaymentPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY)
    const saved = dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
      ? await this.userViews.resolveFilters(
          user,
          dto.viewId,
          USER_VIEW_RESOURCE_TYPES.contract_payment_plan,
        )
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode)
        : null,
      dto.filters?.length ? this.filterIds(user.tenantId, fields, dto.filters, 'AND') : null,
    ])
    const filteredIds = intersectIds(savedIds, adHocIds)
    const scope = await this.dataScope.directOwnerFilter(user, PLAN_READ_PERMISSION)
    const where: Prisma.ContractPaymentPlanWhereInput = {
      organizationId: user.tenantId,
      AND: [scope as Prisma.ContractPaymentPlanWhereInput],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(dto.contractId ? { contractId: dto.contractId } : {}),
      ...(dto.customerId ? { contract: { customerId: dto.customerId } } : {}),
      ...(dto.keyword
        ? {
            OR: [
              { name: { contains: dto.keyword, mode: 'insensitive' } },
              { contract: { name: { contains: dto.keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.contractPaymentPlan.findMany({
        where,
        include: { contract: { select: { name: true, customerId: true } } },
        orderBy: [{ createTime: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contractPaymentPlan.count({ where }),
    ])
    const [dynamic, people] = await Promise.all([
      this.fieldValues.load(user.tenantId, 'contractPaymentPlan', rows.map((row) => row.id)),
      this.people(rows.flatMap((row) => [row.owner, row.createUser, row.updateUser])),
    ])
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        contractId: row.contractId,
        contractName: row.contract.name,
        customerId: row.contract.customerId,
        owner: row.owner,
        ownerName: people.get(row.owner)?.name ?? null,
        departmentId: people.get(row.owner)?.deptId ?? null,
        departmentName: people.get(row.owner)?.deptName ?? null,
        planStatus: row.planStatus,
        planAmount: row.planAmount === null ? null : Number(row.planAmount),
        planEndTime: row.planEndTime === null ? null : Number(row.planEndTime),
        createUser: row.createUser,
        createUserName: people.get(row.createUser)?.name ?? null,
        updateUser: row.updateUser,
        updateUserName: people.get(row.updateUser)?.name ?? null,
        createTime: Number(row.createTime),
        updateTime: Number(row.updateTime),
        moduleFields: moduleFieldsFromCustomData(fields, dynamic.get(row.id) ?? {}),
      })),
      total,
      current,
      pageSize,
      optionMap: {},
    }
  }

  async get(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id)
    const [fields, dynamic, people] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY),
      this.fieldValues.load(user.tenantId, 'contractPaymentPlan', [id]),
      this.people([row.owner, row.createUser, row.updateUser]),
    ])
    return {
      id: row.id,
      name: row.name,
      contractId: row.contractId,
      contractName: row.contract.name,
      customerId: row.contract.customerId,
      owner: row.owner,
      ownerName: people.get(row.owner)?.name ?? null,
      departmentId: people.get(row.owner)?.deptId ?? null,
      departmentName: people.get(row.owner)?.deptName ?? null,
      planStatus: row.planStatus,
      planAmount: row.planAmount === null ? null : Number(row.planAmount),
      planEndTime: row.planEndTime === null ? null : Number(row.planEndTime),
      createUser: row.createUser,
      createUserName: people.get(row.createUser)?.name ?? null,
      updateUser: row.updateUser,
      updateUserName: people.get(row.updateUser)?.name ?? null,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      moduleFields: moduleFieldsFromCustomData(fields, dynamic.get(row.id) ?? {}),
      optionMap: {},
    }
  }

  async add(user: AuthUser, dto: ContractPaymentPlanAddDto) {
    await this.contracts.ensureInScope(user, dto.contractId)
    const owner = await this.resolveOwner(user, dto.owner)
    const customData = await this.moduleFieldsToCustomData(user.tenantId, PLAN_FORM_KEY, dto.moduleFields)
    const now = BigInt(Date.now())
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.contractPaymentPlan.create({
        data: {
          name: dto.name.trim(),
          contractId: dto.contractId,
          owner,
          planStatus: dto.planStatus ?? 'PENDING',
          planAmount: new Prisma.Decimal(dto.planAmount),
          planEndTime: BigInt(dto.planEndTime),
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(
        user.tenantId,
        'contractPaymentPlan',
        row.id,
        customData,
        'create',
        tx,
      )
      return row
    })
    return this.get(user, created.id)
  }

  async update(user: AuthUser, dto: ContractPaymentPlanUpdateDto) {
    const current = await this.ensureInScope(user, dto.id, 'CONTRACT_PAYMENT_PLAN:UPDATE')
    if (dto.contractId && dto.contractId !== current.contractId) {
      await this.contracts.ensureInScope(user, dto.contractId)
    }
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : undefined
    if (dto.planStatus && !PLAN_STATUSES.has(dto.planStatus)) {
      throw new BadRequestException('回款计划状态不合法')
    }
    const customData = dto.moduleFields === undefined
      ? null
      : await this.moduleFieldsToCustomData(user.tenantId, PLAN_FORM_KEY, dto.moduleFields)
    await this.prisma.$transaction(async (tx) => {
      await tx.contractPaymentPlan.update({
        where: { id: dto.id },
        data: {
          name: dto.name?.trim(),
          contractId: dto.contractId,
          owner,
          planStatus: dto.planStatus,
          planAmount: dto.planAmount === undefined ? undefined : new Prisma.Decimal(dto.planAmount),
          planEndTime: dto.planEndTime === undefined ? undefined : BigInt(dto.planEndTime),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData) {
        await this.fieldValues.save(
          user.tenantId,
          'contractPaymentPlan',
          dto.id,
          customData,
          'update',
          tx,
        )
      }
    })
    return this.get(user, dto.id)
  }

  async remove(user: AuthUser, id: string) {
    const current = await this.ensureInScope(user, id, 'CONTRACT_PAYMENT_PLAN:DELETE')
    await this.prisma.contractPaymentPlan.delete({ where: { id } })
    return { id, name: current.name }
  }

  async batchUpdate(user: AuthUser, dto: ContractPaymentBatchUpdateDto) {
    const rows = await this.assertBatchInScope(user, dto.ids, 'CONTRACT_PAYMENT_PLAN:UPDATE')
    const fields = await this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.hidden) throw new BadRequestException('字段不存在或不支持批量修改')
    if (field.system) {
      if (field.key === 'owner') {
        const owner = await this.resolveOwner(user, String(dto.fieldValue ?? ''))
        await this.prisma.contractPaymentPlan.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, organizationId: user.tenantId },
          data: { owner, updateTime: BigInt(Date.now()), updateUser: user.id },
        })
      } else if (field.key === 'planStatus') {
        const status = String(dto.fieldValue ?? '')
        if (!PLAN_STATUSES.has(status)) throw new BadRequestException('回款计划状态不合法')
        await this.prisma.contractPaymentPlan.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, organizationId: user.tenantId },
          data: { planStatus: status, updateTime: BigInt(Date.now()), updateUser: user.id },
        })
      } else {
        throw new BadRequestException('该系统字段不支持批量修改')
      }
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.fieldValues.saveBatch(
          user.tenantId,
          'contractPaymentPlan',
          rows.map((row) => row.id),
          field.id,
          dto.fieldValue,
          tx,
        )
      })
    }
    return { success: rows.length, fail: 0, skip: 0 }
  }

  async sort(user: AuthUser, dto: ContractPaymentSortDto) {
    await this.ensureInScope(user, dto.id, 'CONTRACT_PAYMENT_PLAN:UPDATE')
    // Cordys list sort ultimately uses pos; direct DDL has no pos column, so createTime is the stable order.
    // Keep endpoint unavailable until source DDL introduces a persisted sort field.
    throw new BadRequestException('回款计划当前源码模型不支持持久化手工排序')
  }

  async tab(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, PLAN_READ_PERMISSION)
    return { all: scope.all, dept: scope.deptIds.length > 0 }
  }

  async statistic(user: AuthUser, dto: ContractPaymentPageDto) {
    const items = await this.collectExportItems(user, dto)
    return {
      count: items.length,
      planAmount: Math.round(
        items.reduce((sum, item) => sum + Number(item.planAmount ?? 0), 0) * 100,
      ) / 100,
    }
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType)
    return {
      filename: `回款计划${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    const fields = await this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY)
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
    const fields = await this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          const prepared = await this.prepareImportRow(user, row.values, fields, importType, row.resourceId)
          if (importType === 'ADD') await this.add(user, prepared.add)
          else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, { id: row.resourceId, ...prepared.update })
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

  exportAll(user: AuthUser, dto: ContractPaymentExportDto) {
    return this.exportXlsx(user, dto, dto.fileName, dto.headList)
  }

  exportSelected(user: AuthUser, dto: ContractPaymentExportSelectDto) {
    return this.exportXlsx(user, {}, dto.fileName, dto.headList, dto.ids)
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<ContractPaymentPageDto>,
    fileName: string,
    headList: string[],
    ids?: string[],
  ) {
    const [items, fields] = await Promise.all([
      this.collectExportItems(user, query, ids),
      this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY),
    ])
    const fieldMap = new Map(fields.filter((field) => !field.hidden).map((field) => [field.key, field]))
    const extraColumns = new Map([
      ['planStatus', '状态'], ['contractName', '合同名称'], ['ownerName', '负责人'],
      ['departmentName', '部门'], ['createUserName', '创建人'], ['updateUserName', '更新人'],
      ['createTime', '创建时间'], ['updateTime', '更新时间'],
    ])
    const columns = headList.map((key) => {
      const field = fieldMap.get(key)
      const extra = extraColumns.get(key)
      if (!field && !extra) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extra as string) }
    })
    const rows = items.map((item) => {
      const source = paymentExportSource(fields, item as unknown as Record<string, unknown>)
      return Object.fromEntries(columns.map((column) => {
        const field = fieldMap.get(column.key)
        return [column.key, field ? formatForExport(field, source) : source[column.key] ?? '']
      }))
    })
    return this.exportTasks.create(user, { module: 'contractPaymentPlan', fileName, columns, rows })
  }

  private async collectExportItems(
    user: AuthUser,
    query: Partial<ContractPaymentPageDto>,
    ids?: string[],
  ) {
    const all: Awaited<ReturnType<ContractPaymentPlanService['page']>>['list'] = []
    let current = 1
    const pageSize = 500
    while (true) {
      const result = await this.page(user, { ...query, current, pageSize })
      all.push(...result.list)
      if (all.length >= result.total || !result.list.length) break
      current++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size) throw new BadRequestException('选中数据包含不存在或无权导出的回款计划')
    return selected
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ) {
    if (importType === 'UPDATE' && !resourceId) throw new BadRequestException('唯一ID不能为空')
    const moduleFields = fields
      .filter((field) => !field.system && values[field.key] !== undefined)
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
    const name = values['name'] === undefined ? undefined : String(values['name']).trim()
    const contractId = values['contractId'] === undefined ? undefined : String(values['contractId']).trim()
    const owner = values['owner'] === undefined ? undefined : String(values['owner']).trim() || undefined
    const planAmount = importedNumber(values, 'planAmount', '计划回款金额')
    const planEndTime = importedMillis(values, 'planEndTime', '计划回款时间')
    if (importType === 'ADD') {
      if (!name) throw new BadRequestException('回款计划名称不能为空')
      if (!contractId) throw new BadRequestException('合同不能为空')
      if (planAmount === undefined) throw new BadRequestException('计划回款金额不能为空')
      if (planEndTime === undefined) throw new BadRequestException('计划回款时间不能为空')
    }
    const common = {
      ...(name !== undefined ? { name } : {}),
      ...(contractId !== undefined ? { contractId } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(planAmount !== undefined ? { planAmount } : {}),
      ...(planEndTime !== undefined ? { planEndTime } : {}),
      ...(moduleFields.length ? { moduleFields } : {}),
    }
    return {
      add: common as ContractPaymentPlanAddDto,
      update: common as Omit<ContractPaymentPlanUpdateDto, 'id'>,
    }
  }

  private async ensureInScope(user: AuthUser, id: string, permission = PLAN_READ_PERMISSION) {
    const row = await this.prisma.contractPaymentPlan.findFirst({
      where: { id, organizationId: user.tenantId },
      include: { contract: { select: { name: true, customerId: true } } },
    })
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('回款计划不存在或不在你的数据范围内')
    }
    return row
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const unique = [...new Set(ids)]
    const rows = await this.prisma.contractPaymentPlan.findMany({
      where: { id: { in: unique }, organizationId: user.tenantId },
    })
    if (rows.length !== unique.length) throw new NotFoundException('部分回款计划不存在')
    for (const row of rows) {
      if (!(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
        throw new NotFoundException('部分回款计划不存在或不在你的数据范围内')
      }
    }
    return rows
  }

  private async filterIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ) {
    const directKeys = new Set([
      'name', 'contractId', 'owner', 'planStatus', 'planAmount', 'planEndTime',
      'createUser', 'updateUser', 'createTime', 'updateTime',
    ])
    return this.filterResourceIds(
      organizationId,
      fields,
      conditions,
      mode,
      directKeys,
      new Set(['planEndTime', 'createTime', 'updateTime']),
      new Set(['planAmount']),
      'contractPaymentPlan',
    )
  }

  private async filterResourceIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
    directKeys: Set<string>,
    dateKeys: Set<string>,
    numberKeys: Set<string>,
    resourceType: PaymentResourceType,
  ) {
    const fieldMap = new Map(fields.flatMap((field) => [[field.key, field], [field.id, field]]))
    const sets = await Promise.all(conditions.map(async (condition) => {
      if (condition.key === 'departmentId') {
        const users = await this.prisma.user.findMany({
          where: { tenantId: organizationId, deptId: String(condition.value ?? '') },
          select: { id: true },
        })
        const ownerIds = users.map((item) => item.id)
        const where = condition.op === 'ne'
          ? { organizationId, NOT: { owner: { in: ownerIds } } }
          : { organizationId, owner: { in: ownerIds } }
        const rows = resourceType === 'contractPaymentPlan'
          ? await this.prisma.contractPaymentPlan.findMany({ where, select: { id: true } })
          : await this.prisma.contractPaymentRecord.findMany({ where, select: { id: true } })
        return new Set(rows.map((row) => row.id))
      }
      if (directKeys.has(condition.key)) {
        const clause = directFilterClause<Record<string, unknown>>(
          condition.key,
          condition,
          dateKeys,
          numberKeys,
        )
        if (!clause) return new Set<string>()
        const where = { organizationId, AND: [clause] }
        const rows = resourceType === 'contractPaymentPlan'
          ? await this.prisma.contractPaymentPlan.findMany({ where, select: { id: true } })
          : await this.prisma.contractPaymentRecord.findMany({ where, select: { id: true } })
        return new Set(rows.map((row) => row.id))
      }
      const field = fieldMap.get(condition.key)
      if (!field || field.system || (isCustomFieldKey(condition.key) === false && field.hidden)) {
        return new Set<string>()
      }
      const normalized = field.key === condition.key ? condition : { ...condition, key: field.key }
      return new Set(await this.fieldValues.filterResourceIds(organizationId, resourceType, [normalized]))
    }))
    if (!sets.length) return []
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [...sets.slice(1).reduce(
      (result, set) => new Set([...result].filter((id) => set.has(id))),
      sets[0]!,
    )]
  }

  private async moduleFieldsToCustomData(
    organizationId: string,
    formKey: typeof PLAN_FORM_KEY | typeof RECORD_FORM_KEY,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, formKey)
    const map = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
    const result: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`字段不存在：${item.fieldId}`)
      if (field.system) continue
      result[field.key] = item.fieldValue
    }
    return result
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    const id = ownerId || user.id
    const owner = await this.prisma.user.findFirst({
      where: { id, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner.id
  }

  private async people(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    const users = unique.length
      ? await this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true, deptId: true },
        })
      : []
    const deptIds = [...new Set(users.map((item) => item.deptId).filter((id): id is string => !!id))]
    const depts = deptIds.length
      ? await this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : []
    const deptMap = new Map(depts.map((item) => [item.id, item.name]))
    return new Map(users.map((item) => [item.id, {
      name: item.name,
      deptId: item.deptId,
      deptName: item.deptId ? deptMap.get(item.deptId) ?? null : null,
    }]))
  }
}

@Injectable()
export class ContractPaymentRecordService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly dataScope: DataScopeService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, RECORD_FORM_KEY)
  }

  async page(user: AuthUser, dto: ContractPaymentPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const saved = dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
      ? await this.userViews.resolveFilters(
          user,
          dto.viewId,
          USER_VIEW_RESOURCE_TYPES.contract_payment_record,
        )
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode)
        : null,
      dto.filters?.length ? this.filterIds(user.tenantId, fields, dto.filters, 'AND') : null,
    ])
    const filteredIds = intersectIds(savedIds, adHocIds)
    const scope = await this.dataScope.directOwnerFilter(user, RECORD_READ_PERMISSION)
    const where: Prisma.ContractPaymentRecordWhereInput = {
      organizationId: user.tenantId,
      AND: [scope as Prisma.ContractPaymentRecordWhereInput],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(dto.contractId ? { contractId: dto.contractId } : {}),
      ...(dto.customerId ? { contract: { customerId: dto.customerId } } : {}),
      ...(dto.keyword
        ? {
            OR: [
              { name: { contains: dto.keyword, mode: 'insensitive' } },
              { no: { contains: dto.keyword, mode: 'insensitive' } },
              { contract: { name: { contains: dto.keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.contractPaymentRecord.findMany({
        where,
        include: {
          contract: { select: { name: true, customerId: true } },
          paymentPlan: { select: { name: true } },
        },
        orderBy: [{ createTime: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contractPaymentRecord.count({ where }),
    ])
    const [dynamic, people] = await Promise.all([
      this.fieldValues.load(user.tenantId, 'contractPaymentRecord', rows.map((row) => row.id)),
      this.people(rows.flatMap((row) => [row.owner, row.createUser, row.updateUser])),
    ])
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        no: row.no,
        contractId: row.contractId,
        contractName: row.contract.name,
        customerId: row.contract.customerId,
        paymentPlanId: row.paymentPlanId,
        paymentPlanName: row.paymentPlan?.name ?? null,
        owner: row.owner,
        ownerName: people.get(row.owner)?.name ?? null,
        departmentId: people.get(row.owner)?.deptId ?? null,
        departmentName: people.get(row.owner)?.deptName ?? null,
        recordAmount: row.recordAmount === null ? null : Number(row.recordAmount),
        recordEndTime: row.recordEndTime === null ? null : Number(row.recordEndTime),
        createUser: row.createUser,
        createUserName: people.get(row.createUser)?.name ?? null,
        updateUser: row.updateUser,
        updateUserName: people.get(row.updateUser)?.name ?? null,
        createTime: Number(row.createTime),
        updateTime: Number(row.updateTime),
        moduleFields: moduleFieldsFromCustomData(fields, dynamic.get(row.id) ?? {}),
      })),
      total,
      current,
      pageSize,
      optionMap: {},
    }
  }

  async get(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id)
    const [fields, dynamic, people] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY),
      this.fieldValues.load(user.tenantId, 'contractPaymentRecord', [id]),
      this.people([row.owner, row.createUser, row.updateUser]),
    ])
    return {
      id: row.id,
      name: row.name,
      no: row.no,
      contractId: row.contractId,
      contractName: row.contract.name,
      customerId: row.contract.customerId,
      paymentPlanId: row.paymentPlanId,
      paymentPlanName: row.paymentPlan?.name ?? null,
      owner: row.owner,
      ownerName: people.get(row.owner)?.name ?? null,
      departmentId: people.get(row.owner)?.deptId ?? null,
      departmentName: people.get(row.owner)?.deptName ?? null,
      recordAmount: row.recordAmount === null ? null : Number(row.recordAmount),
      recordEndTime: row.recordEndTime === null ? null : Number(row.recordEndTime),
      createUser: row.createUser,
      createUserName: people.get(row.createUser)?.name ?? null,
      updateUser: row.updateUser,
      updateUserName: people.get(row.updateUser)?.name ?? null,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      moduleFields: moduleFieldsFromCustomData(fields, dynamic.get(row.id) ?? {}),
      optionMap: {},
    }
  }

  async add(user: AuthUser, dto: ContractPaymentRecordAddDto) {
    await this.assertRecordInput(user, dto.contractId, dto.paymentPlanId, dto.recordAmount)
    const owner = await this.resolveOwner(user, dto.owner)
    const customData = await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    const now = BigInt(Date.now())
    const created = await this.prisma.$transaction(async (tx) => {
      const no = dto.no?.trim() || await this.nextRecordNo(tx, user.tenantId, dto.recordEndTime)
      const row = await tx.contractPaymentRecord.create({
        data: {
          name: dto.name.trim(),
          no,
          owner,
          contractId: dto.contractId,
          paymentPlanId: dto.paymentPlanId || null,
          recordAmount: new Prisma.Decimal(dto.recordAmount),
          recordEndTime: BigInt(dto.recordEndTime),
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(
        user.tenantId,
        'contractPaymentRecord',
        row.id,
        customData,
        'create',
        tx,
      )
      return row
    })
    return this.get(user, created.id)
  }

  async update(user: AuthUser, dto: ContractPaymentRecordUpdateDto) {
    const current = await this.ensureInScope(user, dto.id, 'CONTRACT_PAYMENT_RECORD:UPDATE')
    const contractId = dto.contractId ?? current.contractId
    const paymentPlanId = dto.paymentPlanId === undefined ? current.paymentPlanId : dto.paymentPlanId
    const amount = dto.recordAmount === undefined ? Number(current.recordAmount ?? 0) : dto.recordAmount
    await this.assertRecordInput(user, contractId, paymentPlanId, amount)
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : undefined
    const customData = dto.moduleFields === undefined
      ? null
      : await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    await this.prisma.$transaction(async (tx) => {
      await tx.contractPaymentRecord.update({
        where: { id: dto.id },
        data: {
          name: dto.name?.trim(),
          // Cordys update explicitly preserves the original serial number.
          no: current.no,
          owner,
          contractId: dto.contractId,
          paymentPlanId: dto.paymentPlanId === undefined ? undefined : dto.paymentPlanId || null,
          recordAmount: dto.recordAmount === undefined ? undefined : new Prisma.Decimal(dto.recordAmount),
          recordEndTime: dto.recordEndTime === undefined ? undefined : BigInt(dto.recordEndTime),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData) {
        await this.fieldValues.save(
          user.tenantId,
          'contractPaymentRecord',
          dto.id,
          customData,
          'update',
          tx,
        )
      }
    })
    return this.get(user, dto.id)
  }

  async remove(user: AuthUser, id: string) {
    const current = await this.ensureInScope(user, id, 'CONTRACT_PAYMENT_RECORD:DELETE')
    await this.prisma.contractPaymentRecord.delete({ where: { id } })
    return { id, name: current.name }
  }

  async batchUpdate(user: AuthUser, dto: ContractPaymentBatchUpdateDto) {
    const rows = await this.assertBatchInScope(user, dto.ids, 'CONTRACT_PAYMENT_RECORD:UPDATE')
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.hidden) throw new BadRequestException('字段不存在或不支持批量修改')
    if (field.system) {
      if (field.key === 'owner') {
        const owner = await this.resolveOwner(user, String(dto.fieldValue ?? ''))
        await this.prisma.contractPaymentRecord.updateMany({
          where: { id: { in: rows.map((row) => row.id) }, organizationId: user.tenantId },
          data: { owner, updateTime: BigInt(Date.now()), updateUser: user.id },
        })
      } else {
        throw new BadRequestException('该系统字段不支持批量修改')
      }
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.fieldValues.saveBatch(
          user.tenantId,
          'contractPaymentRecord',
          rows.map((row) => row.id),
          field.id,
          dto.fieldValue,
          tx,
        )
      })
    }
    return { success: rows.length, fail: 0, skip: 0 }
  }

  async tab(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, RECORD_READ_PERMISSION)
    return { all: scope.all, dept: scope.deptIds.length > 0 }
  }

  async statistic(user: AuthUser, dto: ContractPaymentPageDto) {
    const items = await this.collectExportItems(user, dto)
    return {
      count: items.length,
      recordAmount: Math.round(
        items.reduce((sum, item) => sum + Number(item.recordAmount ?? 0), 0) * 100,
      ) / 100,
    }
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, { excludeKeys: ['no'] })
    return {
      filename: `回款记录${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, { excludeKeys: ['no'] })
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
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, { excludeKeys: ['no'] })
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          const prepared = await this.prepareImportRow(user, row.values, fields, importType, row.resourceId)
          if (importType === 'ADD') await this.add(user, prepared.add)
          else {
            if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, { id: row.resourceId, ...prepared.update })
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

  exportAll(user: AuthUser, dto: ContractPaymentExportDto) {
    return this.exportXlsx(user, dto, dto.fileName, dto.headList)
  }

  exportSelected(user: AuthUser, dto: ContractPaymentExportSelectDto) {
    return this.exportXlsx(user, {}, dto.fileName, dto.headList, dto.ids)
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<ContractPaymentPageDto>,
    fileName: string,
    headList: string[],
    ids?: string[],
  ) {
    const [items, fields] = await Promise.all([
      this.collectExportItems(user, query, ids),
      this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY),
    ])
    const fieldMap = new Map(fields.filter((field) => !field.hidden).map((field) => [field.key, field]))
    const extraColumns = new Map([
      ['contractName', '合同名称'], ['paymentPlanName', '回款计划'], ['ownerName', '负责人'],
      ['departmentName', '部门'], ['createUserName', '创建人'], ['updateUserName', '更新人'],
      ['createTime', '创建时间'], ['updateTime', '更新时间'],
    ])
    const columns = headList.map((key) => {
      const field = fieldMap.get(key)
      const extra = extraColumns.get(key)
      if (!field && !extra) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extra as string) }
    })
    const rows = items.map((item) => {
      const source = paymentExportSource(fields, item as unknown as Record<string, unknown>)
      return Object.fromEntries(columns.map((column) => {
        const field = fieldMap.get(column.key)
        return [column.key, field ? formatForExport(field, source) : source[column.key] ?? '']
      }))
    })
    return this.exportTasks.create(user, { module: 'contractPaymentRecord', fileName, columns, rows })
  }

  private async collectExportItems(
    user: AuthUser,
    query: Partial<ContractPaymentPageDto>,
    ids?: string[],
  ) {
    const all: Awaited<ReturnType<ContractPaymentRecordService['page']>>['list'] = []
    let current = 1
    const pageSize = 500
    while (true) {
      const result = await this.page(user, { ...query, current, pageSize })
      all.push(...result.list)
      if (all.length >= result.total || !result.list.length) break
      current++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size) throw new BadRequestException('选中数据包含不存在或无权导出的回款记录')
    return selected
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ) {
    if (importType === 'UPDATE' && !resourceId) throw new BadRequestException('唯一ID不能为空')
    const moduleFields = fields
      .filter((field) => !field.system && values[field.key] !== undefined)
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
    const name = values['name'] === undefined ? undefined : String(values['name']).trim()
    const contractId = values['contractId'] === undefined ? undefined : String(values['contractId']).trim()
    const paymentPlanId = values['paymentPlanId'] === undefined
      ? undefined
      : String(values['paymentPlanId']).trim() || null
    const owner = values['owner'] === undefined ? undefined : String(values['owner']).trim() || undefined
    const recordAmount = importedNumber(values, 'recordAmount', '回款金额')
    const recordEndTime = importedMillis(values, 'recordEndTime', '回款时间')
    if (importType === 'ADD') {
      if (!name) throw new BadRequestException('回款记录名称不能为空')
      if (!contractId) throw new BadRequestException('合同不能为空')
      if (recordAmount === undefined) throw new BadRequestException('回款金额不能为空')
      if (recordEndTime === undefined) throw new BadRequestException('回款时间不能为空')
    }
    const common = {
      ...(name !== undefined ? { name } : {}),
      ...(contractId !== undefined ? { contractId } : {}),
      ...(paymentPlanId !== undefined ? { paymentPlanId } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(recordAmount !== undefined ? { recordAmount } : {}),
      ...(recordEndTime !== undefined ? { recordEndTime } : {}),
      ...(moduleFields.length ? { moduleFields } : {}),
    }
    return {
      add: common as ContractPaymentRecordAddDto,
      update: common as Omit<ContractPaymentRecordUpdateDto, 'id'>,
    }
  }

  private async assertRecordInput(
    user: AuthUser,
    contractId: string,
    paymentPlanId: string | null | undefined,
    amount: number,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('回款金额必须大于 0')
    await this.contracts.ensureInScope(user, contractId)
    if (paymentPlanId) {
      const plan = await this.prisma.contractPaymentPlan.findFirst({
        where: { id: paymentPlanId, organizationId: user.tenantId, contractId },
        select: { id: true },
      })
      if (!plan) throw new BadRequestException('回款计划不存在或不属于当前合同')
    }
  }

  private async ensureInScope(user: AuthUser, id: string, permission = RECORD_READ_PERMISSION) {
    const row = await this.prisma.contractPaymentRecord.findFirst({
      where: { id, organizationId: user.tenantId },
      include: {
        contract: { select: { name: true, customerId: true } },
        paymentPlan: { select: { name: true } },
      },
    })
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('回款记录不存在或不在你的数据范围内')
    }
    return row
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const unique = [...new Set(ids)]
    const rows = await this.prisma.contractPaymentRecord.findMany({
      where: { id: { in: unique }, organizationId: user.tenantId },
    })
    if (rows.length !== unique.length) throw new NotFoundException('部分回款记录不存在')
    for (const row of rows) {
      if (!(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
        throw new NotFoundException('部分回款记录不存在或不在你的数据范围内')
      }
    }
    return rows
  }

  private async filterIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ) {
    const directKeys = new Set([
      'name', 'no', 'contractId', 'paymentPlanId', 'owner', 'recordAmount', 'recordEndTime',
      'createUser', 'updateUser', 'createTime', 'updateTime',
    ])
    const fieldMap = new Map(fields.flatMap((field) => [[field.key, field], [field.id, field]]))
    const dateKeys = new Set(['recordEndTime', 'createTime', 'updateTime'])
    const numberKeys = new Set(['recordAmount'])
    const sets = await Promise.all(conditions.map(async (condition) => {
      if (condition.key === 'departmentId') {
        const users = await this.prisma.user.findMany({
          where: { tenantId: organizationId, deptId: String(condition.value ?? '') },
          select: { id: true },
        })
        const ownerIds = users.map((item) => item.id)
        const rows = await this.prisma.contractPaymentRecord.findMany({
          where: {
            organizationId,
            ...(condition.op === 'ne'
              ? { NOT: { owner: { in: ownerIds } } }
              : { owner: { in: ownerIds } }),
          },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }
      if (directKeys.has(condition.key)) {
        const clause = directFilterClause<Prisma.ContractPaymentRecordWhereInput>(
          condition.key,
          condition,
          dateKeys,
          numberKeys,
        )
        if (!clause) return new Set<string>()
        const rows = await this.prisma.contractPaymentRecord.findMany({
          where: { organizationId, AND: [clause] },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }
      const field = fieldMap.get(condition.key)
      if (!field || field.system || (isCustomFieldKey(condition.key) === false && field.hidden)) {
        return new Set<string>()
      }
      const normalized = field.key === condition.key ? condition : { ...condition, key: field.key }
      return new Set(await this.fieldValues.filterResourceIds(
        organizationId,
        'contractPaymentRecord',
        [normalized],
      ))
    }))
    if (!sets.length) return []
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [...sets.slice(1).reduce(
      (result, set) => new Set([...result].filter((id) => set.has(id))),
      sets[0]!,
    )]
  }

  private async moduleFieldsToCustomData(
    organizationId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, RECORD_FORM_KEY)
    const map = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
    const result: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`回款记录字段不存在：${item.fieldId}`)
      if (field.system) continue
      result[field.key] = item.fieldValue
    }
    return result
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    const id = ownerId || user.id
    const owner = await this.prisma.user.findFirst({
      where: { id, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner.id
  }

  private async people(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    const users = unique.length
      ? await this.prisma.user.findMany({
          where: { id: { in: unique } },
          select: { id: true, name: true, deptId: true },
        })
      : []
    const deptIds = [...new Set(users.map((item) => item.deptId).filter((id): id is string => !!id))]
    const depts = deptIds.length
      ? await this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : []
    const deptMap = new Map(depts.map((item) => [item.id, item.name]))
    return new Map(users.map((item) => [item.id, {
      name: item.name,
      deptId: item.deptId,
      deptName: item.deptId ? deptMap.get(item.deptId) ?? null : null,
    }]))
  }

  private async nextRecordNo(
    tx: Prisma.TransactionClient,
    organizationId: string,
    recordEndTime: number,
  ) {
    const date = new Date(recordEndTime)
    if (Number.isNaN(date.getTime())) throw new BadRequestException('回款时间不合法')
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const prefix = `PAY-${year}${month}-`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payment-record:${organizationId}:${year}${month}`}))`
    const latest = await tx.contractPaymentRecord.findFirst({
      where: { organizationId, no: { startsWith: prefix } },
      orderBy: { no: 'desc' },
      select: { no: true },
    })
    const current = latest?.no?.startsWith(prefix)
      ? Number.parseInt(latest.no.slice(prefix.length), 10)
      : 0
    const next = Number.isFinite(current) ? current + 1 : 1
    return `${prefix}${String(next).padStart(6, '0')}`
  }
}
