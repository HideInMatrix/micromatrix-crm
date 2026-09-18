import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type ImportResultVO,
} from '@micromatrix/shared'
import { not, or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { formatForExport } from '../../common/export-format'
import { decimalString, numericValue, tryNumericValues } from '../../prisma/numeric-value.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
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

function importNumber(values: Record<string, unknown>, key: string, label: string) {
  if (values[key] === undefined || values[key] === null || values[key] === '') return undefined
  const value = Number(values[key])
  if (!Number.isFinite(value)) throw new BadRequestException(`「${label}」格式不正确`)
  return value
}

@Injectable()
export class ContractInvoiceService {
  constructor(
    private readonly prisma8: Prisma8Service,
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
    const saved =
      dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
        ? await this.userViews.resolveFilters(user, dto.viewId, USER_VIEW_RESOURCE_TYPES.invoice)
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
    let query = this.prisma8.client.orm.public.ContractInvoice.where({
      organizationId: user.tenantId,
    })
    const scope = await this.dataScope.directOwnerFilter(user, READ_PERMISSION)
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
      const contracts = await this.prisma8.client.orm.public.Contract.where({
        organizationId: user.tenantId,
        customerId: dto.customerId,
      })
        .select('id')
        .all()
      query = query.where((row) => row.contractId.in(contracts.map((item) => item.id)))
    }
    if (dto.keyword) {
      const [contracts, titles] = await Promise.all([
        this.prisma8.client.orm.public.Contract.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.name.ilike(`%${dto.keyword}%`))
          .select('id')
          .all(),
        this.prisma8.client.orm.public.BusinessTitle.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.name.ilike(`%${dto.keyword}%`))
          .select('id')
          .all(),
      ])
      query = query.where((row) =>
        or(
          row.name.ilike(`%${dto.keyword}%`),
          row.contractId.in(contracts.map((item) => item.id)),
          row.businessTitleId.in(titles.map((item) => item.id)),
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
    const titleIds = [
      ...new Set(rows.flatMap((row) => (row.businessTitleId ? [row.businessTitleId] : []))),
    ]
    const [contracts, titles] = await Promise.all([
      contractIds.length
        ? this.prisma8.client.orm.public.Contract.where((row) => row.id.in(contractIds))
            .select('id', 'name', 'customerId', 'amount')
            .all()
        : [],
      titleIds.length
        ? this.prisma8.client.orm.public.BusinessTitle.where((row) => row.id.in(titleIds))
            .select('id', 'name')
            .all()
        : [],
    ])
    const contractMap = new Map(contracts.map((item) => [item.id, item]))
    const titleMap = new Map(titles.map((item) => [item.id, item.name]))
    const dynamic = await this.fieldValues.load(
      user.tenantId,
      'invoice',
      rows.map((row) => row.id),
    )
    return {
      list: rows.map((row) => ({
        id: row.id,
        name: row.name,
        contractId: row.contractId,
        contractName: contractMap.get(row.contractId)?.name ?? '已删除合同',
        customerId: contractMap.get(row.contractId)?.customerId ?? null,
        owner: row.owner,
        amount: row.amount === null ? null : Number(row.amount),
        invoiceType: row.invoiceType,
        taxRate: row.taxRate === null ? null : Number(row.taxRate),
        approvalStatus: row.approvalStatus,
        businessTitleId: row.businessTitleId,
        businessTitleName: row.businessTitleId ? (titleMap.get(row.businessTitleId) ?? null) : null,
        approved: row.approved,
        createTime: Number(row.createTime),
        updateTime: Number(row.updateTime),
        moduleFields: fields
          .filter(
            (field) =>
              !field.system &&
              Object.prototype.hasOwnProperty.call(dynamic.get(row.id) ?? {}, field.key),
          )
          .map((field) => ({
            fieldId: field.id,
            fieldValue: (dynamic.get(row.id) ?? {})[field.key],
          })),
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
    const row = await this.prisma8.client.transaction(async (tx) => {
      const created = await tx.orm.public.ContractInvoice.create({
        id: createLegacyId32(),
        name: dto.name.trim(),
        contractId: dto.contractId,
        owner: owner,
        amount: numericValue(decimalString(dto.amount, 20, 10), 20, 10),
        invoiceType: dto.invoiceType?.trim() ? dto.invoiceType.trim() : null,
        taxRate: numericValue(decimalString(dto.taxRate ?? 0, 20, 10), 20, 10),
        approvalStatus: 'NONE',
        businessTitleId: businessTitleId ? businessTitleId : null,
        organizationId: user.tenantId,
        approved: false,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await this.fieldValues.save(
        user.tenantId,
        'invoice',
        created.id,
        customData,
        'create',
        tx,
        user.id,
      )
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
    if (dto.contractId && dto.contractId !== current.contractId)
      await this.contracts.ensureInScope(user, dto.contractId)
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : undefined
    const titleId =
      dto.businessTitleId === undefined
        ? undefined
        : await this.resolveTitle(user, dto.businessTitleId)
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
    const customData =
      dto.moduleFields === undefined
        ? null
        : await this.toCustomData(user.tenantId, dto.moduleFields)
    await this.prisma8.client.transaction(async (tx) => {
      const updated = await tx.orm.public.ContractInvoice.where({
        id: dto.id,
      }).update({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.contractId !== undefined ? { contractId: dto.contractId } : {}),
        ...(owner !== undefined ? { owner: owner } : {}),
        ...(dto.amount !== undefined
          ? { amount: numericValue(decimalString(dto.amount, 20, 10), 20, 10) }
          : {}),
        ...(dto.invoiceType !== undefined
          ? {
              invoiceType: dto.invoiceType?.trim() ? dto.invoiceType.trim() : null,
            }
          : {}),
        ...(dto.taxRate !== undefined
          ? { taxRate: numericValue(decimalString(dto.taxRate, 20, 10), 20, 10) }
          : {}),
        ...(titleId !== undefined ? { businessTitleId: titleId ? titleId : null } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (!updated) throw new NotFoundException('发票不存在')
      if (customData)
        await this.fieldValues.save(
          user.tenantId,
          'invoice',
          dto.id,
          customData,
          'update',
          tx,
          user.id,
        )
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
    if (
      await this.approvals.flowRequired(user.tenantId, 'invoice', Number(row.amount ?? 0), 'DELETE')
    ) {
      const approval = await this.approvals.submit(user, 'invoice', id, 'DELETE')
      return { id, name: row.name, approvalId: approval.id, pendingApproval: true }
    }
    await this.prisma8.client.orm.public.ContractInvoice.where({
      id: id,
      organizationId: user.tenantId,
    }).delete()
    return { id, name: row.name, pendingApproval: false }
  }

  async batchDelete(user: AuthUser, ids: string[]) {
    const unique = [...new Set(ids)]
    if (!unique.length) throw new BadRequestException('请选择要删除的发票')
    const rows = await this.prisma8.client.orm.public.ContractInvoice.where({
      organizationId: user.tenantId,
    })
      .where((row) => row.id.in(unique))
      .all()
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
      if (
        await this.approvals.flowRequired(
          user.tenantId,
          'invoice',
          Number(row.amount ?? 0),
          'DELETE',
        )
      ) {
        await this.approvals.submit(user, 'invoice', row.id, 'DELETE')
      } else {
        directDeleteIds.push(row.id)
      }
    }
    if (directDeleteIds.length) {
      await this.prisma8.client.orm.public.ContractInvoice.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.id.in(directDeleteIds))
        .deleteAll()
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
      approveUserList:
        instance?.tasks.map((task) => ({
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
    let invoices = this.prisma8.client.orm.public.ContractInvoice.where({
      organizationId: user.tenantId,
      contractId: contractId,
    })
    if (approvalEnabled) invoices = invoices.where({ approvalStatus: 'APPROVED' })
    const aggregate = await invoices.aggregate((value) => ({ amount: value.sum('amount') }))
    const contractAmount = Number(contract.amount ?? 0)
    const invoicedAmount = Number(aggregate.amount ?? 0)
    return {
      contractAmount,
      invoicedAmount,
      uninvoicedAmount: Math.max(0, contractAmount - invoicedAmount),
    }
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.forms.listFields(user.tenantId, FORM_KEY)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType)
    return { filename: `发票${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`, data }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
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
    const snapshot = await this.prisma8.client.orm.public.ContractInvoiceSnapshot.where({
      invoiceId: id,
    })
      .orderBy((row) => row.id.desc())
      .first()
    if (!snapshot?.invoiceValue) return this.get(user, id)
    try {
      return JSON.parse(snapshot.invoiceValue)
    } catch {
      return this.get(user, id)
    }
  }

  async formSnapshot(user: AuthUser, id: string) {
    await this.ensureInvoice(user, id)
    const snapshot = await this.prisma8.client.orm.public.ContractInvoiceSnapshot.where({
      invoiceId: id,
    })
      .orderBy((row) => row.id.desc())
      .first()
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
    const row = await this.prisma8.client.orm.public.ContractInvoice.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('发票不存在或不在你的数据范围内')
    }
    const [contract, businessTitle] = await Promise.all([
      this.prisma8.client.orm.public.Contract.where({
        id: row.contractId,
        organizationId: user.tenantId,
      })
        .select('name', 'customerId', 'amount')
        .first(),
      row.businessTitleId
        ? this.prisma8.client.orm.public.BusinessTitle.where({
            id: row.businessTitleId,
            organizationId: user.tenantId,
          })
            .select('name')
            .first()
        : null,
    ])
    if (!contract) throw new NotFoundException('发票关联合同不存在')
    return { ...row, contract, businessTitle }
  }

  private async resolveOwner(user: AuthUser, ownerId?: string) {
    const id = ownerId || user.id
    const owner = await this.prisma8.client.orm.public.Users.where({
      id,
      tenantId: user.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner.id
  }

  private async resolveTitle(user: AuthUser, id?: string | null) {
    if (!id) return null
    const title = await this.prisma8.client.orm.public.BusinessTitle.where({
      id: id,
      organizationId: user.tenantId,
    })
      .select('id')
      .first()
    if (!title) throw new NotFoundException('工商抬头不存在')
    return title.id
  }

  private async assertAmount(
    user: AuthUser,
    contractId: string,
    amount: number,
    excludeId?: string,
  ) {
    const contract = await this.contracts.ensureInScope(user, contractId)
    let invoices = this.prisma8.client.orm.public.ContractInvoice.where({
      organizationId: user.tenantId,
      contractId: contractId,
    }).where((row) => row.approvalStatus.in(['APPROVED', 'APPROVING']))
    if (excludeId) invoices = invoices.where((row) => row.id.neq(excludeId))
    const aggregate = await invoices.aggregate((value) => ({ amount: value.sum('amount') }))
    if (Number(aggregate.amount ?? 0) + amount > Number(contract.amount ?? 0) + 1e-8) {
      throw new BadRequestException('发票总金额超过合同金额')
    }
  }

  private async writeSnapshot(user: AuthUser, id: string) {
    const [form, invoice] = await Promise.all([this.form(user), this.get(user, id)])
    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.ContractInvoiceSnapshot.where({
        invoiceId: id,
      }).deleteAll()
      await tx.orm.public.ContractInvoiceSnapshot.create({
        id: createLegacyId32(),
        invoiceId: id,
        invoiceProp: JSON.stringify(form),
        invoiceValue: JSON.stringify(invoice),
      })
    })
  }

  private async runImport(
    user: AuthUser,
    rows: Array<{
      rowNum: number
      resourceId?: string
      values: Record<string, unknown>
      errors: string[]
    }>,
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
            if (prepared.add.businessTitleId)
              await this.resolveTitle(user, prepared.add.businessTitleId)
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
    const contractId =
      values.contractId === undefined ? undefined : String(values.contractId).trim()
    const owner = values.owner === undefined ? undefined : String(values.owner).trim() || undefined
    const amount = importNumber(values, 'amount', '开票金额')
    const taxRate = importNumber(values, 'taxRate', '税率')
    const invoiceType =
      values.invoiceType === undefined ? undefined : String(values.invoiceType).trim()
    const businessTitleId =
      values.businessTitleId === undefined
        ? undefined
        : String(values.businessTitleId).trim() || null
    if (importType === 'ADD') {
      if (!name) throw new BadRequestException('发票名称不能为空')
      if (!contractId) throw new BadRequestException('合同不能为空')
      if (amount === undefined) throw new BadRequestException('开票金额不能为空')
    }
    const common = {
      ...(name !== undefined ? { name } : {}),
      ...(contractId !== undefined ? { contractId } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(invoiceType !== undefined ? { invoiceType } : {}),
      ...(taxRate !== undefined ? { taxRate } : {}),
      ...(businessTitleId !== undefined ? { businessTitleId } : {}),
      ...(dynamic.length ? { moduleFields: dynamic } : {}),
    }
    return {
      add: common as ContractInvoiceAddDto,
      update: common as Omit<ContractInvoiceUpdateDto, 'id'>,
    }
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
    const fieldMap = new Map(
      fields.filter((field) => !field.hidden).map((field) => [field.key, field]),
    )
    const extras = new Map([
      ['contractName', '合同名称'],
      ['businessTitleName', '工商抬头'],
      ['approvalStatus', '审批状态'],
      ['approved', '历史审批通过'],
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
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
      return Object.fromEntries(
        columns.map(({ key }) => {
          const field = fieldMap.get(key)
          return [key, field ? formatForExport(field, source) : (source[key] ?? '')]
        }),
      )
    })
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
  }

  private async collectItems(
    user: AuthUser,
    query: Partial<ContractInvoicePageDto>,
    ids?: string[],
  ) {
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
    if (selected.length !== wanted.size)
      throw new BadRequestException('选中数据包含不存在或无权导出的发票')
    return selected
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
      'amount',
      'invoiceType',
      'taxRate',
      'businessTitleId',
      'approvalStatus',
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
          const users = await this.prisma8.client.orm.public.Users.where({
            tenantId: organizationId,
            deptId: String(condition.value ?? ''),
          })
            .select('id')
            .all()
          const ownerIds = users.map((item) => String(item.id))
          let query = this.prisma8.client.orm.public.ContractInvoice.where({
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
          let query = this.prisma8.client.orm.public.ContractInvoice.where({
            organizationId: organizationId,
          })
          query = this.applyDirectFilter(query, condition.key, condition)
          const rows = await query.select('id').all()
          return new Set(rows.map((row) => row.id))
        }
        const field = fieldMap.get(condition.key)
        if (!field || field.system || (!isCustomFieldKey(condition.key) && field.hidden))
          return new Set<string>()
        const normalized =
          field.key === condition.key ? condition : { ...condition, key: field.key }
        return new Set(
          await this.fieldValues.filterResourceIds(organizationId, 'invoice', [normalized]),
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

  private applyDirectFilter(
    collection: ReturnType<typeof this.prisma8.client.orm.public.ContractInvoice.where>,
    key: string,
    condition: FilterCondition,
  ) {
    const impossible = () => collection.where((row) => row.id.eq(''))
    if (key === 'amount' || key === 'taxRate') {
      if (condition.op === 'isEmpty') {
        return collection.where((row) => (key === 'amount' ? row.amount : row.taxRate).isNull())
      }
      if (condition.op === 'notEmpty') {
        return collection.where((row) => (key === 'amount' ? row.amount : row.taxRate).isNotNull())
      }
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values = tryNumericValues(rawValues, 20, 10)
      if (!values) return impossible()
      const value = values[0]!
      return collection.where((row) => {
        const field = key === 'amount' ? row.amount : row.taxRate
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

    if (key === 'createTime' || key === 'updateTime') {
      if (condition.op === 'isEmpty') return impossible()
      if (condition.op === 'notEmpty') return collection
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

    const nullable = ['invoiceType', 'businessTitleId', 'approvalStatus'].includes(key)
    if (condition.op === 'isEmpty') {
      if (!nullable) return impossible()
      return collection.where((row) => {
        const field =
          key === 'invoiceType'
            ? row.invoiceType
            : key === 'businessTitleId'
              ? row.businessTitleId
              : row.approvalStatus
        return field.isNull()
      })
    }
    if (condition.op === 'notEmpty') {
      if (!nullable) return collection
      return collection.where((row) => {
        const field =
          key === 'invoiceType'
            ? row.invoiceType
            : key === 'businessTitleId'
              ? row.businessTitleId
              : row.approvalStatus
        return field.isNotNull()
      })
    }
    const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
    const values = rawValues.map((item) => String(item ?? ''))
    const value = values[0]!
    return collection.where((row) => {
      const field =
        key === 'contractId'
          ? row.contractId
          : key === 'owner'
            ? row.owner
            : key === 'invoiceType'
              ? row.invoiceType
              : key === 'businessTitleId'
                ? row.businessTitleId
                : key === 'approvalStatus'
                  ? row.approvalStatus
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

  private async toCustomData(
    organizationId: string,
    values: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.forms.listFields(organizationId, FORM_KEY)
    const map = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
    const result: Record<string, unknown> = {}
    for (const item of values) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`字段不存在：${item.fieldId}`)
      if (!field.system) result[field.key] = item.fieldValue
    }
    return result
  }
}
