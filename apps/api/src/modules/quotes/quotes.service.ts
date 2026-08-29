import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  FieldVO,
  FilterCondition,
  QuoteVO,
  QuotationModuleFieldValue,
  QuotationProductVO,
} from '@micromatrix/shared'
import { isCustomFieldKey } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { ApprovalsService } from '../approvals/approvals.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import type {
  QuotationAddDto,
  QuotationApproveDto,
  QuotationBatchApproveDto,
  QuotationBatchUpdateDto,
  QuotationPageDto,
  QuotationUpdateDto,
} from './dto/quotation.dto'
import { QuotationFieldsService } from './quotation-fields.service'

const FORM_KEY = 'quote'
const READ_PERMISSION = 'menu:quote'

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvals: ApprovalsService,
    private readonly dataScope: DataScopeService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly quotationFields: QuotationFieldsService,
    private readonly userViews: UserViewsService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, FORM_KEY)
  }

  async list(user: AuthUser, dto: QuotationPageDto): Promise<{
    list: QuoteVO[]
    total: number
    current: number
    pageSize: number
  }> {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const saved = dto.viewId
      ? await this.userViews.resolveFilters(user, dto.viewId, USER_VIEW_RESOURCE_TYPES.quote)
      : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode)
        : null,
      dto.filters?.length ? this.filterIds(user.tenantId, fields, dto.filters, 'AND') : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    const where: Prisma.OpportunityQuotationWhereInput = {
      organizationId: user.tenantId,
      ...(await this.dataScope.directCreatorFilter(user, READ_PERMISSION)),
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(dto.opportunityId ? { opportunityId: dto.opportunityId } : {}),
      ...(dto.keyword
        ? {
            OR: [
              { name: { contains: dto.keyword, mode: 'insensitive' } },
              { opportunity: { name: { contains: dto.keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.opportunityQuotation.findMany({
        where,
        include: { opportunity: { select: { name: true } } },
        orderBy: [{ updateTime: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opportunityQuotation.count({ where }),
    ])
    const [dynamic, products] = await Promise.all([
      this.fieldValues.load(user.tenantId, 'quotation', rows.map((row) => row.id)),
      this.quotationFields.loadProductsBatch(user.tenantId, rows.map((row) => row.id)),
    ])
    return {
      list: rows.map((row) =>
        this.toVO(row, row.opportunity.name, fields, dynamic.get(row.id) ?? {}, products.get(row.id) ?? []),
      ),
      total,
      current,
      pageSize,
    }
  }

  async create(user: AuthUser, dto: QuotationAddDto): Promise<QuoteVO> {
    await this.assertOpportunity(user.tenantId, dto.opportunityId)
    await this.assertNameUnique(user.tenantId, dto.name)
    const customData = await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    const now = BigInt(Date.now())
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.opportunityQuotation.create({
        data: {
          name: dto.name.trim(),
          opportunityId: dto.opportunityId,
          untilTime: BigInt(dto.untilTime),
          amount: new Prisma.Decimal(dto.amount ?? 0),
          approvalStatus: 'NONE',
          invalid: false,
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
          approved: false,
        },
      })
      await this.fieldValues.save(user.tenantId, 'quotation', row.id, customData, 'create', tx)
      await this.quotationFields.saveProducts(user.tenantId, row.id, dto.products ?? [], tx)
      await this.writeSnapshot(tx, row.id, dto.moduleFormConfigDTO, {
        id: row.id,
        name: row.name,
        opportunityId: row.opportunityId,
        untilTime: Number(row.untilTime),
        amount: Number(row.amount),
        approvalStatus: row.approvalStatus,
        invalid: row.invalid,
        approved: row.approved,
        moduleFields: dto.moduleFields,
        products: dto.products ?? [],
      })
      return row
    })
    if (await this.approvals.flowRequired(user.tenantId, 'quote', Number(created.amount), 'CREATE')) {
      await this.approvals.submit(user, 'quote', created.id, 'CREATE')
    }
    return this.get(user, created.id)
  }

  async update(user: AuthUser, dto: QuotationUpdateDto): Promise<QuoteVO> {
    const current = await this.ensureWritable(user, dto.id)
    if (dto.opportunityId) await this.assertOpportunity(user.tenantId, dto.opportunityId)
    if (dto.name && dto.name.trim() !== current.name) await this.assertNameUnique(user.tenantId, dto.name, dto.id)
    const customData = dto.moduleFields === undefined
      ? undefined
      : await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    const config = dto.moduleFormConfigDTO ?? (await this.moduleForms.getConfig(user.tenantId, FORM_KEY))
    // Cordys: 从未审批通过过的报价，编辑仍按 CREATE 时机；历史审批通过后才按 UPDATE 时机。
    const executeTiming = current.approved ? 'UPDATE' as const : 'CREATE' as const
    const nextAmount = dto.amount === undefined ? Number(current.amount) : dto.amount
    const approvalRequired = await this.approvals.flowRequired(
      user.tenantId,
      'quote',
      nextAmount,
      executeTiming,
    )
    const businessSnapshot =
      approvalRequired && executeTiming === 'UPDATE'
        ? await this.approvals.captureBusinessSnapshot(user, 'quote', dto.id)
        : null
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.opportunityQuotation.update({
        where: { id: dto.id },
        data: {
          name: dto.name?.trim(),
          opportunityId: dto.opportunityId,
          untilTime: dto.untilTime === undefined ? undefined : BigInt(dto.untilTime),
          amount: dto.amount === undefined ? undefined : new Prisma.Decimal(dto.amount),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData !== undefined) await this.fieldValues.save(user.tenantId, 'quotation', dto.id, customData, 'update', tx)
      if (dto.products !== undefined) await this.quotationFields.saveProducts(user.tenantId, dto.id, dto.products, tx)
      await tx.opportunityQuotationSnapshot.deleteMany({ where: { quotationId: dto.id } })
      await this.writeSnapshot(tx, dto.id, config, {
        id: row.id,
        name: row.name,
        opportunityId: row.opportunityId,
        untilTime: Number(row.untilTime),
        amount: Number(row.amount),
        approvalStatus: row.approvalStatus,
        invalid: row.invalid,
        approved: row.approved,
        moduleFields: dto.moduleFields ?? [],
        products: dto.products ?? [],
      })
    })
    if (approvalRequired) {
      await this.approvals.submit(user, 'quote', dto.id, executeTiming, businessSnapshot)
    }
    return this.get(user, dto.id)
  }

  async get(user: AuthUser, id: string): Promise<QuoteVO> {
    const row = await this.prisma.opportunityQuotation.findFirst({
      where: { id, organizationId: user.tenantId },
      include: { opportunity: { select: { name: true } } },
    })
    if (!row) throw new NotFoundException('报价不存在')
    if (!(await this.dataScope.matchesDirectCreator(user, row.createUser, READ_PERMISSION))) {
      throw new NotFoundException('报价不存在')
    }
    const [fields, dynamic, products] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, FORM_KEY),
      this.fieldValues.load(user.tenantId, 'quotation', [id]),
      this.quotationFields.loadProducts(user.tenantId, id),
    ])
    return this.toVO(row, row.opportunity.name, fields, dynamic.get(id) ?? {}, products)
  }

  async getSnapshot(user: AuthUser, id: string) {
    const current = await this.get(user, id)
    const snapshot = await this.prisma.opportunityQuotationSnapshot.findFirst({
      where: { quotationId: id },
      orderBy: { id: 'desc' },
    })
    if (!snapshot?.quotationValue) return current
    const value = this.parseObject(snapshot.quotationValue)
    return {
      ...value,
      approvalStatus: current.approvalStatus,
      approved: current.approved,
      invalid: current.invalid,
    }
  }

  async getSnapshotForm(user: AuthUser, id: string) {
    await this.get(user, id)
    const snapshot = await this.prisma.opportunityQuotationSnapshot.findFirst({
      where: { quotationId: id },
      orderBy: { id: 'desc' },
    })
    if (snapshot?.quotationProp) return this.parseObject(snapshot.quotationProp)
    return this.moduleForms.getConfig(user.tenantId, FORM_KEY)
  }

  async batchUpdate(user: AuthUser, dto: QuotationBatchUpdateDto) {
    const ids = [...new Set(dto.ids)]
    const rows = await this.prisma.opportunityQuotation.findMany({
      where: { id: { in: ids }, organizationId: user.tenantId },
      select: { id: true, createUser: true },
    })
    const allowed: string[] = []
    for (const row of rows) {
      if (await this.dataScope.matchesDirectCreator(user, row.createUser, 'quote:update')) allowed.push(row.id)
    }
    if (!allowed.length) return { count: 0 }
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.hidden || field.key === 'products') throw new BadRequestException('字段不存在或不支持批量编辑')
    const now = BigInt(Date.now())
    if (field.system) {
      const data: Prisma.OpportunityQuotationUncheckedUpdateManyInput = {
        updateTime: now,
        updateUser: user.id,
      }
      if (field.key === 'name') data.name = String(dto.fieldValue ?? '').trim()
      else if (field.key === 'opportunityId') {
        const opportunityId = String(dto.fieldValue ?? '')
        await this.assertOpportunity(user.tenantId, opportunityId)
        data.opportunityId = opportunityId
      } else if (field.key === 'untilTime') data.untilTime = BigInt(Number(dto.fieldValue))
      else if (field.key === 'amount') data.amount = new Prisma.Decimal(Number(dto.fieldValue ?? 0))
      else throw new BadRequestException('该系统字段不支持批量编辑')
      await this.prisma.opportunityQuotation.updateMany({ where: { id: { in: allowed } }, data })
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.fieldValues.saveBatch(user.tenantId, 'quotation', allowed, field.id, dto.fieldValue, tx)
        await tx.opportunityQuotation.updateMany({
          where: { id: { in: allowed } },
          data: { updateTime: now, updateUser: user.id },
        })
      })
    }
    await Promise.all(allowed.map((id) => this.refreshSnapshot(user, id)))
    return { count: allowed.length }
  }

  async revoke(user: AuthUser, id: string) {
    await this.get(user, id)
    await this.approvals.cancelTarget(user, 'quote', id)
    return id
  }

  async approve(user: AuthUser, dto: QuotationApproveDto) {
    await this.get(user, dto.id)
    await this.approvals.handleTargetApproval(user, 'quote', dto.id, dto.approvalStatus)
    return dto.id
  }

  async batchApprove(user: AuthUser, dto: QuotationBatchApproveDto) {
    let success = 0
    let fail = 0
    let skip = 0
    for (const id of [...new Set(dto.ids)]) {
      const row = await this.prisma.opportunityQuotation.findFirst({
        where: { id, organizationId: user.tenantId },
        select: { approvalStatus: true },
      })
      if (!row || row.approvalStatus !== 'APPROVING') {
        skip++
        continue
      }
      try {
        await this.approvals.handleTargetApproval(user, 'quote', id, dto.approvalStatus)
        success++
      } catch {
        fail++
      }
    }
    return { success, fail, skip }
  }

  async setInvalid(user: AuthUser, id: string, invalid = true) {
    const row = await this.ensureWritable(user, id)
    if (row.invalid === invalid) return this.get(user, id)
    await this.prisma.opportunityQuotation.update({
      where: { id },
      data: { invalid, updateUser: user.id, updateTime: BigInt(Date.now()) },
    })
    await this.refreshSnapshot(user, id)
    return this.get(user, id)
  }

  async batchVoid(user: AuthUser, ids: string[]) {
    const uniqueIds = [...new Set(ids)]
    let success = 0
    let fail = 0
    let skip = 0
    for (const id of uniqueIds) {
      try {
        const row = await this.ensureWritable(user, id)
        if (row.invalid) {
          skip++
          continue
        }
        await this.prisma.opportunityQuotation.update({
          where: { id },
          data: { invalid: true, updateUser: user.id, updateTime: BigInt(Date.now()) },
        })
        await this.refreshSnapshot(user, id)
        success++
      } catch {
        fail++
      }
    }
    return {
      success,
      fail,
      skip,
      errorMessages: fail ? '部分报价已关联合同、无操作权限或不存在，无法作废' : undefined,
    }
  }

  async tab(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, READ_PERMISSION)
    return { all: scope.all, dept: !scope.all && scope.deptIds.length > 0 }
  }

  async download(user: AuthUser, id: string) {
    const quotation = await this.get(user, id)
    return { id: quotation.id, name: quotation.name }
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensureWritable(user, id)
    if (await this.approvals.flowRequired(user.tenantId, 'quote', Number(row.amount), 'DELETE')) {
      const approval = await this.approvals.submit(user, 'quote', id, 'DELETE')
      return { id, name: row.name, approvalId: approval.id, pendingApproval: true }
    }
    await this.prisma.opportunityQuotation.delete({ where: { id } })
    return { id, name: row.name, pendingApproval: false }
  }

  async refreshSnapshot(user: AuthUser, id: string) {
    const current = await this.get(user, id)
    const config = await this.moduleForms.getConfig(user.tenantId, FORM_KEY)
    await this.prisma.$transaction(async (tx) => {
      await tx.opportunityQuotationSnapshot.deleteMany({ where: { quotationId: id } })
      await this.writeSnapshot(tx, id, config, current)
    })
  }

  private async moduleFieldsToCustomData(
    organizationId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, FORM_KEY)
    const map = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
    const result: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`报价字段不存在：${item.fieldId}`)
      if (field.system) continue
      result[field.key] = item.fieldValue
    }
    return result
  }

  private moduleFieldsFromCustomData(
    fields: FieldVO[],
    values: Record<string, unknown>,
  ): QuotationModuleFieldValue[] {
    return fields
      .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(values, field.key))
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
  }

  private async assertOpportunity(organizationId: string, opportunityId: string) {
    const exists = await this.prisma.opportunity.findFirst({
      where: { id: opportunityId, organizationId },
      select: { id: true },
    })
    if (!exists) throw new BadRequestException('商机不存在')
  }

  private async assertNameUnique(organizationId: string, name: string, excludeId?: string) {
    const exists = await this.prisma.opportunityQuotation.findFirst({
      where: {
        organizationId,
        name: name.trim(),
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (exists) throw new BadRequestException('报价名称不能重复')
  }


  private async ensureWritable(user: AuthUser, id: string) {
    const row = await this.prisma.opportunityQuotation.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!row) throw new NotFoundException('报价不存在')
    if (!(await this.dataScope.matchesDirectCreator(user, row.createUser, 'quote:update'))) {
      throw new NotFoundException('报价不存在')
    }
    return row
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
        [field.id, field],
      ]),
    )
    const directKeys = new Set([
      'name',
      'opportunityId',
      'untilTime',
      'amount',
      'approvalStatus',
      'invalid',
      'approved',
      'createUser',
      'updateUser',
      'createTime',
      'updateTime',
      'owner',
    ])
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key === 'departmentId') {
          const deptId = String(condition.value ?? '')
          const users = await this.prisma.user.findMany({
            where: { tenantId: organizationId, deptId },
            select: { id: true },
          })
          const creatorIds = users.map((item) => item.id)
          const rows = await this.prisma.opportunityQuotation.findMany({
            where: {
              organizationId,
              ...(condition.op === 'ne'
                ? { NOT: { createUser: { in: creatorIds } } }
                : { createUser: { in: creatorIds } }),
            },
            select: { id: true },
          })
          return new Set(rows.map((row) => row.id))
        }
        const directKey = condition.key === 'owner' ? 'createUser' : condition.key
        if (directKeys.has(condition.key)) {
          const clause = this.quotationSystemFilterClause(directKey, condition)
          if (!clause) return new Set<string>()
          const rows = await this.prisma.opportunityQuotation.findMany({
            where: { organizationId, AND: [clause] },
            select: { id: true },
          })
          return new Set(rows.map((row) => row.id))
        }
        const field = fieldMap.get(condition.key)
        if (!field || field.system || isCustomFieldKey(condition.key) === false && field.hidden) {
          return new Set<string>()
        }
        const normalized = field.key === condition.key ? condition : { ...condition, key: field.key }
        return new Set(
          await this.fieldValues.filterResourceIds(organizationId, 'quotation', [normalized]),
        )
      }),
    )
    if (!sets.length) return []
    if (mode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce(
          (result, set) => new Set([...result].filter((id) => set.has(id))),
          sets[0]!,
        ),
    ]
  }

  private quotationSystemFilterClause(
    key: string,
    condition: FilterCondition,
  ): Prisma.OpportunityQuotationWhereInput | null {
    const dateKeys = new Set(['untilTime', 'createTime', 'updateTime'])
    const numberKeys = new Set(['amount'])
    const boolKeys = new Set(['invalid', 'approved'])
    let rawValue: unknown = condition.value
    if (dateKeys.has(key)) {
      const direct = Number(condition.value)
      const millis = Number.isFinite(direct) && String(condition.value ?? '').trim() !== ''
        ? direct
        : new Date(String(condition.value)).getTime()
      if (!Number.isFinite(millis)) return null
      rawValue = BigInt(Math.trunc(millis))
    } else if (numberKeys.has(key)) {
      const number = Number(condition.value)
      if (!Number.isFinite(number)) return null
      rawValue = number
    } else if (boolKeys.has(key)) {
      rawValue = condition.value === true || String(condition.value).toLowerCase() === 'true'
    }
    const value = rawValue as never
    const fieldKey = key as keyof Prisma.OpportunityQuotationWhereInput
    if (condition.op === 'eq') {
      return { [fieldKey]: { equals: value } } as Prisma.OpportunityQuotationWhereInput
    }
    if (condition.op === 'ne') {
      return { NOT: { [fieldKey]: { equals: value } } } as Prisma.OpportunityQuotationWhereInput
    }
    if (condition.op === 'contains') {
      if (dateKeys.has(key) || numberKeys.has(key) || boolKeys.has(key)) return null
      return {
        [fieldKey]: { contains: String(condition.value ?? ''), mode: 'insensitive' },
      } as Prisma.OpportunityQuotationWhereInput
    }
    if (condition.op === 'gt') return { [fieldKey]: { gt: value } } as Prisma.OpportunityQuotationWhereInput
    if (condition.op === 'gte') return { [fieldKey]: { gte: value } } as Prisma.OpportunityQuotationWhereInput
    if (condition.op === 'lt') return { [fieldKey]: { lt: value } } as Prisma.OpportunityQuotationWhereInput
    if (condition.op === 'lte') return { [fieldKey]: { lte: value } } as Prisma.OpportunityQuotationWhereInput
    if (condition.op === 'isEmpty') return { [fieldKey]: null } as Prisma.OpportunityQuotationWhereInput
    if (condition.op === 'notEmpty') {
      return { NOT: { [fieldKey]: null } } as Prisma.OpportunityQuotationWhereInput
    }
    return null
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async writeSnapshot(
    tx: Prisma.TransactionClient,
    quotationId: string,
    formConfig: unknown,
    value: unknown,
  ) {
    await tx.opportunityQuotationSnapshot.create({
      data: {
        quotationId,
        quotationProp: JSON.stringify(formConfig ?? {}),
        quotationValue: JSON.stringify(value ?? {}),
      },
    })
  }

  private toVO(
    row: {
      id: string
      name: string
      opportunityId: string
      amount: Prisma.Decimal
      approvalStatus: string
      invalid: boolean
      untilTime: bigint
      organizationId: string
      createTime: bigint
      updateTime: bigint
      createUser: string
      updateUser: string
      approved: boolean
    },
    opportunityName: string,
    fields: FieldVO[],
    dynamic: Record<string, unknown>,
    products: QuotationProductVO[],
  ): QuoteVO {
    return {
      id: row.id,
      name: row.name,
      opportunityId: row.opportunityId,
      opportunityName,
      amount: Number(row.amount),
      approvalStatus: row.approvalStatus as QuoteVO['approvalStatus'],
      invalid: row.invalid,
      untilTime: Number(row.untilTime),
      createUser: row.createUser,
      updateUser: row.updateUser,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      moduleFields: this.moduleFieldsFromCustomData(fields, dynamic),
      products,
      approved: row.approved,
    }
  }

  private parseObject(value: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
}
