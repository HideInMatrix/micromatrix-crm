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
import { not, or } from '@prisma/orm-postgres/orm-client'
import type { PrismaClient } from '../../prisma/prisma-client.js'
import { decimalString, numericValue, tryNumericValues } from '../../prisma/numeric-value.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
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

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

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
  item: Record<string, unknown> & {
    moduleFields?: Array<{ fieldId: string; fieldValue?: unknown }>
  },
) {
  const source: Record<string, unknown> = { ...item }
  const custom = new Map(
    (item.moduleFields ?? []).map((field) => [field.fieldId, field.fieldValue]),
  )
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
    const saved =
      dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
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
      dto.filters?.length
        ? this.filterIds(user.tenantId, fields, dto.filters, dto.filterMode ?? 'AND')
        : null,
    ])
    const filteredIds = intersectIds(savedIds, adHocIds)
    let query = this.prisma.client.orm.public.ContractPaymentPlan.where({
      organizationId: user.tenantId,
    })
    const scope = await this.dataScope.directOwnerFilter(user, PLAN_READ_PERMISSION)
    const ownerScope = scope.owner
    if (ownerScope) {
      query =
        typeof ownerScope === 'string'
          ? query.where({ owner: ownerScope })
          : query.where((row) => row.owner.in(ownerScope.in))
    }
    if (filteredIds) query = query.where((row) => row.id.in(filteredIds))
    if (dto.contractId) query = query.where({ contractId: dto.contractId })
    if (dto.customerId) {
      const contracts = await this.prisma.client.orm.public.Contract.where({
        organizationId: user.tenantId,
        customerId: dto.customerId,
      })
        .select('id')
        .all()
      query = query.where((row) => row.contractId.in(contracts.map((item) => item.id)))
    }
    if (dto.keyword) {
      const contracts = await this.prisma.client.orm.public.Contract.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.name.ilike(`%${dto.keyword}%`))
        .select('id')
        .all()
      query = query.where((row) =>
        or(row.name.ilike(`%${dto.keyword}%`), row.contractId.in(contracts.map((item) => item.id))),
      )
    }
    const [rows, aggregate] = await Promise.all([
      query
        .orderBy([(row) => row.createTime.desc(), (row) => row.id.desc()])
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((value) => ({ count: value.count() })),
    ])
    const total = aggregate.count
    const contracts = rows.length
      ? await this.prisma.client.orm.public.Contract.where((row) =>
          row.id.in([...new Set(rows.map((item) => item.contractId))]),
        )
          .select('id', 'name', 'customerId')
          .all()
      : []
    const contractMap = new Map(contracts.map((item) => [String(item.id), item]))
    const [dynamic, people] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'contractPaymentPlan',
        rows.map((row) => row.id),
      ),
      this.people(rows.flatMap((row) => [row.owner, row.createUser, row.updateUser])),
    ])
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        contractId: row.contractId,
        contractName: contractMap.get(String(row.contractId))?.name ?? '已删除合同',
        customerId: contractMap.get(String(row.contractId))?.customerId ?? null,
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
    const customData = await this.moduleFieldsToCustomData(
      user.tenantId,
      PLAN_FORM_KEY,
      dto.moduleFields,
    )
    const now = BigInt(Date.now())
    const created = await this.prisma.client.transaction(async (tx) => {
      const row = await tx.orm.public.ContractPaymentPlan.create({
        id: createLegacyId32(),
        name: dto.name.trim(),
        contractId: dto.contractId,
        owner: owner,
        planStatus: dto.planStatus ?? 'PENDING',
        planAmount: numericValue(decimalString(dto.planAmount, 20, 10), 20, 10),
        planEndTime: BigInt(dto.planEndTime),
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await this.fieldValues.save(
        user.tenantId,
        'contractPaymentPlan',
        row.id,
        customData,
        'create',
        tx,
        user.id,
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
    const customData =
      dto.moduleFields === undefined
        ? null
        : await this.moduleFieldsToCustomData(user.tenantId, PLAN_FORM_KEY, dto.moduleFields)
    await this.prisma.client.transaction(async (tx) => {
      const updated = await tx.orm.public.ContractPaymentPlan.where({
        id: dto.id,
      }).update({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.contractId !== undefined ? { contractId: dto.contractId } : {}),
        ...(owner !== undefined ? { owner: owner } : {}),
        ...(dto.planStatus !== undefined ? { planStatus: dto.planStatus } : {}),
        ...(dto.planAmount !== undefined
          ? { planAmount: numericValue(decimalString(dto.planAmount, 20, 10), 20, 10) }
          : {}),
        ...(dto.planEndTime !== undefined ? { planEndTime: BigInt(dto.planEndTime) } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (!updated) throw new NotFoundException('回款计划不存在')
      if (customData) {
        await this.fieldValues.save(
          user.tenantId,
          'contractPaymentPlan',
          dto.id,
          customData,
          'update',
          tx,
          user.id,
        )
      }
    })
    return this.get(user, dto.id)
  }

  async remove(user: AuthUser, id: string) {
    const current = await this.ensureInScope(user, id, 'CONTRACT_PAYMENT_PLAN:DELETE')
    await this.prisma.client.orm.public.ContractPaymentPlan.where({
      id: id,
      organizationId: user.tenantId,
    }).delete()
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
        await this.prisma.client.orm.public.ContractPaymentPlan.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(rows.map((item) => item.id)))
          .updateAndCount({
            owner: owner,
            updateTime: BigInt(Date.now()),
            updateUser: user.id,
          })
      } else if (field.key === 'planStatus') {
        const status = String(dto.fieldValue ?? '')
        if (!PLAN_STATUSES.has(status)) throw new BadRequestException('回款计划状态不合法')
        await this.prisma.client.orm.public.ContractPaymentPlan.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(rows.map((item) => item.id)))
          .updateAndCount({
            planStatus: status,
            updateTime: BigInt(Date.now()),
            updateUser: user.id,
          })
      } else {
        throw new BadRequestException('该系统字段不支持批量修改')
      }
    } else {
      await this.prisma.client.transaction(async (tx) => {
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
      planAmount:
        Math.round(items.reduce((sum, item) => sum + Number(item.planAmount ?? 0), 0) * 100) / 100,
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

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
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
          const prepared = await this.prepareImportRow(
            user,
            row.values,
            fields,
            importType,
            row.resourceId,
          )
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
    return this.exportTasks.enqueue(user, {
      module: 'contractPaymentPlan',
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
      payload.query as Partial<ContractPaymentPageDto>,
      input.headList,
      input.ids,
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<ContractPaymentPageDto>,
    headList: string[],
    ids?: string[],
  ): Promise<ExportBuildResult> {
    const [items, fields] = await Promise.all([
      this.collectExportItems(user, query, ids),
      this.moduleForms.listFields(user.tenantId, PLAN_FORM_KEY),
    ])
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['planStatus', '状态'],
      ['contractName', '合同名称'],
      ['ownerName', '负责人'],
      ['departmentName', '部门'],
      ['createUserName', '创建人'],
      ['updateUserName', '更新人'],
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
    ])
    const columns = headList.map((key) => {
      const field = fieldMap.get(key)
      const extra = extraColumns.get(key)
      if (!field && !extra) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extra as string) }
    })
    const rows = items.map((item) => {
      const source = paymentExportSource(fields, item as unknown as Record<string, unknown>)
      return Object.fromEntries(
        columns.map((column) => {
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
    if (selected.length !== wanted.size)
      throw new BadRequestException('选中数据包含不存在或无权导出的回款计划')
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
    const contractId =
      values['contractId'] === undefined ? undefined : String(values['contractId']).trim()
    const owner =
      values['owner'] === undefined ? undefined : String(values['owner']).trim() || undefined
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
    const row = await this.prisma.client.orm.public.ContractPaymentPlan.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('回款计划不存在或不在你的数据范围内')
    }
    const contract = await this.prisma.client.orm.public.Contract.where({
      id: row.contractId,
      organizationId: user.tenantId,
    })
      .select('name', 'customerId')
      .first()
    if (!contract) throw new NotFoundException('回款计划关联合同不存在')
    return { ...row, contract }
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const unique = [...new Set(ids)]
    const rows = unique.length
      ? await this.prisma.client.orm.public.ContractPaymentPlan.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(unique))
          .all()
      : []
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
      'name',
      'contractId',
      'owner',
      'planStatus',
      'planAmount',
      'planEndTime',
      'createUser',
      'updateUser',
      'createTime',
      'updateTime',
    ])
    return this.filterPlanResourceIds(organizationId, fields, conditions, mode, directKeys)
  }

  private async filterPlanResourceIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
    directKeys: Set<string>,
  ) {
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.key, field],
        [field.id, field],
      ]),
    )
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key === 'departmentId') {
          const users = await this.prisma.client.orm.public.Users.where({
            tenantId: organizationId,
            deptId: String(condition.value ?? ''),
          })
            .select('id')
            .all()
          const ownerIds = users.map((item) => String(item.id))
          let query = this.prisma.client.orm.public.ContractPaymentPlan.where({
            organizationId: organizationId,
          })
          query =
            condition.op === 'ne'
              ? query.where((row) => not(row.owner.in(ownerIds)))
              : query.where((row) => row.owner.in(ownerIds))
          const rows = await query.select('id').all()
          return new Set(rows.map((row) => row.id))
        }
        if (directKeys.has(condition.key)) {
          let query = this.prisma.client.orm.public.ContractPaymentPlan.where({
            organizationId: organizationId,
          })
          query = this.applyPlanDirectFilter(query, condition.key, condition)
          const rows = await query.select('id').all()
          return new Set(rows.map((row) => row.id))
        }
        const field = fieldMap.get(condition.key)
        if (!field || field.system || (isCustomFieldKey(condition.key) === false && field.hidden)) {
          return new Set<string>()
        }
        const normalized =
          field.key === condition.key ? condition : { ...condition, key: field.key }
        return new Set(
          await this.fieldValues.filterResourceIds(organizationId, 'contractPaymentPlan', [
            normalized,
          ]),
        )
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

  private applyPlanDirectFilter(
    collection: ReturnType<typeof this.prisma.client.orm.public.ContractPaymentPlan.where>,
    key: string,
    condition: FilterCondition,
  ) {
    const impossible = () => collection.where((row) => row.id.eq(''))

    if (key === 'planAmount') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.planAmount.isNull())
      if (condition.op === 'notEmpty') return collection.where((row) => row.planAmount.isNotNull())
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values = tryNumericValues(rawValues, 20, 10)
      if (!values) return impossible()
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.planAmount.eq(value)
        if (condition.op === 'ne') return row.planAmount.neq(value)
        if (condition.op === 'in') return row.planAmount.in(values)
        if (condition.op === 'notIn') return not(row.planAmount.in(values))
        if (condition.op === 'gt') return row.planAmount.gt(value)
        if (condition.op === 'gte') return row.planAmount.gte(value)
        if (condition.op === 'lt') return row.planAmount.lt(value)
        if (condition.op === 'lte') return row.planAmount.lte(value)
        return row.id.eq('')
      })
    }

    if (key === 'planEndTime' || key === 'createTime' || key === 'updateTime') {
      if (condition.op === 'isEmpty') {
        return key === 'planEndTime'
          ? collection.where((row) => row.planEndTime.isNull())
          : impossible()
      }
      if (condition.op === 'notEmpty') {
        return key === 'planEndTime'
          ? collection.where((row) => row.planEndTime.isNotNull())
          : collection
      }
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values: bigint[] = []
      for (const raw of rawValues) {
        const direct = Number(raw)
        const millis =
          Number.isFinite(direct) && String(raw ?? '').trim() !== ''
            ? direct
            : new Date(String(raw)).getTime()
        if (!Number.isFinite(millis)) return impossible()
        values.push(BigInt(Math.trunc(millis)))
      }
      const value = values[0]!
      if (key === 'planEndTime') {
        return collection.where((row) => {
          if (condition.op === 'eq') return row.planEndTime.eq(value)
          if (condition.op === 'ne') return row.planEndTime.neq(value)
          if (condition.op === 'in') return row.planEndTime.in(values)
          if (condition.op === 'notIn') return not(row.planEndTime.in(values))
          if (condition.op === 'gt') return row.planEndTime.gt(value)
          if (condition.op === 'gte') return row.planEndTime.gte(value)
          if (condition.op === 'lt') return row.planEndTime.lt(value)
          if (condition.op === 'lte') return row.planEndTime.lte(value)
          return row.id.eq('')
        })
      }
      return collection.where((row) => {
        const field = key === 'createTime' ? row.createTime : row.updateTime
        if (condition.op === 'eq') return field.eq(value)
        if (condition.op === 'ne') return field.neq(value)
        if (condition.op === 'in') return field.in(values)
        if (condition.op === 'notIn') return not(field.in(values))
        if (condition.op === 'gt') return field.gt(value)
        if (condition.op === 'gte') return field.gte(value)
        if (condition.op === 'lt') return field.lt(value)
        if (condition.op === 'lte') return field.lte(value)
        return row.id.eq('')
      })
    }

    if (key === 'name') {
      if (condition.op === 'isEmpty') return impossible()
      if (condition.op === 'notEmpty') return collection
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => String(item ?? ''),
      )
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.name.eq(value)
        if (condition.op === 'ne') return row.name.neq(value)
        if (condition.op === 'in') return row.name.in(values)
        if (condition.op === 'notIn') return not(row.name.in(values))
        if (condition.op === 'contains') return row.name.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains')
          return not(row.name.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq('')
      })
    }

    if (condition.op === 'isEmpty') return impossible()
    if (condition.op === 'notEmpty') return collection
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (item) => String(item ?? ''),
    )
    const value = values[0]!
    return collection.where((row) => {
      const field =
        key === 'contractId'
          ? row.contractId
          : key === 'owner'
            ? row.owner
            : key === 'planStatus'
              ? row.planStatus
              : key === 'updateUser'
                ? row.updateUser
                : row.createUser
      if (condition.op === 'eq') return field.eq(value)
      if (condition.op === 'ne') return field.neq(value)
      if (condition.op === 'in') return field.in(values)
      if (condition.op === 'notIn') return not(field.in(values))
      if (condition.op === 'contains') return field.ilike(`%${String(condition.value ?? '')}%`)
      if (condition.op === 'notContains')
        return not(field.ilike(`%${String(condition.value ?? '')}%`))
      return row.id.eq('')
    })
  }

  private async moduleFieldsToCustomData(
    organizationId: string,
    formKey: typeof PLAN_FORM_KEY | typeof RECORD_FORM_KEY,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, formKey)
    const map = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
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
    const owner = await this.prisma.client.orm.public.Users.where({
      id,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner.id
  }

  private async people(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    const users = unique.length
      ? await this.prisma.client.orm.public.Users.where((row) => row.id.in(unique))
          .select('id', 'name', 'deptId')
          .all()
      : []
    const deptIds = [
      ...new Set(users.flatMap((item) => (item.deptId ? [String(item.deptId)] : []))),
    ]
    const depts = deptIds.length
      ? await this.prisma.client.orm.public.Departments.where((row) => row.id.in(deptIds))
          .select('id', 'name')
          .all()
      : []
    const deptMap = new Map(depts.map((item) => [String(item.id), item.name]))
    return new Map(
      users.map((item) => [
        String(item.id),
        {
          name: item.name,
          deptId: item.deptId ? String(item.deptId) : null,
          deptName: item.deptId ? (deptMap.get(String(item.deptId)) ?? null) : null,
        },
      ]),
    )
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
    const saved =
      dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
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
      dto.filters?.length
        ? this.filterIds(user.tenantId, fields, dto.filters, dto.filterMode ?? 'AND')
        : null,
    ])
    const filteredIds = intersectIds(savedIds, adHocIds)
    let query = this.prisma.client.orm.public.ContractPaymentRecord.where({
      organizationId: user.tenantId,
    })
    const scope = await this.dataScope.directOwnerFilter(user, RECORD_READ_PERMISSION)
    const ownerScope = scope.owner
    if (ownerScope) {
      query =
        typeof ownerScope === 'string'
          ? query.where({ owner: ownerScope })
          : query.where((row) => row.owner.in(ownerScope.in))
    }
    if (filteredIds) query = query.where((row) => row.id.in(filteredIds))
    if (dto.contractId) query = query.where({ contractId: dto.contractId })
    if (dto.customerId) {
      const contracts = await this.prisma.client.orm.public.Contract.where({
        organizationId: user.tenantId,
        customerId: dto.customerId,
      })
        .select('id')
        .all()
      query = query.where((row) => row.contractId.in(contracts.map((item) => item.id)))
    }
    if (dto.keyword) {
      const contracts = await this.prisma.client.orm.public.Contract.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.name.ilike(`%${dto.keyword}%`))
        .select('id')
        .all()
      query = query.where((row) =>
        or(
          row.name.ilike(`%${dto.keyword}%`),
          row.no.ilike(`%${dto.keyword}%`),
          row.contractId.in(contracts.map((item) => item.id)),
        ),
      )
    }
    const [rows, aggregate] = await Promise.all([
      query
        .orderBy([(row) => row.createTime.desc(), (row) => row.id.desc()])
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((value) => ({ count: value.count() })),
    ])
    const total = aggregate.count
    const contractIds = [...new Set(rows.map((row) => row.contractId))]
    const paymentPlanIds = [
      ...new Set(rows.flatMap((row) => (row.paymentPlanId ? [row.paymentPlanId] : []))),
    ]
    const [contracts, paymentPlans] = await Promise.all([
      contractIds.length
        ? this.prisma.client.orm.public.Contract.where((row) => row.id.in(contractIds))
            .select('id', 'name', 'customerId')
            .all()
        : [],
      paymentPlanIds.length
        ? this.prisma.client.orm.public.ContractPaymentPlan.where((row) =>
            row.id.in(paymentPlanIds),
          )
            .select('id', 'name')
            .all()
        : [],
    ])
    const contractMap = new Map(contracts.map((item) => [String(item.id), item]))
    const paymentPlanMap = new Map(paymentPlans.map((item) => [String(item.id), item.name]))
    const [dynamic, people] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'contractPaymentRecord',
        rows.map((row) => row.id),
      ),
      this.people(rows.flatMap((row) => [row.owner, row.createUser, row.updateUser])),
    ])
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        no: row.no,
        contractId: row.contractId,
        contractName: contractMap.get(String(row.contractId))?.name ?? '已删除合同',
        customerId: contractMap.get(String(row.contractId))?.customerId ?? null,
        paymentPlanId: row.paymentPlanId,
        paymentPlanName: row.paymentPlanId
          ? (paymentPlanMap.get(String(row.paymentPlanId)) ?? null)
          : null,
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
    const created = await this.prisma.client.transaction(async (tx) => {
      const no = dto.no?.trim() || (await this.nextRecordNo(tx, user.tenantId, dto.recordEndTime))
      const row = await tx.orm.public.ContractPaymentRecord.create({
        id: createLegacyId32(),
        name: dto.name.trim(),
        no: no,
        owner: owner,
        contractId: dto.contractId,
        paymentPlanId: dto.paymentPlanId ? dto.paymentPlanId : null,
        recordAmount: numericValue(decimalString(dto.recordAmount, 20, 10), 20, 10),
        recordEndTime: BigInt(dto.recordEndTime),
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await this.fieldValues.save(
        user.tenantId,
        'contractPaymentRecord',
        row.id,
        customData,
        'create',
        tx,
        user.id,
      )
      return row
    })
    return this.get(user, created.id)
  }

  async update(user: AuthUser, dto: ContractPaymentRecordUpdateDto) {
    const current = await this.ensureInScope(user, dto.id, 'CONTRACT_PAYMENT_RECORD:UPDATE')
    const contractId = dto.contractId ?? current.contractId
    const paymentPlanId =
      dto.paymentPlanId === undefined ? current.paymentPlanId : dto.paymentPlanId
    const amount =
      dto.recordAmount === undefined ? Number(current.recordAmount ?? 0) : dto.recordAmount
    await this.assertRecordInput(user, contractId, paymentPlanId, amount)
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : undefined
    const customData =
      dto.moduleFields === undefined
        ? null
        : await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    await this.prisma.client.transaction(async (tx) => {
      const updated = await tx.orm.public.ContractPaymentRecord.where({
        id: dto.id,
      }).update({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        // Cordys update explicitly preserves the original serial number.
        no: current.no ? current.no : null,
        ...(owner !== undefined ? { owner: owner } : {}),
        ...(dto.contractId !== undefined ? { contractId: dto.contractId } : {}),
        ...(dto.paymentPlanId !== undefined
          ? {
              paymentPlanId: dto.paymentPlanId ? dto.paymentPlanId : null,
            }
          : {}),
        ...(dto.recordAmount !== undefined
          ? { recordAmount: numericValue(decimalString(dto.recordAmount, 20, 10), 20, 10) }
          : {}),
        ...(dto.recordEndTime !== undefined ? { recordEndTime: BigInt(dto.recordEndTime) } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (!updated) throw new NotFoundException('回款记录不存在')
      if (customData) {
        await this.fieldValues.save(
          user.tenantId,
          'contractPaymentRecord',
          dto.id,
          customData,
          'update',
          tx,
          user.id,
        )
      }
    })
    return this.get(user, dto.id)
  }

  async remove(user: AuthUser, id: string) {
    const current = await this.ensureInScope(user, id, 'CONTRACT_PAYMENT_RECORD:DELETE')
    await this.prisma.client.orm.public.ContractPaymentRecord.where({
      id: id,
      organizationId: user.tenantId,
    }).delete()
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
        await this.prisma.client.orm.public.ContractPaymentRecord.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(rows.map((item) => item.id)))
          .updateAndCount({
            owner: owner,
            updateTime: BigInt(Date.now()),
            updateUser: user.id,
          })
      } else {
        throw new BadRequestException('该系统字段不支持批量修改')
      }
    } else {
      await this.prisma.client.transaction(async (tx) => {
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
      recordAmount:
        Math.round(items.reduce((sum, item) => sum + Number(item.recordAmount ?? 0), 0) * 100) /
        100,
    }
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType, {
      excludeKeys: ['no'],
    })
    return {
      filename: `回款记录${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY)
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: ['no'],
    })
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
    const rows = await this.spreadsheet.parseImport(file, fields, importType, {
      excludeKeys: ['no'],
    })
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
    return this.exportTasks.enqueue(user, {
      module: 'contractPaymentRecord',
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
      payload.query as Partial<ContractPaymentPageDto>,
      input.headList,
      input.ids,
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<ContractPaymentPageDto>,
    headList: string[],
    ids?: string[],
  ): Promise<ExportBuildResult> {
    const [items, fields] = await Promise.all([
      this.collectExportItems(user, query, ids),
      this.moduleForms.listFields(user.tenantId, RECORD_FORM_KEY),
    ])
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['contractName', '合同名称'],
      ['paymentPlanName', '回款计划'],
      ['ownerName', '负责人'],
      ['departmentName', '部门'],
      ['createUserName', '创建人'],
      ['updateUserName', '更新人'],
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
    ])
    const columns = headList.map((key) => {
      const field = fieldMap.get(key)
      const extra = extraColumns.get(key)
      if (!field && !extra) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extra as string) }
    })
    const rows = items.map((item) => {
      const source = paymentExportSource(fields, item as unknown as Record<string, unknown>)
      return Object.fromEntries(
        columns.map((column) => {
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
    if (selected.length !== wanted.size)
      throw new BadRequestException('选中数据包含不存在或无权导出的回款记录')
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
    const contractId =
      values['contractId'] === undefined ? undefined : String(values['contractId']).trim()
    const paymentPlanId =
      values['paymentPlanId'] === undefined
        ? undefined
        : String(values['paymentPlanId']).trim() || null
    const owner =
      values['owner'] === undefined ? undefined : String(values['owner']).trim() || undefined
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
      const plan = await this.prisma.client.orm.public.ContractPaymentPlan.where({
        id: paymentPlanId,
        organizationId: user.tenantId,
        contractId: contractId,
      })
        .select('id')
        .first()
      if (!plan) throw new BadRequestException('回款计划不存在或不属于当前合同')
    }
  }

  private async ensureInScope(user: AuthUser, id: string, permission = RECORD_READ_PERMISSION) {
    const row = await this.prisma.client.orm.public.ContractPaymentRecord.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('回款记录不存在或不在你的数据范围内')
    }
    const [contract, paymentPlan] = await Promise.all([
      this.prisma.client.orm.public.Contract.where({
        id: row.contractId,
        organizationId: user.tenantId,
      })
        .select('name', 'customerId')
        .first(),
      row.paymentPlanId
        ? this.prisma.client.orm.public.ContractPaymentPlan.where({
            id: row.paymentPlanId,
            organizationId: user.tenantId,
          })
            .select('name')
            .first()
        : null,
    ])
    if (!contract) throw new NotFoundException('回款记录关联合同不存在')
    return { ...row, contract, paymentPlan }
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const unique = [...new Set(ids)]
    const rows = unique.length
      ? await this.prisma.client.orm.public.ContractPaymentRecord.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(unique))
          .all()
      : []
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
      'name',
      'no',
      'contractId',
      'paymentPlanId',
      'owner',
      'recordAmount',
      'recordEndTime',
      'createUser',
      'updateUser',
      'createTime',
      'updateTime',
    ])
    const fieldMap = new Map(
      fields.flatMap((field) => [
        [field.key, field],
        [field.id, field],
      ]),
    )
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key === 'departmentId') {
          const users = await this.prisma.client.orm.public.Users.where({
            tenantId: organizationId,
            deptId: String(condition.value ?? ''),
          })
            .select('id')
            .all()
          const ownerIds = users.map((item) => String(item.id))
          let query = this.prisma.client.orm.public.ContractPaymentRecord.where({
            organizationId: organizationId,
          })
          query =
            condition.op === 'ne'
              ? query.where((row) => not(row.owner.in(ownerIds)))
              : query.where((row) => row.owner.in(ownerIds))
          const rows = await query.select('id').all()
          return new Set(rows.map((row) => row.id))
        }
        if (directKeys.has(condition.key)) {
          let query = this.prisma.client.orm.public.ContractPaymentRecord.where({
            organizationId: organizationId,
          })
          query = this.applyRecordDirectFilter(query, condition.key, condition)
          const rows = await query.select('id').all()
          return new Set(rows.map((row) => row.id))
        }
        const field = fieldMap.get(condition.key)
        if (!field || field.system || (isCustomFieldKey(condition.key) === false && field.hidden)) {
          return new Set<string>()
        }
        const normalized =
          field.key === condition.key ? condition : { ...condition, key: field.key }
        return new Set(
          await this.fieldValues.filterResourceIds(organizationId, 'contractPaymentRecord', [
            normalized,
          ]),
        )
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

  private applyRecordDirectFilter(
    collection: ReturnType<typeof this.prisma.client.orm.public.ContractPaymentRecord.where>,
    key: string,
    condition: FilterCondition,
  ) {
    const impossible = () => collection.where((row) => row.id.eq(''))

    if (key === 'recordAmount') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.recordAmount.isNull())
      if (condition.op === 'notEmpty')
        return collection.where((row) => row.recordAmount.isNotNull())
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values = tryNumericValues(rawValues, 20, 10)
      if (!values) return impossible()
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.recordAmount.eq(value)
        if (condition.op === 'ne') return row.recordAmount.neq(value)
        if (condition.op === 'in') return row.recordAmount.in(values)
        if (condition.op === 'notIn') return not(row.recordAmount.in(values))
        if (condition.op === 'gt') return row.recordAmount.gt(value)
        if (condition.op === 'gte') return row.recordAmount.gte(value)
        if (condition.op === 'lt') return row.recordAmount.lt(value)
        if (condition.op === 'lte') return row.recordAmount.lte(value)
        return row.id.eq('')
      })
    }

    if (key === 'recordEndTime' || key === 'createTime' || key === 'updateTime') {
      if (condition.op === 'isEmpty') {
        return key === 'recordEndTime'
          ? collection.where((row) => row.recordEndTime.isNull())
          : impossible()
      }
      if (condition.op === 'notEmpty') {
        return key === 'recordEndTime'
          ? collection.where((row) => row.recordEndTime.isNotNull())
          : collection
      }
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values: bigint[] = []
      for (const raw of rawValues) {
        const direct = Number(raw)
        const millis =
          Number.isFinite(direct) && String(raw ?? '').trim() !== ''
            ? direct
            : new Date(String(raw)).getTime()
        if (!Number.isFinite(millis)) return impossible()
        values.push(BigInt(Math.trunc(millis)))
      }
      const value = values[0]!
      if (key === 'recordEndTime') {
        return collection.where((row) => {
          if (condition.op === 'eq') return row.recordEndTime.eq(value)
          if (condition.op === 'ne') return row.recordEndTime.neq(value)
          if (condition.op === 'in') return row.recordEndTime.in(values)
          if (condition.op === 'notIn') return not(row.recordEndTime.in(values))
          if (condition.op === 'gt') return row.recordEndTime.gt(value)
          if (condition.op === 'gte') return row.recordEndTime.gte(value)
          if (condition.op === 'lt') return row.recordEndTime.lt(value)
          if (condition.op === 'lte') return row.recordEndTime.lte(value)
          return row.id.eq('')
        })
      }
      return collection.where((row) => {
        const field = key === 'createTime' ? row.createTime : row.updateTime
        if (condition.op === 'eq') return field.eq(value)
        if (condition.op === 'ne') return field.neq(value)
        if (condition.op === 'in') return field.in(values)
        if (condition.op === 'notIn') return not(field.in(values))
        if (condition.op === 'gt') return field.gt(value)
        if (condition.op === 'gte') return field.gte(value)
        if (condition.op === 'lt') return field.lt(value)
        if (condition.op === 'lte') return field.lte(value)
        return row.id.eq('')
      })
    }

    if (key === 'name') {
      if (condition.op === 'isEmpty') return impossible()
      if (condition.op === 'notEmpty') return collection
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => String(item ?? ''),
      )
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.name.eq(value)
        if (condition.op === 'ne') return row.name.neq(value)
        if (condition.op === 'in') return row.name.in(values)
        if (condition.op === 'notIn') return not(row.name.in(values))
        if (condition.op === 'contains') return row.name.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains')
          return not(row.name.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq('')
      })
    }

    if (key === 'no') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.no.isNull())
      if (condition.op === 'notEmpty') return collection.where((row) => row.no.isNotNull())
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => String(item ?? ''),
      )
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.no.eq(value)
        if (condition.op === 'ne') return row.no.neq(value)
        if (condition.op === 'in') return row.no.in(values)
        if (condition.op === 'notIn') return not(row.no.in(values))
        if (condition.op === 'contains') return row.no.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains')
          return not(row.no.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq('')
      })
    }

    const nullable = key === 'paymentPlanId'
    if (condition.op === 'isEmpty') {
      return nullable ? collection.where((row) => row.paymentPlanId.isNull()) : impossible()
    }
    if (condition.op === 'notEmpty') {
      return nullable ? collection.where((row) => row.paymentPlanId.isNotNull()) : collection
    }
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (item) => String(item ?? ''),
    )
    const value = values[0]!
    return collection.where((row) => {
      const field =
        key === 'contractId'
          ? row.contractId
          : key === 'paymentPlanId'
            ? row.paymentPlanId
            : key === 'owner'
              ? row.owner
              : key === 'updateUser'
                ? row.updateUser
                : row.createUser
      if (condition.op === 'eq') return field.eq(value)
      if (condition.op === 'ne') return field.neq(value)
      if (condition.op === 'in') return field.in(values)
      if (condition.op === 'notIn') return not(field.in(values))
      if (condition.op === 'contains') return field.ilike(`%${String(condition.value ?? '')}%`)
      if (condition.op === 'notContains')
        return not(field.ilike(`%${String(condition.value ?? '')}%`))
      return row.id.eq('')
    })
  }

  private async moduleFieldsToCustomData(
    organizationId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, RECORD_FORM_KEY)
    const map = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
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
    const owner = await this.prisma.client.orm.public.Users.where({
      id,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner.id
  }

  private async people(ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))]
    const users = unique.length
      ? await this.prisma.client.orm.public.Users.where((row) => row.id.in(unique))
          .select('id', 'name', 'deptId')
          .all()
      : []
    const deptIds = [
      ...new Set(users.flatMap((item) => (item.deptId ? [String(item.deptId)] : []))),
    ]
    const depts = deptIds.length
      ? await this.prisma.client.orm.public.Departments.where((row) => row.id.in(deptIds))
          .select('id', 'name')
          .all()
      : []
    const deptMap = new Map(depts.map((item) => [String(item.id), item.name]))
    return new Map(
      users.map((item) => [
        String(item.id),
        {
          name: item.name,
          deptId: item.deptId ? String(item.deptId) : null,
          deptName: item.deptId ? (deptMap.get(String(item.deptId)) ?? null) : null,
        },
      ]),
    )
  }

  private async nextRecordNo(tx: PrismaTransaction, organizationId: string, recordEndTime: number) {
    const date = new Date(recordEndTime)
    if (Number.isNaN(date.getTime())) throw new BadRequestException('回款时间不合法')
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const prefix = `PAY-${year}${month}-`
    const lockQuery = this.prisma.client.raw.sql`
      SELECT 1::int4 AS locked
      FROM pg_advisory_xact_lock(hashtext(${`payment-record:${organizationId}:${year}${month}`}))
    `.returnsRow({ locked: 'pg/int4@1' })
    for await (const _row of tx.query(lockQuery.build())) break
    const latestQuery = this.prisma.client.raw.sql`
      SELECT no::text AS no
      FROM contract_payment_record
      WHERE organization_id = ${organizationId}
        AND no LIKE ${`${prefix}%`}
      ORDER BY no DESC
      LIMIT 1
    `.returnsRow({ no: 'pg/text@1' })
    let latestNo: string | null = null
    for await (const row of tx.query(latestQuery.build())) {
      latestNo = row.no
      break
    }
    const current = latestNo?.startsWith(prefix)
      ? Number.parseInt(latestNo.slice(prefix.length), 10)
      : 0
    const next = Number.isFinite(current) ? current + 1 : 1
    return `${prefix}${String(next).padStart(6, '0')}`
  }
}
