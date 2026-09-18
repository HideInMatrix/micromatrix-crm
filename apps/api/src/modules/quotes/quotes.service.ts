import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  FieldVO,
  FilterCondition,
  QuoteVO,
  QuotationModuleFieldValue,
  QuotationProductVO,
} from '@micromatrix/shared'
import { isCustomFieldKey } from '@micromatrix/shared'
import { not, or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { createLegacyId32 } from '../../common/legacy-id'
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
type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

interface QuoteRow {
  id: string
  name: string
  opportunityId: string
  amount: unknown
  approvalStatus: string
  invalid: boolean
  untilTime: bigint
  organizationId: string
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
  approved: boolean
}

@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma8: Prisma8Service,
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

  async list(
    user: AuthUser,
    dto: QuotationPageDto,
  ): Promise<{
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
      dto.filters?.length
        ? this.filterIds(user.tenantId, fields, dto.filters, dto.filterMode ?? 'AND')
        : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    let query = this.prisma8.client.orm.public.OpportunityQuotation.where({
      organizationId: user.tenantId,
    })
    const creatorFilter = await this.dataScope.directCreatorFilter(user, READ_PERMISSION)
    const creatorScope = creatorFilter.createUser
    if (creatorScope) {
      query =
        typeof creatorScope === 'string'
          ? query.where({ createUser: creatorScope })
          : query.where((row) => row.createUser.in(creatorScope.in))
    }
    if (filteredIds) query = query.where((row) => row.id.in(filteredIds))
    if (dto.opportunityId) {
      query = query.where({ opportunityId: dto.opportunityId })
    }
    if (dto.keyword) {
      const opportunityIds = await this.prisma8.client.orm.public.Opportunity.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.name.ilike(`%${dto.keyword}%`))
        .select('id')
        .all()
      query = opportunityIds.length
        ? query.where((row) =>
            or(
              row.name.ilike(`%${dto.keyword}%`),
              row.opportunityId.in(opportunityIds.map((item) => item.id)),
            ),
          )
        : query.where((row) => row.name.ilike(`%${dto.keyword}%`))
    }
    const [rows, aggregate] = await Promise.all([
      query
        .orderBy([(row) => row.updateTime.desc(), (row) => row.id.desc()])
        .offset((current - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((value) => ({ count: value.count() })),
    ])
    const total = aggregate.count
    const opportunityIds = [...new Set(rows.map((row) => row.opportunityId))]
    const opportunities = opportunityIds.length
      ? await this.prisma8.client.orm.public.Opportunity.where((row) => row.id.in(opportunityIds))
          .select('id', 'name')
          .all()
      : []
    const opportunityMap = new Map(opportunities.map((item) => [item.id, item.name]))
    const [dynamic, products] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'quotation',
        rows.map((row) => row.id),
      ),
      this.quotationFields.loadProductsBatch(
        user.tenantId,
        rows.map((row) => row.id),
      ),
    ])
    return {
      list: rows.map((row) =>
        this.toVO(
          row,
          opportunityMap.get(row.opportunityId) ?? '已删除商机',
          fields,
          dynamic.get(row.id) ?? {},
          products.get(row.id) ?? [],
        ),
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
    const created = await this.prisma8.client.transaction(async (tx) => {
      const row = await tx.orm.public.OpportunityQuotation.create({
        id: createLegacyId32(),
        name: dto.name.trim(),
        opportunityId: dto.opportunityId,
        untilTime: BigInt(dto.untilTime),
        amount: prisma8Numeric(dto.amount ?? 0, 14, 2),
        approvalStatus: 'NONE',
        invalid: false,
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
        approved: false,
      })
      await this.fieldValues.save(
        user.tenantId,
        'quotation',
        row.id,
        customData,
        'create',
        tx,
        user.id,
      )
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
    if (
      await this.approvals.flowRequired(user.tenantId, 'quote', Number(created.amount), 'CREATE')
    ) {
      await this.approvals.submit(user, 'quote', created.id, 'CREATE')
    }
    return this.get(user, created.id)
  }

  async update(user: AuthUser, dto: QuotationUpdateDto): Promise<QuoteVO> {
    const current = await this.ensureWritable(user, dto.id)
    if (dto.opportunityId) await this.assertOpportunity(user.tenantId, dto.opportunityId)
    if (dto.name && dto.name.trim() !== current.name)
      await this.assertNameUnique(user.tenantId, dto.name, dto.id)
    const customData =
      dto.moduleFields === undefined
        ? undefined
        : await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    const config =
      dto.moduleFormConfigDTO ?? (await this.moduleForms.getConfig(user.tenantId, FORM_KEY))
    // Cordys: 从未审批通过过的报价，编辑仍按 CREATE 时机；历史审批通过后才按 UPDATE 时机。
    const executeTiming = current.approved ? ('UPDATE' as const) : ('CREATE' as const)
    const nextAmount = dto.amount === undefined ? Number(current.amount) : dto.amount
    const approvalRequired = await this.approvals.flowRequired(
      user.tenantId,
      'quote',
      nextAmount,
      executeTiming,
    )
    const preUpdateSnapshot =
      approvalRequired && executeTiming === 'UPDATE'
        ? await this.approvals.capturePreUpdateSnapshot(user, 'quote', dto.id)
        : null
    await this.prisma8.client.transaction(async (tx) => {
      const row = await tx.orm.public.OpportunityQuotation.where({
        id: dto.id,
      }).update({
        name: dto.name === undefined ? undefined : dto.name.trim(),
        opportunityId: dto.opportunityId === undefined ? undefined : dto.opportunityId,
        untilTime: dto.untilTime === undefined ? undefined : BigInt(dto.untilTime),
        amount: dto.amount === undefined ? undefined : prisma8Numeric(dto.amount, 14, 2),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (!row) throw new NotFoundException('报价不存在')
      if (customData !== undefined)
        await this.fieldValues.save(
          user.tenantId,
          'quotation',
          dto.id,
          customData,
          'update',
          tx,
          user.id,
        )
      if (dto.products !== undefined)
        await this.quotationFields.saveProducts(user.tenantId, dto.id, dto.products, tx)
      await tx.orm.public.OpportunityQuotationSnapshot.where({
        quotationId: dto.id,
      }).deleteAll()
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
      await this.approvals.submit(user, 'quote', dto.id, executeTiming, {
        preUpdateSnapshot,
        comment: dto.comment,
      })
    }
    return this.get(user, dto.id)
  }

  async get(user: AuthUser, id: string): Promise<QuoteVO> {
    const row = await this.prisma8.client.orm.public.OpportunityQuotation.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row) throw new NotFoundException('报价不存在')
    if (!(await this.dataScope.matchesDirectCreator(user, row.createUser, READ_PERMISSION))) {
      throw new NotFoundException('报价不存在')
    }
    const opportunity = await this.prisma8.client.orm.public.Opportunity.where({
      id: row.opportunityId,
      organizationId: user.tenantId,
    })
      .select('name')
      .first()
    const [fields, dynamic, products] = await Promise.all([
      this.moduleForms.listFields(user.tenantId, FORM_KEY),
      this.fieldValues.load(user.tenantId, 'quotation', [id]),
      this.quotationFields.loadProducts(user.tenantId, id),
    ])
    return this.toVO(
      row,
      opportunity?.name ?? '已删除商机',
      fields,
      dynamic.get(id) ?? {},
      products,
    )
  }

  async getSnapshot(user: AuthUser, id: string) {
    const current = await this.get(user, id)
    const snapshot = await this.prisma8.client.orm.public.OpportunityQuotationSnapshot.where({
      quotationId: id,
    })
      .orderBy((row) => row.id.desc())
      .first()
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
    const snapshot = await this.prisma8.client.orm.public.OpportunityQuotationSnapshot.where({
      quotationId: id,
    })
      .orderBy((row) => row.id.desc())
      .first()
    if (snapshot?.quotationProp) return this.parseObject(snapshot.quotationProp)
    return this.moduleForms.getConfig(user.tenantId, FORM_KEY)
  }

  async batchUpdate(user: AuthUser, dto: QuotationBatchUpdateDto) {
    const ids = [...new Set(dto.ids)]
    const rows = ids.length
      ? await this.prisma8.client.orm.public.OpportunityQuotation.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(ids))
          .select('id', 'createUser')
          .all()
      : []
    const allowed: string[] = []
    for (const row of rows) {
      if (await this.dataScope.matchesDirectCreator(user, row.createUser, 'quote:update'))
        allowed.push(row.id)
    }
    if (!allowed.length) return { count: 0 }
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.hidden || field.key === 'products')
      throw new BadRequestException('字段不存在或不支持批量编辑')
    const now = BigInt(Date.now())
    if (field.system) {
      const target = this.prisma8.client.orm.public.OpportunityQuotation.where((row) =>
        row.id.in(allowed),
      )
      if (field.key === 'name') {
        const name = String(dto.fieldValue ?? '').trim()
        if (!name) throw new BadRequestException('报价名称不能为空')
        await target.updateAndCount({
          name: name,
          updateTime: now,
          updateUser: user.id,
        })
      } else if (field.key === 'opportunityId') {
        const opportunityId = String(dto.fieldValue ?? '')
        await this.assertOpportunity(user.tenantId, opportunityId)
        await target.updateAndCount({
          opportunityId: opportunityId,
          updateTime: now,
          updateUser: user.id,
        })
      } else if (field.key === 'untilTime') {
        await target.updateAndCount({
          untilTime: BigInt(Number(dto.fieldValue)),
          updateTime: now,
          updateUser: user.id,
        })
      } else if (field.key === 'amount') {
        const amount = Number(dto.fieldValue ?? 0)
        if (!Number.isFinite(amount)) throw new BadRequestException('报价金额不合法')
        await target.updateAndCount({
          amount: prisma8Numeric(amount, 14, 2),
          updateTime: now,
          updateUser: user.id,
        })
      } else throw new BadRequestException('该系统字段不支持批量编辑')
    } else {
      await this.prisma8.client.transaction(async (tx) => {
        await this.fieldValues.saveBatch(
          user.tenantId,
          'quotation',
          allowed,
          field.id,
          dto.fieldValue,
          tx,
        )
        await tx.orm.public.OpportunityQuotation.where((row) => row.id.in(allowed)).updateAndCount({
          updateTime: now,
          updateUser: user.id,
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
      const row = await this.prisma8.client.orm.public.OpportunityQuotation.where({
        id: id,
        organizationId: user.tenantId,
      })
        .select('approvalStatus')
        .first()
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
    await this.prisma8.client.orm.public.OpportunityQuotation.where({
      id: id,
    }).update({
      invalid,
      updateUser: user.id,
      updateTime: BigInt(Date.now()),
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
        await this.prisma8.client.orm.public.OpportunityQuotation.where({
          id: id,
        }).update({
          invalid: true,
          updateUser: user.id,
          updateTime: BigInt(Date.now()),
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
    await this.prisma8.client.orm.public.OpportunityQuotation.where({
      id: id,
      organizationId: user.tenantId,
    }).delete()
    return { id, name: row.name, pendingApproval: false }
  }

  async refreshSnapshot(user: AuthUser, id: string) {
    const current = await this.get(user, id)
    const config = await this.moduleForms.getConfig(user.tenantId, FORM_KEY)
    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.OpportunityQuotationSnapshot.where({
        quotationId: id,
      }).deleteAll()
      await this.writeSnapshot(tx, id, config, current)
    })
  }

  private async moduleFieldsToCustomData(
    organizationId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, FORM_KEY)
    const map = new Map(
      fields.flatMap((field) => [
        [field.id, field],
        [field.key, field],
      ]),
    )
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
    const exists = await this.prisma8.client.orm.public.Opportunity.where({
      id: opportunityId,
      organizationId: organizationId,
    })
      .select('id')
      .first()
    if (!exists) throw new BadRequestException('商机不存在')
  }

  private async assertNameUnique(organizationId: string, name: string, excludeId?: string) {
    let query = this.prisma8.client.orm.public.OpportunityQuotation.where({
      organizationId: organizationId,
      name: name.trim(),
    })
    if (excludeId) query = query.where((row) => row.id.neq(excludeId))
    const exists = await query.select('id').first()
    if (exists) throw new BadRequestException('报价名称不能重复')
  }

  private async ensureWritable(user: AuthUser, id: string) {
    const row = await this.prisma8.client.orm.public.OpportunityQuotation.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
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
          const users = await this.prisma8.client.orm.public.Users.where({
            tenantId: organizationId,
            deptId,
          })
            .select('id')
            .all()
          const creatorIds = users.map((item) => String(item.id))
          let query = this.prisma8.client.orm.public.OpportunityQuotation.where({
            organizationId: organizationId,
          })
          query =
            condition.op === 'ne'
              ? query.where((row) => not(row.createUser.in(creatorIds)))
              : query.where((row) => row.createUser.in(creatorIds))
          const rows = await query.select('id').all()
          return new Set(rows.map((row) => row.id))
        }
        const directKey = condition.key === 'owner' ? 'createUser' : condition.key
        if (directKeys.has(condition.key)) {
          let query = this.prisma8.client.orm.public.OpportunityQuotation.where({
            organizationId: organizationId,
          })
          query = this.applyQuotationSystemFilter(query, directKey, condition)
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
          await this.fieldValues.filterResourceIds(organizationId, 'quotation', [normalized]),
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

  private applyQuotationSystemFilter(
    collection: ReturnType<typeof this.prisma8.client.orm.public.OpportunityQuotation.where>,
    key: string,
    condition: FilterCondition,
  ) {
    if (condition.op === 'isEmpty') {
      return collection.where((row) => row.id.eq(''))
    }
    if (condition.op === 'notEmpty') return collection
    const dateKeys = new Set(['untilTime', 'createTime', 'updateTime'])
    const numberKeys = new Set(['amount'])
    const boolKeys = new Set(['invalid', 'approved'])
    if (dateKeys.has(key)) {
      const direct = Number(condition.value)
      const millis =
        Number.isFinite(direct) && String(condition.value ?? '').trim() !== ''
          ? direct
          : new Date(String(condition.value)).getTime()
      if (!Number.isFinite(millis)) return collection.where((row) => row.id.eq(''))
      const value = BigInt(Math.trunc(millis))
      return collection.where((row) => {
        const field =
          key === 'untilTime'
            ? row.untilTime
            : key === 'createTime'
              ? row.createTime
              : row.updateTime
        if (condition.op === 'eq') return field.eq(value)
        if (condition.op === 'ne') return field.neq(value)
        if (condition.op === 'gt') return field.gt(value)
        if (condition.op === 'gte') return field.gte(value)
        if (condition.op === 'lt') return field.lt(value)
        if (condition.op === 'lte') return field.lte(value)
        if (condition.op === 'in' || condition.op === 'notIn') {
          const values = (Array.isArray(condition.value) ? condition.value : [condition.value])
            .map((item) => Number(item))
            .filter(Number.isFinite)
            .map((item) => BigInt(Math.trunc(item)))
          return condition.op === 'notIn' ? not(field.in(values)) : field.in(values)
        }
        return row.id.eq('')
      })
    }
    if (numberKeys.has(key)) {
      const number = Number(condition.value)
      if (!Number.isFinite(number)) return collection.where((row) => row.id.eq(''))
      const value = prisma8Numeric(number, 14, 2)
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value])
        .map((item) => Number(item))
        .filter(Number.isFinite)
        .map((item) => prisma8Numeric(item, 14, 2))
      return collection.where((row) => {
        if (condition.op === 'eq') return row.amount.eq(value)
        if (condition.op === 'ne') return row.amount.neq(value)
        if (condition.op === 'in') return row.amount.in(values)
        if (condition.op === 'notIn') return not(row.amount.in(values))
        if (condition.op === 'gt') return row.amount.gt(value)
        if (condition.op === 'gte') return row.amount.gte(value)
        if (condition.op === 'lt') return row.amount.lt(value)
        if (condition.op === 'lte') return row.amount.lte(value)
        return row.id.eq('')
      })
    }
    if (boolKeys.has(key)) {
      const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
      const values = rawValues.map((item) => item === true || String(item).toLowerCase() === 'true')
      const value = values[0] ?? false
      return collection.where((row) => {
        const field = key === 'invalid' ? row.invalid : row.approved
        if (condition.op === 'eq') return field.eq(value)
        if (condition.op === 'ne') return field.neq(value)
        if (condition.op === 'in') return field.in(values)
        if (condition.op === 'notIn') return not(field.in(values))
        return row.id.eq('')
      })
    }
    const maxLength = key === 'name' ? 255 : key === 'approvalStatus' ? 50 : 32
    const rawValues = Array.isArray(condition.value) ? condition.value : [condition.value]
    if (key === 'name') {
      const values = rawValues.map((item) => String(item ?? ''))
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
    if (key === 'approvalStatus') {
      const values = rawValues.map((item) => String(item ?? ''))
      const value = values[0]!
      return collection.where((row) => {
        if (condition.op === 'eq') return row.approvalStatus.eq(value)
        if (condition.op === 'ne') return row.approvalStatus.neq(value)
        if (condition.op === 'in') return row.approvalStatus.in(values)
        if (condition.op === 'notIn') return not(row.approvalStatus.in(values))
        if (condition.op === 'contains')
          return row.approvalStatus.ilike(`%${String(condition.value ?? '')}%`)
        if (condition.op === 'notContains')
          return not(row.approvalStatus.ilike(`%${String(condition.value ?? '')}%`))
        return row.id.eq('')
      })
    }
    void maxLength
    const values = rawValues.map((item) => String(item ?? ''))
    const value = values[0]!
    return collection.where((row) => {
      const field =
        key === 'opportunityId'
          ? row.opportunityId
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

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async writeSnapshot(
    tx: Prisma8Transaction,
    quotationId: string,
    formConfig: unknown,
    value: unknown,
  ) {
    await tx.orm.public.OpportunityQuotationSnapshot.create({
      id: createLegacyId32(),
      quotationId: quotationId,
      quotationProp: JSON.stringify(formConfig ?? {}),
      quotationValue: JSON.stringify(value ?? {}),
    })
  }

  private toVO(
    row: QuoteRow,
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
