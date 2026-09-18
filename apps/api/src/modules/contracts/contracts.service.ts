import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  isCustomFieldKey,
  type ContractVO,
  type FieldVO,
  type FilterCondition,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { generateBizCode } from '../../common/code-gen'
import { DataScopeService } from '../../common/services/data-scope.service'
import { not, or } from '@prisma/orm-postgres/orm-client'
import type { PrismaClient } from '../../prisma/prisma-client.js'
import { decimalString, numericValue, tryNumericValues } from '../../prisma/numeric-value.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { PrismaService } from '../../prisma/prisma.service.js'
import { ApprovalsService } from '../approvals/approvals.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { QuotationFieldsService } from '../quotes/quotation-fields.service'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import {
  ContractFieldsService,
  type ContractProductInput,
  type ContractProductValue,
} from './contract-fields.service'
import { ContractStageService } from './contract-stage.service'
import {
  ContractAddDto,
  ContractApprovalDto,
  ContractBatchApprovalDto,
  ContractBatchUpdateDto,
  ContractPageDto,
  ContractSortDto,
  ContractUpdateDirectDto,
  UpdateContractStageDto,
} from './dto/contract.dto'

const FORM_KEY = 'contract'
const READ_PERMISSION = 'menu:contract'
const MAX_AMOUNT = 9_999_999_999
type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]

interface ContractRow {
  id: string
  name: string
  customerId: string
  owner: string
  amount: unknown
  number: string
  approvalStatus: string
  stage: string
  startTime: bigint | null
  endTime: bigint | null
  voidReason: string | null
  organizationId: string
  pos: bigint | null
  approved: boolean
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
}

interface ContractWithRefs extends ContractRow {
  customer: { name: string }
  paymentRecords: Array<{ recordAmount: unknown }>
  contractInvoices: Array<{ amount: unknown | null; approvalStatus: string | null }>
}

