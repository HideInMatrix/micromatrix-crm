import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type ImportResultVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { formatForExport } from '../../common/export-format'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { DataScopeService } from '../../common/services/data-scope.service'
import { ContractsService } from './contracts.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { UserViewsService } from '../user-views/user-views.service'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { ApprovalsService } from '../approvals/approvals.service'
import {
  ContractInvoiceAddDto,
  ContractInvoiceExportDto,
  ContractInvoiceExportSelectDto,
  ContractInvoicePageDto,
  ContractInvoiceUpdateDto,
} from './dto/contract-invoice.dto'

const FORM_KEY = 'invoice'
const READ_PERMISSION = 'CONTRACT_INVOICE:READ'

function intersectIds(left: string[] | null, right: string[] | null): string[] | null {
  if (left === null) return right
  if (right === null) return left
  const set = new Set(right)
  return left.filter((id) => set.has(id))
}

function directClause(key: string, condition: FilterCondition): Record<string, unknown> | null {
  let value: unknown = condition.value
  if (['amount', 'taxRate'].includes(key)) {
    const number = Number(condition.value)
    if (!Number.isFinite(number)) return null
    value = number
  } else if (['createTime', 'updateTime'].includes(key)) {
    const direct = Number(condition.value)
    const millis = Number.isFinite(direct) && String(condition.value ?? '').trim() !== ''
      ? direct
      : new Date(String(condition.value)).getTime()
    if (!Number.isFinite(millis)) return null
    value = BigInt(Math.trunc(millis))
  }
  const v = value as never
  if (condition.op === 'eq') return { [key]: { equals: v } }
  if (condition.op === 'ne') return { NOT: { [key]: { equals: v } } }
  if (condition.op === 'contains') return { [key]: { contains: String(value ?? ''), mode: 'insensitive' } }
  if (condition.op === 'gt') return { [key]: { gt: v } }
  if (condition.op === 'gte') return { [key]: { gte: v } }
  if (condition.op === 'lt') return { [key]: { lt: v } }
  if (condition.op === 'lte') return { [key]: { lte: v } }
  if (condition.op === 'isEmpty') return { [key]: null }
  if (condition.op === 'notEmpty') return { NOT: { [key]: null } }
  return null
}

function importNumber(values: Record<string, unknown>, key: string, label: string) {
  if (values[key] === undefined || values[key] === null || values[key] === '') return undefined
  const value = Number(values[key])
  if (!Number.isFinite(value)) throw new BadRequestException(`「${label}」格式不正确`)
  return value
}