@Injectable()
export class ContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly approvals: ApprovalsService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly contractFields: ContractFieldsService,
    private readonly contractStages: ContractStageService,
    private readonly quotationFields: QuotationFieldsService,
    private readonly userViews: UserViewsService,
    private readonly businessNotifications: BusinessNotificationsService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, FORM_KEY)
  }

  async page(user: AuthUser, dto: ContractPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const saved =
      dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
        ? await this.userViews.resolveFilters(user, dto.viewId, USER_VIEW_RESOURCE_TYPES.contract)
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
    let query = this.prisma.client.orm.public.Contract.where({
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
    if (dto.stage) query = query.where({ stage: dto.stage })
    if (dto.customerId) query = query.where({ customerId: dto.customerId })
    if (dto.keyword) {
      const customers = await this.prisma.client.orm.public.Customer.where({
        organizationId: user.tenantId,
      })
        .where((row) => row.name.ilike(`%${dto.keyword}%`))
        .select('id')
        .all()
      query = query.where((row) =>
        or(
          row.name.ilike(`%${dto.keyword}%`),
          row.number.ilike(`%${dto.keyword}%`),
          row.customerId.in(customers.map((item) => item.id)),
        ),
      )
    }
    const take = dto.board ? 500 : pageSize
    const skip = dto.board ? 0 : (current - 1) * pageSize
    const [rows, aggregate, stageConfigs] = await Promise.all([
      query
        .orderBy([(row) => row.stage.asc(), (row) => row.pos.asc(), (row) => row.updateTime.desc()])
        .offset(skip)
        .limit(take)
        .all(),
      query.aggregate((value) => ({ count: value.count() })),
      this.prisma.client.orm.public.ContractStageConfig.where({
        organizationId: user.tenantId,
      })
        .orderBy((row) => row.pos.asc())
        .all(),
    ])
    const total = aggregate.count
    const fullRows = await this.loadContractRefs(user.tenantId, rows)
    const [dynamic, products, ownerMap] = await Promise.all([
      this.fieldValues.load(
        user.tenantId,
        'contract',
        fullRows.map((row) => row.id),
      ),
      this.contractFields.loadProductsBatch(
        user.tenantId,
        fullRows.map((row) => row.id),
      ),
      this.userNames(fullRows.map((row) => row.owner)),
    ])
    const stageMap = new Map(stageConfigs.map((stage) => [stage.id, stage.name]))
    return {
      list: fullRows.map((row) =>
        this.toVO(
          row,
          fields,
          dynamic.get(row.id) ?? {},
          products.get(row.id) ?? [],
          ownerMap,
          stageMap,
        ),
      ),
      total,
      current,
      pageSize,
      stages: stageConfigs.map((stage) => ({
        id: stage.id,
        name: stage.name,
        type: stage._type,
        pos: Number(stage.pos),
        circulationType: stage.circulationType,
      })),
      optionMap: {},
    }
  }

  async addDirect(user: AuthUser, dto: ContractAddDto) {
    await this.ensureCustomer(user, dto.customerId)
    const owner = await this.resolveOwner(user, dto.owner)
    const config =
      dto.moduleFormConfigDTO ?? (await this.moduleForms.getConfig(user.tenantId, FORM_KEY))
    const customData = await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields ?? [])
    const products = dto.products?.length
      ? dto.products.map((item) => ({
          product: item.product,
          productAmount: item.productAmount ?? 0,
          productNumber: item.productNumber ?? 1,
          amount: item.amount,
          rowId: item.rowId,
          bizId: item.bizId,
          values: item.values,
        }))
      : await this.resolveProductsFromLegacyInput(user, undefined, dto.fromQuotationId)
    const amount = dto.amount ?? this.totalAmount(products)
    this.assertAmount(amount)
    const stage = await this.defaultStage(user.tenantId)
    const now = BigInt(Date.now())
    const pos = await this.nextPos(user.tenantId, stage.id)
    const created = await this.prisma.client.transaction(async (tx) => {
      const row = await tx.orm.public.Contract.create({
        id: createLegacyId32(),
        name: dto.name.trim(),
        customerId: dto.customerId,
        owner: owner.id,
        amount: numericValue(decimalString(amount, 14, 2), 14, 2),
        number: dto.number?.trim() || generateBizCode('HT'),
        approvalStatus: 'NONE',
        stage: stage.id,
        startTime: dto.startTime == null ? null : BigInt(dto.startTime),
        endTime: dto.endTime == null ? null : BigInt(dto.endTime),
        voidReason: null,
        organizationId: user.tenantId,
        pos,
        approved: false,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await this.fieldValues.save(
        user.tenantId,
        'contract',
        row.id,
        customData,
        'create',
        tx,
        user.id,
      )
      await this.contractFields.saveProducts(user.tenantId, row.id, products, tx)
      await this.writeSnapshot(tx, user.tenantId, row.id, config, row, customData, products)
      return row
    })
    if (await this.approvals.flowRequired(user.tenantId, 'contract', amount, 'CREATE')) {
      await this.approvals.submit(user, 'contract', created.id, 'CREATE')
    }
    return this.findOne(user, created.id)
  }

  async updateDirect(user: AuthUser, dto: ContractUpdateDirectDto) {
    const current = await this.ensureInScope(user, dto.id, 'contract:update')
    if (dto.customerId) await this.ensureCustomer(user, dto.customerId)
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : null
    const products = dto.products?.map((item) => ({
      product: item.product,
      productAmount: item.productAmount ?? 0,
      productNumber: item.productNumber ?? 1,
      amount: item.amount,
      rowId: item.rowId,
      bizId: item.bizId,
      values: item.values,
    }))
    const amountChanged = dto.amount !== undefined || products !== undefined
    const amount = dto.amount ?? (products ? this.totalAmount(products) : Number(current.amount))
    this.assertAmount(amount)
    const approvalRequired = await this.approvals.flowRequired(
      user.tenantId,
      'contract',
      amount,
      'UPDATE',
    )
    const preUpdateSnapshot = approvalRequired
      ? await this.approvals.capturePreUpdateSnapshot(user, 'contract', dto.id)
      : null
    const config =
      dto.moduleFormConfigDTO ?? (await this.moduleForms.getConfig(user.tenantId, FORM_KEY))
    const currentDynamic = await this.fieldValues.load(user.tenantId, 'contract', [dto.id])
    const customData =
      dto.moduleFields === undefined
        ? (currentDynamic.get(dto.id) ?? {})
        : await this.moduleFieldsToCustomData(user.tenantId, dto.moduleFields)
    await this.prisma.client.transaction(async (tx) => {
      const row = await tx.orm.public.Contract.where({ id: dto.id }).update({
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.customerId !== undefined ? { customerId: dto.customerId } : {}),
        ...(owner ? { owner: owner.id } : {}),
        ...(amountChanged ? { amount: numericValue(decimalString(amount, 14, 2), 14, 2) } : {}),
        ...(dto.number !== undefined ? { number: dto.number.trim() } : {}),
        ...(dto.startTime !== undefined
          ? { startTime: dto.startTime === null ? null : BigInt(dto.startTime) }
          : {}),
        ...(dto.endTime !== undefined
          ? { endTime: dto.endTime === null ? null : BigInt(dto.endTime) }
          : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (!row) throw new NotFoundException('合同不存在或不在你的数据范围内')
      if (dto.moduleFields !== undefined) {
        await this.fieldValues.save(
          user.tenantId,
          'contract',
          dto.id,
          customData,
          'update',
          tx,
          user.id,
        )
      }
      if (products) await this.contractFields.saveProducts(user.tenantId, dto.id, products, tx)
      const latestProducts =
        products ??
        (await this.contractFields.loadProducts(user.tenantId, dto.id)).map((item) => ({
          product: item.productId,
          productAmount: item.productAmount,
          productNumber: item.productNumber,
          amount: item.amount,
          rowId: item.rowId,
          bizId: item.bizId,
          values: item.values,
        }))
      await tx.orm.public.ContractSnapshot.where({
        contractId: dto.id,
      }).deleteAll()
      await this.writeSnapshot(tx, user.tenantId, dto.id, config, row, customData, latestProducts)
    })
    if (approvalRequired) {
      await this.approvals.submit(user, 'contract', dto.id, 'UPDATE', {
        preUpdateSnapshot,
        comment: dto.comment,
      })
    }
    return this.findOne(user, dto.id)
  }

  async getSnapshot(user: AuthUser, id: string) {
    await this.ensureInScope(user, id)
    const snapshot = await this.prisma.client.orm.public.ContractSnapshot.where({
      contractId: id,
    }).first()
    if (!snapshot?.contractValue) throw new NotFoundException('合同快照不存在')
    return this.parseObject(snapshot.contractValue)
  }

  async getSnapshotForm(user: AuthUser, id: string) {
    await this.ensureInScope(user, id)
    const snapshot = await this.prisma.client.orm.public.ContractSnapshot.where({
      contractId: id,
    }).first()
    if (!snapshot?.contractProp) throw new NotFoundException('合同表单快照不存在')
    return this.parseObject(snapshot.contractProp)
  }

  approval(user: AuthUser, dto: ContractApprovalDto) {
    return this.approvals.handleTargetApproval(user, 'contract', dto.id, dto.approvalStatus)
  }

  revoke(user: AuthUser, id: string) {
    return this.approvals.cancelTarget(user, 'contract', id)
  }

  async batchApproval(user: AuthUser, dto: ContractBatchApprovalDto) {
    let success = 0
    let fail = 0
    let skip = 0
    for (const id of dto.ids) {
      try {
        await this.approvals.handleTargetApproval(user, 'contract', id, dto.approvalStatus)
        success++
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          /没有审批中的申请|没有该单据的待审批任务/.test(error.message)
        ) {
          skip++
        } else {
          fail++
        }
      }
    }
    return { success, fail, skip }
  }

  async batchUpdateDirect(user: AuthUser, dto: ContractBatchUpdateDto) {
    const rows = await this.assertBatchInScope(user, dto.ids, 'contract:update')
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.type === 'formula' || field.hidden) {
      throw new BadRequestException('字段不存在或不支持批量修改')
    }
    if (field.system) {
      if (field.key === 'owner') {
        const owner = await this.resolveOwner(user, String(dto.fieldValue ?? ''))
        await this.prisma.client.orm.public.Contract.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(rows.map((item) => item.id)))
          .updateAndCount({
            owner: owner.id,
            updateTime: BigInt(Date.now()),
            updateUser: user.id,
          })
      } else if (field.key === 'name') {
        const name = String(dto.fieldValue ?? '').trim()
        if (!name) throw new BadRequestException('合同名称不能为空')
        await this.prisma.client.orm.public.Contract.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(rows.map((item) => item.id)))
          .updateAndCount({
            name: name,
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
          'contract',
          rows.map((row) => row.id),
          field.id,
          dto.fieldValue,
          tx,
        )
      })
    }
    await Promise.all(rows.map((row) => this.refreshSnapshot(user, row.id)))
    return { success: rows.length, fail: 0, skip: 0 }
  }

  async tab(user: AuthUser) {
    const scope = await this.dataScope.resolveScope(user, READ_PERMISSION)
    return { all: scope.all, dept: scope.deptIds.length > 0 }
  }

  async statistic(user: AuthUser, dto: ContractPageDto) {
    const result = await this.page(user, { ...dto, board: false, current: 1, pageSize: 500 })
    const amount = result.list.reduce((sum, item) => sum + item.amount, 0)
    const paidAmount = result.list.reduce((sum, item) => sum + item.paidAmount, 0)
    const invoicedAmount = result.list.reduce((sum, item) => sum + item.invoicedAmount, 0)
    return {
      count: result.total,
      amount: Math.round(amount * 100) / 100,
      paidAmount: Math.round(paidAmount * 100) / 100,
      invoicedAmount: Math.round(invoicedAmount * 100) / 100,
    }
  }

  async sort(user: AuthUser, dto: ContractSortDto) {
    const current = await this.ensureInScope(user, dto.id, 'contract:update')
    if (current.stage !== dto.stage) {
      throw new BadRequestException('跨阶段拖拽请使用合同阶段流转接口')
    }
    const rows = await this.prisma.client.orm.public.Contract.where({
      organizationId: user.tenantId,
      stage: dto.stage,
    })
      .orderBy((row) => row.pos.asc())
      .select('id')
      .all()
    const ids = rows.map((row) => String(row.id)).filter((id) => id !== dto.id)
    const index = Math.max(0, Math.min(ids.length, (dto.pos ?? ids.length + 1) - 1))
    ids.splice(index, 0, dto.id)
    await this.prisma.client.transaction(async (tx) => {
      const now = BigInt(Date.now())
      for (const [pos, id] of ids.entries()) {
        await tx.orm.public.Contract.where({ id: id }).update({
          pos: BigInt(pos + 1),
          updateTime: now,
          updateUser: user.id,
        })
      }
    })
    return { id: dto.id, stage: dto.stage, pos: index + 1 }
  }

  async findOne(user: AuthUser, id: string): Promise<ContractVO> {
    const row = await this.ensureInScope(user, id)
    const [fullRows, fields, dynamic, products, ownerMap, stage] = await Promise.all([
      this.loadContractRefs(user.tenantId, [row]),
      this.moduleForms.listFields(user.tenantId, FORM_KEY),
      this.fieldValues.load(user.tenantId, 'contract', [id]),
      this.contractFields.loadProducts(user.tenantId, id),
      this.userNames([row.owner]),
      this.prisma.client.orm.public.ContractStageConfig.where({
        id: row.stage,
        organizationId: user.tenantId,
      }).first(),
    ])
    const full = fullRows[0]
    if (!full) throw new NotFoundException('合同不存在或不在你的数据范围内')
    return this.toVO(
      full,
      fields,
      dynamic.get(id) ?? {},
      products,
      ownerMap,
      new Map(stage ? [[stage.id, stage.name]] : []),
    )
  }

  async updateStage(user: AuthUser, dto: UpdateContractStageDto) {
    const current = await this.ensureInScope(user, dto.id, 'contract:update')
    const requiredFields = await this.contractStages.assertTransition(
      user.tenantId,
      current.stage,
      dto.stage,
    )
    const submitted = new Map((dto.fields ?? []).map((item) => [item.fieldId, item.fieldValue]))
    for (const config of requiredFields) {
      if (!config || typeof config !== 'object') continue
      const fieldId = 'fieldId' in config ? String(config.fieldId ?? '') : ''
      const required = 'required' in config && config.required === true
      if (!required || !fieldId) continue
      const value = submitted.get(fieldId)
      if (value === undefined || value === null || value === '') {
        throw new BadRequestException(`合同阶段流转字段 ${fieldId} 为必填项`)
      }
    }

    const target = await this.prisma.client.orm.public.ContractStageConfig.where({
      id: dto.stage,
      organizationId: user.tenantId,
    }).first()
    if (!target) throw new BadRequestException('目标合同阶段不存在')
    if (target.name === '作废' && !dto.voidReason?.trim()) {
      throw new BadRequestException('合同作废原因不能为空')
    }
    const config = await this.moduleForms.getConfig(user.tenantId, FORM_KEY)
    const existingDynamic = await this.fieldValues.load(user.tenantId, 'contract', [dto.id])
    const dynamic = { ...(existingDynamic.get(dto.id) ?? {}) }
    if (dto.fields?.length) {
      const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
      const map = new Map(
        fields.flatMap((field) => [
          [field.id, field],
          [field.key, field],
        ]),
      )
      for (const item of dto.fields) {
        const field = map.get(item.fieldId)
        if (!field) throw new BadRequestException(`合同字段不存在：${item.fieldId}`)
        if (!field.system) dynamic[field.key] = item.fieldValue
      }
    }
    const products = await this.contractFields.loadProducts(user.tenantId, dto.id)
    const pos = await this.nextPos(user.tenantId, dto.stage)
    await this.prisma.client.transaction(async (tx) => {
      const row = await tx.orm.public.Contract.where({ id: dto.id }).update({
        stage: dto.stage,
        pos,
        voidReason: target.name === '作废' ? (dto.voidReason?.trim() ?? '') : null,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (!row) throw new NotFoundException('合同不存在或不在你的数据范围内')
      if (dto.fields?.length) {
        await this.fieldValues.save(
          user.tenantId,
          'contract',
          dto.id,
          dynamic,
          'update',
          tx,
          user.id,
        )
      }
      await tx.orm.public.ContractSnapshot.where({
        contractId: dto.id,
      }).deleteAll()
      await this.writeSnapshot(
        tx,
        user.tenantId,
        dto.id,
        config,
        row,
        dynamic,
        products.map((item) => ({
          product: item.productId,
          productAmount: item.productAmount,
          productNumber: item.productNumber,
          amount: item.amount,
          rowId: item.rowId,
          bizId: item.bizId,
          values: item.values,
        })),
      )
    })
    const stageEvent =
      target.name === '作废'
        ? 'CONTRACT_VOID'
        : target.name === '合同完结'
          ? 'CONTRACT_ARCHIVED'
          : null
    if (stageEvent) {
      const customer = await this.prisma.client.orm.public.Customer.where({
        id: current.customerId,
        organizationId: user.tenantId,
      })
        .select('name')
        .first()
      await this.businessNotifications.sendConfigured({
        tenantId: user.tenantId,
        event: stageEvent,
        operatorId: user.id,
        ownerId: current.owner,
        createUserId: current.createUser,
        type: 'system',
        templateContext: { customerName: customer?.name ?? current.name },
      })
    }
    return this.findOne(user, dto.id)
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id, 'contract:delete')
    await this.assertDeletable(id)
    if (
      await this.approvals.flowRequired(user.tenantId, 'contract', Number(row.amount), 'DELETE')
    ) {
      const approval = await this.approvals.submit(user, 'contract', id, 'DELETE')
      return { id, name: row.name, approvalId: approval.id, pendingApproval: true }
    }
    await this.prisma.client.orm.public.Contract.where({
      id: id,
      organizationId: user.tenantId,
    }).delete()
    return { id, name: row.name, pendingApproval: false }
  }

  async ensureInScope(user: AuthUser, id: string, permission = READ_PERMISSION) {
    const row = await this.prisma.client.orm.public.Contract.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('合同不存在或不在你的数据范围内')
    }
    return row
  }

  async refreshSnapshot(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id)
    const [config, dynamic, products] = await Promise.all([
      this.moduleForms.getConfig(user.tenantId, FORM_KEY),
      this.fieldValues.load(user.tenantId, 'contract', [id]),
      this.contractFields.loadProducts(user.tenantId, id),
    ])
    await this.prisma.client.transaction(async (tx) => {
      await tx.orm.public.ContractSnapshot.where({ contractId: id }).deleteAll()
      await this.writeSnapshot(
        tx,
        user.tenantId,
        id,
        config,
        row,
        dynamic.get(id) ?? {},
        products.map((item) => ({
          product: item.productId,
          productAmount: item.productAmount,
          productNumber: item.productNumber,
          amount: item.amount,
          rowId: item.rowId,
          bizId: item.bizId,
          values: item.values,
        })),
      )
    })
  }

  private async writeSnapshot(
    tx: PrismaTransaction,
    organizationId: string,
    contractId: string,
    config: unknown,
    row: {
      id: string
      name: string
      customerId: string
      owner: string
      amount: unknown
      number: string
      approvalStatus: string
      stage: string
      startTime: bigint | null
      endTime: bigint | null
      voidReason: string | null
      approved: boolean
    },
    customData: Record<string, unknown>,
    products: ContractProductInput[],
  ) {
    const fields = await this.moduleForms.listFieldsInTransaction(tx, organizationId, FORM_KEY)
    await tx.orm.public.ContractSnapshot.create({
      id: createLegacyId32(),
      contractId: contractId,
      contractProp: JSON.stringify(config ?? {}),
      contractValue: JSON.stringify({
        id: row.id,
        name: row.name,
        customerId: row.customerId,
        owner: row.owner,
        amount: Number(row.amount),
        number: row.number,
        approvalStatus: row.approvalStatus,
        stage: row.stage,
        startTime: row.startTime === null ? null : Number(row.startTime),
        endTime: row.endTime === null ? null : Number(row.endTime),
        voidReason: row.voidReason,
        approved: row.approved,
        moduleFields: this.moduleFieldsFromCustomData(fields, customData),
        products,
      }),
    })
  }

  private moduleFieldsFromCustomData(fields: FieldVO[], values: Record<string, unknown>) {
    return fields
      .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(values, field.key))
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
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
      if (!field) throw new BadRequestException(`合同字段不存在：${item.fieldId}`)
      if (field.system) continue
      result[field.key] = item.fieldValue
    }
    return result
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const unique = [...new Set(ids)]
    const rows = unique.length
      ? await this.prisma.client.orm.public.Contract.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(unique))
          .all()
      : []
    if (rows.length !== unique.length) throw new NotFoundException('部分合同不存在')
    for (const row of rows) {
      if (!(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
        throw new NotFoundException('部分合同不存在或不在你的数据范围内')
      }
    }
    return rows
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
      'customerId',
      'owner',
      'amount',
      'number',
      'approvalStatus',
      'stage',
      'startTime',
      'endTime',
      'approved',
      'createUser',
      'updateUser',
      'createTime',
      'updateTime',
    ])
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key === 'departmentId') {
          const deptId = String(condition.value ?? '')
          const users = await this.prisma.client.orm.public.Users.where({
            tenantId: organizationId,
            deptId,
          })
            .select('id')
            .all()
          const ownerIds = users.map((item) => String(item.id))
          let query = this.prisma.client.orm.public.Contract.where({
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
          let query = this.prisma.client.orm.public.Contract.where({
            organizationId: organizationId,
          })
          query = this.applyContractSystemFilter(query, condition.key, condition)
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
          await this.fieldValues.filterResourceIds(organizationId, 'contract', [normalized]),
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

  private applyContractSystemFilter(
    collection: ReturnType<typeof this.prisma.client.orm.public.Contract.where>,
    key: string,
    condition: FilterCondition,
  ) {
    const impossible = () => collection.where((row) => row.id.eq(''))
    if (condition.op === 'isEmpty') {
      if (key === 'startTime') return collection.where((row) => row.startTime.isNull())
      if (key === 'endTime') return collection.where((row) => row.endTime.isNull())
      return impossible()
    }
    if (condition.op === 'notEmpty') {
      if (key === 'startTime') return collection.where((row) => row.startTime.isNotNull())
      if (key === 'endTime') return collection.where((row) => row.endTime.isNotNull())
      return collection
    }
    const dateKeys = new Set(['startTime', 'endTime', 'createTime', 'updateTime'])
    const numberKeys = new Set(['amount'])
    const boolKeys = new Set(['approved'])
    if (dateKeys.has(key)) {
      const values: bigint[] = []
      for (const raw of Array.isArray(condition.value) ? condition.value : [condition.value]) {
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
        const field =
          key === 'startTime'
            ? row.startTime
            : key === 'endTime'
              ? row.endTime
              : key === 'createTime'
                ? row.createTime
                : row.updateTime
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
    if (numberKeys.has(key)) {
      const values = tryNumericValues(
        Array.isArray(condition.value) ? condition.value : [condition.value],
        14,
        2,
      )
      if (!values) return impossible()
      const value = values[0]!
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
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => item === true || String(item).toLowerCase() === 'true',
      )
      const value = values[0] ?? false
      return collection.where((row) => {
        if (condition.op === 'eq') return row.approved.eq(value)
        if (condition.op === 'ne') return row.approved.neq(value)
        if (condition.op === 'in') return row.approved.in(values)
        if (condition.op === 'notIn') return not(row.approved.in(values))
        return row.id.eq('')
      })
    }
    if (key === 'name') {
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
    if (key === 'number' || key === 'approvalStatus') {
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => String(item ?? ''),
      )
      const value = values[0]!
      return collection.where((row) => {
        const field = key === 'number' ? row.number : row.approvalStatus
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
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (item) => String(item ?? ''),
    )
    const value = values[0]!
    return collection.where((row) => {
      const field =
        key === 'customerId'
          ? row.customerId
          : key === 'owner'
            ? row.owner
            : key === 'stage'
              ? row.stage
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

  private async resolveProductsFromLegacyInput(
    user: AuthUser,
    items?: Array<{ productId?: string; quantity: number; unitPrice: number; amount?: number }>,
    fromQuoteId?: string,
  ): Promise<ContractProductInput[]> {
    if (items?.length) {
      return items
        .filter((item): item is typeof item & { productId: string } => !!item.productId)
        .map((item) => ({
          product: item.productId,
          productAmount: item.unitPrice,
          productNumber: item.quantity,
          amount: item.amount,
        }))
    }
    if (!fromQuoteId) return []
    const quote = await this.prisma.client.orm.public.OpportunityQuotation.where({
      id: fromQuoteId,
      organizationId: user.tenantId,
      invalid: false,
      approvalStatus: 'APPROVED',
    })
      .select('id')
      .first()
    if (!quote) throw new BadRequestException('仅支持从已审批且未作废的报价创建合同')
    return (await this.quotationFields.loadProducts(user.tenantId, fromQuoteId)).map((item) => ({
      product: item.productId,
      productAmount: item.productAmount,
      productNumber: 1,
      amount: item.productAmount,
    }))
  }

  private totalAmount(products: ContractProductInput[]) {
    return (
      Math.round(
        products.reduce(
          (sum, item) => sum + (item.amount ?? item.productAmount * (item.productNumber ?? 1)),
          0,
        ) * 100,
      ) / 100
    )
  }

  private assertAmount(amount: number) {
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('合同金额无效')
    if (amount > MAX_AMOUNT) throw new BadRequestException('合同金额超过最大值')
  }

  private async defaultStage(organizationId: string) {
    const stage = await this.prisma.client.orm.public.ContractStageConfig.where({
      organizationId: organizationId,
    })
      .orderBy((row) => row.pos.asc())
      .first()
    if (!stage) throw new BadRequestException('合同阶段未配置')
    return stage
  }

  private async nextPos(organizationId: string, stage: string) {
    const last = await this.prisma.client.orm.public.Contract.where({
      organizationId: organizationId,
      stage: stage,
    })
      .orderBy((row) => row.pos.desc())
      .select('pos')
      .first()
    return (last?.pos ?? 0n) + 1n
  }

  private async assertDeletable(id: string) {
    const [recordAggregate, invoiceAggregate] = await Promise.all([
      this.prisma.client.orm.public.ContractPaymentRecord.where({
        contractId: id,
      }).aggregate((value) => ({ count: value.count() })),
      this.prisma.client.orm.public.ContractInvoice.where({
        contractId: id,
      }).aggregate((value) => ({ count: value.count() })),
    ])
    if (recordAggregate.count) throw new BadRequestException('合同存在回款记录，无法删除')
    if (invoiceAggregate.count) throw new BadRequestException('合同存在发票，无法删除')
  }

  private async ensureCustomer(user: AuthUser, customerId: string) {
    const customer = await this.prisma.client.orm.public.Customer.where({
      id: customerId,
      organizationId: user.tenantId,
    })
      .select('id')
      .first()
    if (!customer) throw new BadRequestException('客户不存在')
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
    return owner
  }

  private async userNames(ids: string[]) {
    const unique = [...new Set(ids)]
    const users = unique.length
      ? await this.prisma.client.orm.public.Users.where((row) => row.id.in(unique))
          .select('id', 'name')
          .all()
      : []
    return new Map(users.map((item) => [item.id, item.name]))
  }

  private async loadContractRefs(
    organizationId: string,
    rows: ContractRow[],
  ): Promise<ContractWithRefs[]> {
    if (!rows.length) return []
    const contractIds = rows.map((row) => row.id)
    const customerIds = [...new Set(rows.map((row) => row.customerId))]
    const [customers, paymentRecords, invoices] = await Promise.all([
      customerIds.length
        ? this.prisma.client.orm.public.Customer.where({
            organizationId: organizationId,
          })
            .where((row) => row.id.in(customerIds))
            .select('id', 'name')
            .all()
        : [],
      this.prisma.client.orm.public.ContractPaymentRecord.where((row) =>
        row.contractId.in(contractIds),
      )
        .select('contractId', 'recordAmount')
        .all(),
      this.prisma.client.orm.public.ContractInvoice.where((row) => row.contractId.in(contractIds))
        .select('contractId', 'amount', 'approvalStatus')
        .all(),
    ])
    const customerMap = new Map(customers.map((item) => [String(item.id), item.name]))
    const paymentMap = new Map<string, Array<{ recordAmount: unknown }>>()
    for (const record of paymentRecords) {
      const bucket = paymentMap.get(record.contractId) ?? []
      bucket.push({ recordAmount: record.recordAmount })
      paymentMap.set(record.contractId, bucket)
    }
    const invoiceMap = new Map<
      string,
      Array<{ amount: unknown | null; approvalStatus: string | null }>
    >()
    for (const invoice of invoices) {
      const bucket = invoiceMap.get(invoice.contractId) ?? []
      bucket.push({ amount: invoice.amount, approvalStatus: invoice.approvalStatus })
      invoiceMap.set(invoice.contractId, bucket)
    }
    return rows.map((row) => ({
      ...row,
      customer: { name: customerMap.get(String(row.customerId)) ?? '已删除客户' },
      paymentRecords: paymentMap.get(row.id) ?? [],
      contractInvoices: invoiceMap.get(row.id) ?? [],
    }))
  }

  private toVO(
    row: ContractWithRefs,
    fields: FieldVO[],
    dynamic: Record<string, unknown>,
    products: ContractProductValue[],
    ownerMap: Map<string, string>,
    stageMap: Map<string, string>,
  ): ContractVO {
    const paidAmount =
      Math.round(
        row.paymentRecords.reduce((sum, item) => sum + Number(item.recordAmount ?? 0), 0) * 100,
      ) / 100
    const invoicedAmount =
      Math.round(
        row.contractInvoices
          .filter((item) => item.approvalStatus === 'APPROVED')
          .reduce((sum, item) => sum + Number(item.amount), 0) * 100,
      ) / 100
    return {
      id: row.id,
      name: row.name,
      customerId: row.customerId,
      customerName: row.customer.name,
      owner: row.owner,
      ownerName: ownerMap.get(row.owner) ?? null,
      amount: Number(row.amount),
      number: row.number,
      stage: row.stage,
      stageName: stageMap.get(row.stage) ?? null,
      paidAmount,
      invoicedAmount,
      approvalStatus: row.approvalStatus,
      approved: row.approved,
      startTime: row.startTime === null ? null : Number(row.startTime),
      endTime: row.endTime === null ? null : Number(row.endTime),
      voidReason: row.voidReason,
      createUser: row.createUser,
      updateUser: row.updateUser,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      moduleFields: this.moduleFieldsFromCustomData(fields, dynamic),
      products: products.map((item) => ({ ...item, values: item.values })),
    }
  }
}