@Injectable()
export class ContractInvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contracts: ContractsService,
    private readonly dataScope: DataScopeService,
    private readonly forms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly userViews: UserViewsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly approvals: ApprovalsService,
  ) {}

  form(user: AuthUser) {
    return this.forms.getConfig(user.tenantId, FORM_KEY)
  }

  async page(user: AuthUser, dto: ContractInvoicePageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.forms.listFields(user.tenantId, FORM_KEY)
    const saved = dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
      ? await this.userViews.resolveFilters(user, dto.viewId, USER_VIEW_RESOURCE_TYPES.invoice)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode) : null,
      dto.filters?.length ? this.filterIds(user.tenantId, fields, dto.filters, 'AND') : null,
    ])
    const filteredIds = intersectIds(savedIds, adHocIds)
    const scope = await this.dataScope.directOwnerFilter(user, READ_PERMISSION)
    const where: Prisma.ContractInvoiceWhereInput = {
      organizationId: user.tenantId,
      AND: [scope as Prisma.ContractInvoiceWhereInput],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(dto.contractId ? { contractId: dto.contractId } : {}),
      ...(dto.customerId ? { contract: { customerId: dto.customerId } } : {}),
      ...(dto.keyword ? { OR: [
        { name: { contains: dto.keyword, mode: 'insensitive' } },
        { contract: { name: { contains: dto.keyword, mode: 'insensitive' } } },
        { businessTitle: { name: { contains: dto.keyword, mode: 'insensitive' } } },
      ] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.contractInvoice.findMany({
        where,
        include: {
          contract: { select: { name: true, customerId: true, amount: true } },
          businessTitle: { select: { name: true } },
        },
        orderBy: [{ createTime: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.contractInvoice.count({ where }),
    ])
    const dynamic = await this.fieldValues.load(user.tenantId, 'invoice', rows.map((row) => row.id))
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        contractId: row.contractId,
        contractName: row.contract.name,
        customerId: row.contract.customerId,
        owner: row.owner,
        amount: row.amount === null ? null : Number(row.amount),
        invoiceType: row.invoiceType,
        taxRate: row.taxRate === null ? null : Number(row.taxRate),
        approvalStatus: row.approvalStatus,
        businessTitleId: row.businessTitleId,
        businessTitleName: row.businessTitle?.name ?? null,
        approved: row.approved,
        createTime: Number(row.createTime),
        updateTime: Number(row.updateTime),
        moduleFields: fields
          .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(dynamic.get(row.id) ?? {}, field.key))
          .map((field) => ({ fieldId: field.id, fieldValue: (dynamic.get(row.id) ?? {})[field.key] })),
      })),
      total,
      current,
      pageSize,
      optionMap: {},
    }
  }

  async get(user: AuthUser, id: string) {
    const row = await this.ensureInvoice(user, id)
    const [fields, dynamic] = await Promise.all([
      this.forms.listFields(user.tenantId, FORM_KEY),
      this.fieldValues.load(user.tenantId, 'invoice', [id]),
    ])
    const values = dynamic.get(id) ?? {}
    return {
      id: row.id,
      name: row.name,
      contractId: row.contractId,
      contractName: row.contract.name,
      customerId: row.contract.customerId,
      owner: row.owner,
      amount: row.amount === null ? null : Number(row.amount),
      invoiceType: row.invoiceType,
      taxRate: row.taxRate === null ? null : Number(row.taxRate),
      approvalStatus: row.approvalStatus,
      businessTitleId: row.businessTitleId,
      businessTitleName: row.businessTitle?.name ?? null,
      approved: row.approved,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      moduleFields: fields
        .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(values, field.key))
        .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] })),
      optionMap: {},
    }
  }

  async add(user: AuthUser, dto: ContractInvoiceAddDto) {
    await this.contracts.ensureInScope(user, dto.contractId)
    const owner = await this.resolveOwner(user, dto.owner)
    const businessTitleId = await this.resolveTitle(user, dto.businessTitleId)
    await this.assertAmount(user, dto.contractId, dto.amount)
    const customData = await this.toCustomData(user.tenantId, dto.moduleFields)
    const now = BigInt(Date.now())
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.contractInvoice.create({
        data: {
          name: dto.name.trim(),
          contractId: dto.contractId,
          owner,
          amount: new Prisma.Decimal(dto.amount),
          invoiceType: dto.invoiceType?.trim() || null,
          taxRate: new Prisma.Decimal(dto.taxRate ?? 0),
          approvalStatus: 'NONE',
          businessTitleId,
          organizationId: user.tenantId,
          approved: false,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(user.tenantId, 'invoice', created.id, customData, 'create', tx)
      return created
    })
    await this.writeSnapshot(user, row.id)
    if (await this.approvals.flowRequired(user.tenantId, 'invoice', dto.amount, 'CREATE')) {
      await this.approvals.submit(user, 'invoice', row.id, 'CREATE')
    }
    return this.get(user, row.id)
  }

  async update(user: AuthUser, dto: ContractInvoiceUpdateDto) {
    const current = await this.ensureInvoice(user, dto.id, 'CONTRACT_INVOICE:UPDATE')
    const contractId = dto.contractId ?? current.contractId
    if (dto.contractId && dto.contractId !== current.contractId) await this.contracts.ensureInScope(user, dto.contractId)
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : undefined
    const titleId = dto.businessTitleId === undefined ? undefined : await this.resolveTitle(user, dto.businessTitleId)
    const amount = dto.amount ?? Number(current.amount ?? 0)
    await this.assertAmount(user, contractId, amount, dto.id)
    const approvalRequired = await this.approvals.flowRequired(
      user.tenantId,
      'invoice',
      amount,
      'UPDATE',
    )
    const preUpdateSnapshot = approvalRequired
      ? await this.approvals.capturePreUpdateSnapshot(user, 'invoice', dto.id)
      : null
    const customData = dto.moduleFields === undefined ? null : await this.toCustomData(user.tenantId, dto.moduleFields)
    await this.prisma.$transaction(async (tx) => {
      await tx.contractInvoice.update({
        where: { id: dto.id },
        data: {
          name: dto.name?.trim(),
          contractId: dto.contractId,
          owner,
          amount: dto.amount === undefined ? undefined : new Prisma.Decimal(dto.amount),
          invoiceType: dto.invoiceType === undefined ? undefined : dto.invoiceType?.trim() || null,
          taxRate: dto.taxRate === undefined ? undefined : new Prisma.Decimal(dto.taxRate),
          businessTitleId: titleId,
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData) await this.fieldValues.save(user.tenantId, 'invoice', dto.id, customData, 'update', tx)
    })
    await this.writeSnapshot(user, dto.id)
    if (approvalRequired) {
      await this.approvals.submit(user, 'invoice', dto.id, 'UPDATE', {
        preUpdateSnapshot,
        comment: dto.comment,
      })
    }
    return this.get(user, dto.id)
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensureInvoice(user, id, 'CONTRACT_INVOICE:DELETE')
    if (['PENDING', 'APPROVING'].includes(row.approvalStatus ?? '')) {
      throw new BadRequestException('审批中的发票不能直接删除')
    }
    if (await this.approvals.flowRequired(user.tenantId, 'invoice', Number(row.amount ?? 0), 'DELETE')) {
      const approval = await this.approvals.submit(user, 'invoice', id, 'DELETE')
      return { id, name: row.name, approvalId: approval.id, pendingApproval: true }
    }
    await this.prisma.contractInvoice.delete({ where: { id } })
    return { id, name: row.name, pendingApproval: false }
  }

  async batchDelete(user: AuthUser, ids: string[]) {
    const unique = [...new Set(ids)]
    if (!unique.length) throw new BadRequestException('请选择要删除的发票')
    const rows = await this.prisma.contractInvoice.findMany({
      where: { id: { in: unique }, organizationId: user.tenantId },
    })
    if (rows.length !== unique.length) throw new NotFoundException('部分发票不存在')
    for (const row of rows) {
      if (!(await this.dataScope.matchesDirectOwner(user, row.owner, 'CONTRACT_INVOICE:DELETE'))) {
        throw new NotFoundException('部分发票不存在或不在你的数据范围内')
      }
      if (['PENDING', 'APPROVING'].includes(row.approvalStatus ?? '')) {
        throw new BadRequestException('选中数据包含审批中的发票')
      }
    }
    const directDeleteIds: string[] = []
    for (const row of rows) {
      if (await this.approvals.flowRequired(user.tenantId, 'invoice', Number(row.amount ?? 0), 'DELETE')) {
        await this.approvals.submit(user, 'invoice', row.id, 'DELETE')
      } else {
        directDeleteIds.push(row.id)
      }
    }
    if (directDeleteIds.length) {
      await this.prisma.contractInvoice.deleteMany({
        where: { id: { in: directDeleteIds }, organizationId: user.tenantId },
      })
    }
    return { success: unique.length, fail: 0, skip: 0 }
  }

  async pushApproval(user: AuthUser, id: string) {
    const row = await this.ensureInvoice(user, id, 'CONTRACT_INVOICE:UPDATE')
    return this.approvals.submit(user, 'invoice', row.id, 'CREATE')
  }

  async revokeApproval(user: AuthUser, id: string) {
    await this.ensureInvoice(user, id, 'CONTRACT_INVOICE:UPDATE')
    return this.approvals.cancelTarget(user, 'invoice', id)
  }

  async approvalSimpleDetail(user: AuthUser, id: string) {
    const invoice = await this.ensureInvoice(user, id)
    const instance = await this.approvals.instanceForTarget(user, 'invoice', id)
    return {
      resourceId: id,
      approveStatus: invoice.approvalStatus,
      approveUserList: instance?.tasks.map((task) => ({
        userId: task.approverId,
        userName: task.approverName ?? null,
        status: task.status,
        comment: task.comment ?? null,
      })) ?? [],
    }
  }

  async approvalDetail(user: AuthUser, id: string) {
    await this.ensureInvoice(user, id)
    return this.approvals.instanceForTarget(user, 'invoice', id)
  }

  async tab(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, READ_PERMISSION)
    return { all: scope.all, dept: scope.deptIds.length > 0 }
  }

  async contractStatistic(user: AuthUser, contractId: string) {
    const contract = await this.contracts.ensureInScope(user, contractId)
    const approvalEnabled = await this.approvals.moduleApprovalEnabled(user.tenantId, 'invoice')
    const aggregate = await this.prisma.contractInvoice.aggregate({
      where: {
        organizationId: user.tenantId,
        contractId,
        ...(approvalEnabled ? { approvalStatus: 'APPROVED' } : {}),
      },
      _sum: { amount: true },
    })
    const contractAmount = Number(contract.amount ?? 0)
    const invoicedAmount = Number(aggregate._sum.amount ?? 0)
    return { contractAmount, invoicedAmount, uninvoicedAmount: Math.max(0, contractAmount - invoicedAmount) }
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.forms.listFields(user.tenantId, FORM_KEY)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType)
    return { filename: `发票${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`, data }
  }

  async precheckImportXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    const fields = await this.forms.listFields(user.tenantId, FORM_KEY)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    return this.runImport(user, rows, fields, importType, false)
  }

  async importXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    const fields = await this.forms.listFields(user.tenantId, FORM_KEY)
    const rows = await this.spreadsheet.parseImport(file, fields, importType)
    return this.runImport(user, rows, fields, importType, true)
  }

  exportAll(user: AuthUser, dto: ContractInvoiceExportDto) {
    return this.exportXlsx(user, dto, dto.fileName, dto.headList)
  }

  exportSelected(user: AuthUser, dto: ContractInvoiceExportSelectDto) {
    return this.exportXlsx(user, {}, dto.fileName, dto.headList, dto.ids)
  }

  async getSnapshot(user: AuthUser, id: string) {
    await this.ensureInvoice(user, id)
    const snapshot = await this.prisma.contractInvoiceSnapshot.findFirst({
      where: { invoiceId: id },
      orderBy: { id: 'desc' },
    })
    if (!snapshot?.invoiceValue) return this.get(user, id)
    try {
      return JSON.parse(snapshot.invoiceValue)
    } catch {
      return this.get(user, id)
    }
  }

  async formSnapshot(user: AuthUser, id: string) {
    await this.ensureInvoice(user, id)
    const snapshot = await this.prisma.contractInvoiceSnapshot.findFirst({
      where: { invoiceId: id },
      orderBy: { id: 'desc' },
    })
    if (snapshot?.invoiceProp) {
      try {
        const value = JSON.parse(snapshot.invoiceProp)
        if (value && typeof value === 'object' && 'fields' in value) return value
      } catch {
        // Legacy migration snapshots are not module-form snapshots.
      }
    }
    return this.form(user)
  }

  private async ensureInvoice(user: AuthUser, id: string, permission = READ_PERMISSION) {
    const row = await this.prisma.contractInvoice.findFirst({
      where: { id, organizationId: user.tenantId },
      include: {
        contract: { select: { name: true, customerId: true, amount: true } },
        businessTitle: { select: { name: true } },
      },
    })
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('发票不存在或不在你的数据范围内')
    }
    return row
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

  private async resolveTitle(user: AuthUser, id?: string | null) {
    if (!id) return null
    const title = await this.prisma.businessTitle.findFirst({
      where: { id, organizationId: user.tenantId },
      select: { id: true },
    })
    if (!title) throw new NotFoundException('工商抬头不存在')
    return title.id
  }

  private async assertAmount(user: AuthUser, contractId: string, amount: number, excludeId?: string) {
    const contract = await this.contracts.ensureInScope(user, contractId)
    const aggregate = await this.prisma.contractInvoice.aggregate({
      where: {
        organizationId: user.tenantId,
        contractId,
        approvalStatus: { in: ['APPROVED', 'APPROVING'] },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      _sum: { amount: true },
    })
    if (Number(aggregate._sum.amount ?? 0) + amount > Number(contract.amount ?? 0) + 1e-8) {
      throw new BadRequestException('发票总金额超过合同金额')
    }
  }

  private async writeSnapshot(user: AuthUser, id: string) {
    const [form, invoice] = await Promise.all([this.form(user), this.get(user, id)])
    await this.prisma.$transaction(async (tx) => {
      await tx.contractInvoiceSnapshot.deleteMany({ where: { invoiceId: id } })
      await tx.contractInvoiceSnapshot.create({
        data: {
          invoiceId: id,
          invoiceProp: JSON.stringify(form),
          invoiceValue: JSON.stringify(invoice),
        },
      })
    })
  }

  private async runImport(
    user: AuthUser,
    rows: Array<{ rowNum: number; resourceId?: string; values: Record<string, unknown>; errors: string[] }>,
    fields: FieldVO[],
    importType: ImportType,
    persist: boolean,
  ): Promise<ImportResultVO> {
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const row of rows) {
      const errors = [...row.errors]
      if (!errors.length) {
        try {
          const prepared = this.prepareImport(row.values, fields, importType, row.resourceId)
          if (persist) {
            if (importType === 'ADD') await this.add(user, prepared.add)
            else {
              if (!row.resourceId) throw new BadRequestException('唯一ID不能为空')
              await this.update(user, { id: row.resourceId, ...prepared.update })
            }
          } else if (importType === 'ADD') {
            await this.contracts.ensureInScope(user, prepared.add.contractId)
            if (prepared.add.businessTitleId) await this.resolveTitle(user, prepared.add.businessTitleId)
            await this.assertAmount(user, prepared.add.contractId, prepared.add.amount)
          } else if (row.resourceId) {
            await this.ensureInvoice(user, row.resourceId, 'CONTRACT_INVOICE:UPDATE')
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

  private prepareImport(
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ) {
    if (importType === 'UPDATE' && !resourceId) throw new BadRequestException('唯一ID不能为空')
    const dynamic = fields
      .filter((field) => !field.system && values[field.key] !== undefined)
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
    const name = values.name === undefined ? undefined : String(values.name).trim()
    const contractId = values.contractId === undefined ? undefined : String(values.contractId).trim()
    const owner = values.owner === undefined ? undefined : String(values.owner).trim() || undefined
    const amount = importNumber(values, 'amount', '开票金额')
    const taxRate = importNumber(values, 'taxRate', '税率')
    const invoiceType = values.invoiceType === undefined ? undefined : String(values.invoiceType).trim()
    const businessTitleId = values.businessTitleId === undefined ? undefined : String(values.businessTitleId).trim() || null
    if (importType === 'ADD') {
      if (!name) throw new BadRequestException('发票名称不能为空')
      if (!contractId) throw new BadRequestException('合同不能为空')
      if (amount === undefined) throw new BadRequestException('开票金额不能为空')
    }
    const common = {
      ...(name !== undefined ? { name } : {}), ...(contractId !== undefined ? { contractId } : {}),
      ...(owner !== undefined ? { owner } : {}), ...(amount !== undefined ? { amount } : {}),
      ...(invoiceType !== undefined ? { invoiceType } : {}), ...(taxRate !== undefined ? { taxRate } : {}),
      ...(businessTitleId !== undefined ? { businessTitleId } : {}), ...(dynamic.length ? { moduleFields: dynamic } : {}),
    }
    return { add: common as ContractInvoiceAddDto, update: common as Omit<ContractInvoiceUpdateDto, 'id'> }
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<ContractInvoicePageDto>,
    fileName: string,
    headList: string[],
    ids?: string[],
  ) {
    return this.exportTasks.enqueue(user, {
      module: 'contractInvoice',
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
      payload.query as Partial<ContractInvoicePageDto>,
      input.headList,
      input.ids,
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<ContractInvoicePageDto>,
    headList: string[],
    ids?: string[],
  ): Promise<ExportBuildResult> {
    const [items, fields] = await Promise.all([
      this.collectItems(user, query, ids),
      this.forms.listFields(user.tenantId, FORM_KEY),
    ])
    const fieldMap = new Map(fields.filter((field) => !field.hidden).map((field) => [field.key, field]))
    const extras = new Map([
      ['contractName', '合同名称'], ['businessTitleName', '工商抬头'], ['approvalStatus', '审批状态'],
      ['approved', '历史审批通过'], ['createTime', '创建时间'], ['updateTime', '更新时间'],
    ])
    const columns = headList.map((key) => {
      const field = fieldMap.get(key)
      const extra = extras.get(key)
      if (!field && !extra) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (extra as string) }
    })
    const rows = items.map((item) => {
      const source: Record<string, unknown> = { ...item }
      const custom = new Map(item.moduleFields.map((field) => [field.fieldId, field.fieldValue]))
      for (const field of fields) if (!field.system) source[field.key] = custom.get(field.id)
      return Object.fromEntries(columns.map(({ key }) => {
        const field = fieldMap.get(key)
        return [key, field ? formatForExport(field, source) : source[key] ?? '']
      }))
    })
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
  }

  private async collectItems(user: AuthUser, query: Partial<ContractInvoicePageDto>, ids?: string[]) {
    const all: Awaited<ReturnType<ContractInvoiceService['page']>>['list'] = []
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
    if (selected.length !== wanted.size) throw new BadRequestException('选中数据包含不存在或无权导出的发票')
    return selected
  }

  private async filterIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    mode: 'AND' | 'OR',
  ) {
    const directKeys = new Set([
      'name', 'contractId', 'owner', 'amount', 'invoiceType', 'taxRate', 'businessTitleId',
      'approvalStatus', 'createUser', 'updateUser', 'createTime', 'updateTime',
    ])
    const fieldMap = new Map(fields.flatMap((field) => [[field.key, field], [field.id, field]]))
    const sets = await Promise.all(conditions.map(async (condition) => {
      if (condition.key === 'departmentId') {
        const users = await this.prisma.user.findMany({
          where: { tenantId: organizationId, deptId: String(condition.value ?? '') },
          select: { id: true },
        })
        const ownerIds = users.map((item) => item.id)
        const rows = await this.prisma.contractInvoice.findMany({
          where: condition.op === 'ne'
            ? { organizationId, NOT: { owner: { in: ownerIds } } }
            : { organizationId, owner: { in: ownerIds } },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }
      if (directKeys.has(condition.key)) {
        const clause = directClause(condition.key, condition)
        if (!clause) return new Set<string>()
        const rows = await this.prisma.contractInvoice.findMany({
          where: { organizationId, AND: [clause] } as Prisma.ContractInvoiceWhereInput,
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }
      const field = fieldMap.get(condition.key)
      if (!field || field.system || (!isCustomFieldKey(condition.key) && field.hidden)) return new Set<string>()
      const normalized = field.key === condition.key ? condition : { ...condition, key: field.key }
      return new Set(await this.fieldValues.filterResourceIds(organizationId, 'invoice', [normalized]))
    }))
    if (!sets.length) return []
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [...sets.slice(1).reduce(
      (result, set) => new Set([...result].filter((id) => set.has(id))),
      sets[0]!,
    )]
  }

  private async toCustomData(
    organizationId: string,
    values: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.forms.listFields(organizationId, FORM_KEY)
    const map = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
    const result: Record<string, unknown> = {}
    for (const item of values) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`字段不存在：${item.fieldId}`)
      if (!field.system) result[field.key] = item.fieldValue
    }
    return result
  }
}
