import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
  isCustomFieldKey,
  type FieldVO,
  type FilterCondition,
  type ImportResultVO,
  type OrderVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { generateBizCode } from '../../common/code-gen'
import { formatForExport } from '../../common/export-format'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { ExportTasksService } from '../import-export/export-tasks.service'
import { ApprovalsService } from '../approvals/approvals.service'
import {
  type ParsedSubTableSpreadsheetRow,
  SpreadsheetService,
} from '../import-export/spreadsheet.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import { USER_VIEW_RESOURCE_TYPES } from '../user-views/user-views.constants'
import { UserViewsService } from '../user-views/user-views.service'
import {
  OrderAddDto,
  OrderBatchUpdateDto,
  OrderExportDto,
  OrderExportSelectDto,
  OrderPageDto,
  OrderSortDto,
  OrderStageDto,
  OrderUpdateDto,
} from './dto/order.dto'
import { OrderFieldsService, type OrderProductInput } from './order-fields.service'
import { OrderStageService } from './order-stage.service'

const FORM_KEY = 'order'
const READ_PERMISSION = 'ORDER:READ'
const MAX_AMOUNT = 9_999_999_999
const ORDER_SUB_KEYS = [
  'orderProduct',
  'orderProductPrice',
  'orderProductNumber',
  'orderProductAmount',
] as const

interface OrderImportGroup {
  key: string
  rowNum: number
  resourceId?: string
  values: Record<string, unknown>
  subRows: Array<{ rowNum: number; values: Record<string, unknown> }>
  errors: string[]
}

const orderInclude = {
  customer: { select: { name: true } },
  contract: { select: { name: true } },
} as const

type OrderWithRefs = Prisma.OrderGetPayload<{ include: typeof orderInclude }>

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly userViews: UserViewsService,
    private readonly orderFields: OrderFieldsService,
    private readonly orderStages: OrderStageService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
    private readonly approvals: ApprovalsService,
  ) {}

  form(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, FORM_KEY)
  }

  async page(user: AuthUser, dto: OrderPageDto) {
    const current = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const saved =
      dto.viewId && !['ALL', 'DEPARTMENT'].includes(dto.viewId)
        ? await this.userViews.resolveFilters(user, dto.viewId, USER_VIEW_RESOURCE_TYPES.order)
        : null
    const [savedIds, adHocIds] = await Promise.all([
      saved?.conditions.length
        ? this.filterIds(user.tenantId, fields, saved.conditions, saved.searchMode)
        : null,
      dto.filters?.length ? this.filterIds(user.tenantId, fields, dto.filters, 'AND') : null,
    ])
    const filteredIds = this.intersectIds(savedIds, adHocIds)
    const scope = await this.dataScope.directOwnerFilter(user, READ_PERMISSION)
    const where: Prisma.OrderWhereInput = {
      organizationId: user.tenantId,
      AND: [scope as Prisma.OrderWhereInput],
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
      ...(dto.stage ? { stage: dto.stage } : {}),
      ...(dto.customerId ? { customerId: dto.customerId } : {}),
      ...(dto.contractId ? { contractId: dto.contractId } : {}),
      ...(dto.keyword
        ? {
            OR: [
              { name: { contains: dto.keyword, mode: 'insensitive' } },
              { number: { contains: dto.keyword, mode: 'insensitive' } },
              { customer: { name: { contains: dto.keyword, mode: 'insensitive' } } },
              { contract: { name: { contains: dto.keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    }
    const take = dto.board ? 500 : pageSize
    const skip = dto.board ? 0 : (current - 1) * pageSize
    const [rows, total, stages] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: orderInclude,
        orderBy: [{ stage: 'asc' }, { pos: 'asc' }, { updateTime: 'desc' }],
        skip,
        take,
      }),
      this.prisma.order.count({ where }),
      this.prisma.orderStageConfig.findMany({
        where: { organizationId: user.tenantId },
        orderBy: { pos: 'asc' },
      }),
    ])
    const [dynamic, products, ownerMap] = await Promise.all([
      this.fieldValues.load(user.tenantId, 'order', rows.map((row) => row.id)),
      this.orderFields.loadProductsBatch(user.tenantId, rows.map((row) => row.id)),
      this.userNames(rows.map((row) => row.owner)),
    ])
    const stageMap = new Map(stages.map((stage) => [stage.id, stage.name]))
    return {
      list: rows.map((row) =>
        this.toVO(
          row,
          dynamic.get(row.id) ?? {},
          products.get(row.id) ?? [],
          ownerMap,
          stageMap,
          fields,
        ),
      ),
      total,
      current,
      pageSize,
      stages: stages.map((stage) => ({
        id: stage.id,
        name: stage.name,
        type: stage.type,
        pos: Number(stage.pos),
        circulationType: stage.circulationType,
      })),
      optionMap: {},
    }
  }

  async add(user: AuthUser, dto: OrderAddDto) {
    await this.ensureCustomer(user, dto.customerId)
    if (dto.contractId) await this.ensureContract(user, dto.contractId, dto.customerId)
    const owner = await this.resolveOwner(user, dto.owner)
    const products = this.normalizeProducts(dto.products)
    const amount = dto.amount ?? this.totalAmount(products)
    this.assertAmount(amount)
    const stage = await this.defaultStage(user.tenantId)
    const now = BigInt(Date.now())
    const dynamicValues = await this.moduleFieldsToDynamicValues(user.tenantId, dto.moduleFields ?? [])
    const config = dto.moduleFormConfigDTO ?? (await this.moduleForms.getConfig(user.tenantId, FORM_KEY))
    const pos = await this.nextPos(user.tenantId, stage.id)
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: dto.number?.trim() || generateBizCode('DD'),
          name: dto.name.trim(),
          customerId: dto.customerId,
          contractId: dto.contractId || null,
          owner: owner.id,
          amount: new Prisma.Decimal(amount),
          stage: stage.id,
          approvalStatus: 'NONE',
          organizationId: user.tenantId,
          pos,
          approved: false,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(user.tenantId, 'order', created.id, dynamicValues, 'create', tx)
      await this.orderFields.saveProducts(user.tenantId, created.id, products, tx)
      await this.writeSnapshot(tx, user.tenantId, created, config, dynamicValues, products)
      return created
    })
    if (await this.approvals.flowRequired(user.tenantId, 'order', amount, 'CREATE')) {
      await this.approvals.submit(user, 'order', row.id, 'CREATE')
    }
    return this.findOne(user, row.id)
  }

  async update(user: AuthUser, dto: OrderUpdateDto) {
    const current = await this.ensureInScope(user, dto.id, 'ORDER:UPDATE')
    const customerId = dto.customerId ?? current.customerId
    if (dto.customerId) await this.ensureCustomer(user, dto.customerId)
    const contractId = dto.contractId === undefined ? current.contractId : dto.contractId
    if (contractId) {
      if (!customerId) throw new BadRequestException('关联客户不能为空')
      await this.ensureContract(user, contractId, customerId)
    }
    const owner = dto.owner ? await this.resolveOwner(user, dto.owner) : null
    const products = dto.products === undefined ? undefined : this.normalizeProducts(dto.products)
    const amount = dto.amount ?? (products ? this.totalAmount(products) : Number(current.amount ?? 0))
    this.assertAmount(amount)
    const approvalRequired = await this.approvals.flowRequired(
      user.tenantId,
      'order',
      amount,
      'UPDATE',
    )
    const businessSnapshot = approvalRequired
      ? await this.approvals.captureBusinessSnapshot(user, 'order', dto.id)
      : null
    const config = dto.moduleFormConfigDTO ?? (await this.moduleForms.getConfig(user.tenantId, FORM_KEY))
    const existingDynamic = await this.fieldValues.load(user.tenantId, 'order', [dto.id])
    const dynamicValues =
      dto.moduleFields === undefined
        ? existingDynamic.get(dto.id) ?? {}
        : await this.moduleFieldsToDynamicValues(user.tenantId, dto.moduleFields)
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: dto.id },
        data: {
          name: dto.name?.trim(),
          customerId: dto.customerId,
          contractId: dto.contractId,
          owner: owner?.id,
          amount: new Prisma.Decimal(amount),
          number: dto.number?.trim(),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (dto.moduleFields !== undefined) {
        await this.fieldValues.save(user.tenantId, 'order', dto.id, dynamicValues, 'update', tx)
      }
      if (products) await this.orderFields.saveProducts(user.tenantId, dto.id, products, tx)
      const latestProducts =
        products ??
        (await this.orderFields.loadProducts(user.tenantId, dto.id)).map((item) => ({
          product: item.productId,
          productPrice: item.productPrice,
          productNumber: item.productNumber,
          amount: item.amount,
          rowId: item.rowId,
          bizId: item.bizId,
          values: item.values,
        }))
      await tx.orderSnapshot.deleteMany({ where: { orderId: dto.id } })
      await this.writeSnapshot(tx, user.tenantId, row, config, dynamicValues, latestProducts)
    })
    if (approvalRequired) {
      await this.approvals.submit(user, 'order', dto.id, 'UPDATE', businessSnapshot)
    }
    return this.findOne(user, dto.id)
  }

  async findOne(user: AuthUser, id: string): Promise<OrderVO> {
    const row = await this.ensureInScope(user, id)
    const [full, dynamic, products, ownerMap, stage, fields] = await Promise.all([
      this.prisma.order.findUniqueOrThrow({ where: { id }, include: orderInclude }),
      this.fieldValues.load(user.tenantId, 'order', [id]),
      this.orderFields.loadProducts(user.tenantId, id),
      this.userNames([row.owner]),
      this.prisma.orderStageConfig.findFirst({
        where: { id: row.stage, organizationId: user.tenantId },
      }),
      this.moduleForms.listFields(user.tenantId, FORM_KEY),
    ])
    return this.toVO(
      full,
      dynamic.get(id) ?? {},
      products,
      ownerMap,
      new Map(stage ? [[stage.id, stage.name]] : []),
      fields,
    )
  }

  async getSnapshot(user: AuthUser, id: string) {
    await this.ensureInScope(user, id)
    const snapshot = await this.prisma.orderSnapshot.findFirst({ where: { orderId: id } })
    if (!snapshot?.orderValue) throw new NotFoundException('订单快照不存在')
    return this.parseObject(snapshot.orderValue)
  }

  async getSnapshotForm(user: AuthUser, id: string) {
    await this.ensureInScope(user, id)
    const snapshot = await this.prisma.orderSnapshot.findFirst({ where: { orderId: id } })
    if (!snapshot?.orderProp) throw new NotFoundException('订单表单快照不存在')
    return this.parseObject(snapshot.orderProp)
  }

  async updateStage(user: AuthUser, dto: OrderStageDto) {
    const current = await this.ensureInScope(user, dto.id, 'ORDER:UPDATE')
    const requiredFields = await this.orderStages.assertTransition(
      user.tenantId,
      current.stage,
      dto.stage,
    )
    const effectiveFields = new Map(
      (dto.fields ?? []).map((item) => [item.fieldId, { fieldId: item.fieldId, fieldValue: item.fieldValue }]),
    )
    for (const config of requiredFields) {
      if (!config || typeof config !== 'object') continue
      const fieldId = 'fieldId' in config ? String(config.fieldId ?? '') : ''
      if (!fieldId) continue
      const valueType = 'valueType' in config ? String(config.valueType ?? '') : ''
      if (
        valueType === 'FIXED_VALUE' &&
        'fieldValue' in config &&
        config.fieldValue !== undefined &&
        config.fieldValue !== null &&
        !effectiveFields.has(fieldId)
      ) {
        effectiveFields.set(fieldId, { fieldId, fieldValue: config.fieldValue })
      }
      const required = 'required' in config && config.required === true
      if (!required) continue
      const value = effectiveFields.get(fieldId)?.fieldValue
      if (value === undefined || value === null || value === '') {
        throw new BadRequestException(`订单阶段流转字段 ${fieldId} 为必填项`)
      }
    }
    const stageFields = [...effectiveFields.values()]
    const target = await this.prisma.orderStageConfig.findFirst({
      where: { id: dto.stage, organizationId: user.tenantId },
    })
    if (!target) throw new BadRequestException('目标订单阶段不存在')
    const config = await this.moduleForms.getConfig(user.tenantId, FORM_KEY)
    const [currentDynamic, products] = await Promise.all([
      this.fieldValues.load(user.tenantId, 'order', [dto.id]),
      this.orderFields.loadProducts(user.tenantId, dto.id),
    ])
    const dynamic = { ...(currentDynamic.get(dto.id) ?? {}) }
    if (stageFields.length) {
      const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
      const map = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
      for (const item of stageFields) {
        const field = map.get(item.fieldId)
        if (!field) throw new BadRequestException(`订单字段不存在：${item.fieldId}`)
        if (!field.system) dynamic[field.key] = item.fieldValue
      }
    }
    const pos = await this.nextPos(user.tenantId, dto.stage)
    await this.prisma.$transaction(async (tx) => {
      const row = await tx.order.update({
        where: { id: dto.id },
        data: {
          stage: dto.stage,
          pos,
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (stageFields.length) {
        await this.fieldValues.save(user.tenantId, 'order', dto.id, dynamic, 'update', tx)
      }
      await tx.orderSnapshot.deleteMany({ where: { orderId: dto.id } })
      await this.writeSnapshot(
        tx,
        user.tenantId,
        row,
        config,
        dynamic,
        products.map((item) => ({
          product: item.productId,
          productPrice: item.productPrice,
          productNumber: item.productNumber,
          amount: item.amount,
          rowId: item.rowId,
          bizId: item.bizId,
          values: item.values,
        })),
      )
    })
    return this.findOne(user, dto.id)
  }

  async batchUpdate(user: AuthUser, dto: OrderBatchUpdateDto) {
    const rows = await this.assertBatchInScope(user, dto.ids, 'ORDER:UPDATE')
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field) throw new BadRequestException('订单字段不存在')
    if (field.system) {
      if (field.key === 'owner') {
        const owner = await this.resolveOwner(user, String(dto.fieldValue ?? ''))
        await this.prisma.order.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { owner: owner.id, updateTime: BigInt(Date.now()), updateUser: user.id },
        })
      } else if (field.key === 'name') {
        const name = String(dto.fieldValue ?? '').trim()
        if (!name) throw new BadRequestException('订单名称不能为空')
        await this.prisma.order.updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { name, updateTime: BigInt(Date.now()), updateUser: user.id },
        })
      } else {
        throw new BadRequestException('该系统字段不支持批量修改')
      }
    } else {
      await this.prisma.$transaction(async (tx) => {
        await this.fieldValues.saveBatch(
          user.tenantId,
          'order',
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

  async download(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id, 'ORDER:DOWNLOAD')
    return { id: row.id, name: row.name }
  }

  async statistic(user: AuthUser, dto: OrderPageDto) {
    const result = await this.page(user, { ...dto, board: false, current: 1, pageSize: 500 })
    return {
      count: result.total,
      amount:
        Math.round(
          result.list.reduce((sum, item) => sum + Number(item.amount ?? 0), 0) * 100,
        ) / 100,
    }
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const { mainFields, subFields, parent } = this.spreadsheetFields(fields)
    const data = await this.spreadsheet.buildSubTableImportTemplate(
      mainFields,
      subFields,
      importType,
      parent.label,
    )
    return {
      filename: `订单${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const { mainFields, subFields, parent } = this.spreadsheetFields(fields)
    const rows = await this.spreadsheet.parseSubTableImport(
      file,
      mainFields,
      subFields,
      importType,
      parent.label,
    )
    const groups = this.groupImportRows(rows, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const group of groups) {
      const errors = [...group.errors]
      if (!errors.length) {
        try {
          await this.prepareImportGroup(user, group, fields, importType)
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '数据校验失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: group.rowNum, errMsg: errors.join('；') })
      else successCount++
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  async importXlsx(user: AuthUser, file: Buffer, importType: ImportType): Promise<ImportResultVO> {
    const fields = await this.moduleForms.listFields(user.tenantId, FORM_KEY)
    const { mainFields, subFields, parent } = this.spreadsheetFields(fields)
    const rows = await this.spreadsheet.parseSubTableImport(
      file,
      mainFields,
      subFields,
      importType,
      parent.label,
    )
    const groups = this.groupImportRows(rows, importType)
    const errorMessages: ImportResultVO['errorMessages'] = []
    let successCount = 0
    for (const group of groups) {
      const errors = [...group.errors]
      if (!errors.length) {
        try {
          const prepared = await this.prepareImportGroup(user, group, fields, importType)
          if (importType === 'ADD') await this.add(user, prepared.add)
          else {
            if (!group.resourceId) throw new BadRequestException('唯一ID不能为空')
            await this.update(user, { id: group.resourceId, ...prepared.update })
          }
          successCount++
        } catch (error) {
          errors.push(error instanceof Error ? error.message : '导入失败')
        }
      }
      if (errors.length) errorMessages.push({ rowNum: group.rowNum, errMsg: errors.join('；') })
    }
    return { successCount, failCount: errorMessages.length, errorMessages }
  }

  exportAll(user: AuthUser, dto: OrderExportDto) {
    return this.exportXlsx(user, dto, dto.fileName, dto.headList)
  }

  exportSelected(user: AuthUser, dto: OrderExportSelectDto) {
    return this.exportXlsx(user, {}, dto.fileName, dto.headList, dto.ids)
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<OrderPageDto>,
    fileName: string,
    headList: string[],
    ids?: string[],
  ) {
    const [items, fields] = await Promise.all([
      this.collectExportItems(user, query, ids),
      this.moduleForms.listFields(user.tenantId, FORM_KEY),
    ])
    const { parent } = this.spreadsheetFields(fields)
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const subKeySet = new Set<string>(ORDER_SUB_KEYS)
    const extraColumns = new Map([
      ['stageName', '订单状态'],
      ['approvalStatus', '审批状态'],
      ['approved', '历史审批通过'],
      ['ownerName', '负责人'],
      ['customerName', '客户'],
      ['contractName', '合同'],
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
    ])
    const mainColumns: Array<{ key: string; label: string }> = []
    const subColumns: Array<{ key: string; label: string }> = []
    for (const key of headList) {
      const field = fieldMap.get(key)
      const extra = extraColumns.get(key)
      if (subKeySet.has(key)) {
        if (!field) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
        subColumns.push({ key, label: field.label })
        continue
      }
      if ((!field || field.hidden) && !extra) {
        throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      }
      mainColumns.push({ key, label: field?.label ?? (extra as string) })
    }
    const mainRows = items.map((item) => {
      const byId = new Map(item.moduleFields.map((field) => [field.fieldId, field.fieldValue]))
      const dynamicValues = Object.fromEntries(
        fields
          .filter((field) => !field.system && byId.has(field.id))
          .map((field) => [field.key, byId.get(field.id)]),
      )
      const source: Record<string, unknown> = {
        ...dynamicValues,
        number: item.number,
        name: item.name,
        customerId: item.customerName ?? item.customerId ?? '',
        contractId: item.contractName ?? item.contractId ?? '',
        owner: item.ownerName ?? item.owner ?? '',
        amount: item.amount ?? '',
        stageName: item.stageName ?? '',
        approvalStatus: item.approvalStatus,
        approved: item.approved,
        ownerName: item.ownerName ?? '',
        customerName: item.customerName ?? '',
        contractName: item.contractName ?? '',
        createTime: item.createTime,
        updateTime: item.updateTime,
      }
      return Object.fromEntries(
        mainColumns.map((column) => {
          const field = fieldMap.get(column.key)
          return [column.key, field ? formatForExport(field, source) : source[column.key] ?? '']
        }),
      )
    })
    if (!subColumns.length) {
      return this.exportTasks.create(user, {
        module: 'order',
        fileName,
        columns: mainColumns,
        rows: mainRows,
      })
    }
    const groups = items.map((item, index) => ({
      values: mainRows[index] ?? {},
      subRows: item.products.map((product) => ({
        ...product.values,
        orderProduct: product.productName ?? product.productId,
        orderProductPrice: product.productPrice,
        orderProductNumber: product.productNumber,
        orderProductAmount: product.amount,
      })),
    }))
    const data = await this.spreadsheet.buildSubTableExportWorkbook(
      mainColumns,
      subColumns,
      groups,
      parent.label,
    )
    return this.exportTasks.createFromBuffer(user, {
      module: 'order',
      fileName,
      data,
      rowCount: items.length,
    })
  }

  private async collectExportItems(
    user: AuthUser,
    query: Partial<OrderPageDto>,
    ids?: string[],
  ): Promise<OrderVO[]> {
    const first = await this.page(user, { ...query, board: false, current: 1, pageSize: 500 })
    const all = [...first.list]
    const pages = Math.ceil(first.total / 500)
    for (let current = 2; current <= pages; current++) {
      const next = await this.page(user, { ...query, board: false, current, pageSize: 500 })
      all.push(...next.list)
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size) {
      throw new BadRequestException('选中数据包含不存在或无权导出的订单')
    }
    return selected
  }

  private spreadsheetFields(fields: FieldVO[]) {
    const parent = fields.find((field) => field.key === 'orderProducts')
    const subFields = ORDER_SUB_KEYS.map((key) => fields.find((field) => field.key === key))
    if (!parent || subFields.some((field) => !field)) {
      throw new BadRequestException('订单产品子表字段配置不完整')
    }
    const subKeySet = new Set<string>(['orderProducts', ...ORDER_SUB_KEYS])
    return {
      parent,
      subFields: subFields as FieldVO[],
      mainFields: fields.filter((field) => !subKeySet.has(field.key) && field.key !== 'number'),
    }
  }

  private groupImportRows(rows: ParsedSubTableSpreadsheetRow[], importType: ImportType) {
    const groups: OrderImportGroup[] = []
    let current: OrderImportGroup | undefined
    for (const row of rows) {
      const rawKey = importType === 'UPDATE' ? row.resourceId : row.values['name']
      const explicitKey = rawKey === undefined || rawKey === null ? '' : String(rawKey).trim()
      if (explicitKey && (!current || current.key !== explicitKey)) {
        current = {
          key: explicitKey,
          rowNum: row.rowNum,
          ...(importType === 'UPDATE' ? { resourceId: explicitKey } : {}),
          values: {},
          subRows: [],
          errors: [],
        }
        groups.push(current)
      } else if (!current) {
        current = {
          key: `row:${row.rowNum}`,
          rowNum: row.rowNum,
          values: {},
          subRows: [],
          errors: [importType === 'UPDATE' ? '唯一ID不能为空' : '订单名称不能为空'],
        }
        groups.push(current)
      }
      if (importType === 'UPDATE' && row.resourceId && !current.resourceId) {
        current.resourceId = row.resourceId
      }
      for (const [key, value] of Object.entries(row.values)) {
        const existing = current.values[key]
        if (existing === undefined) {
          current.values[key] = value
          continue
        }
        if (JSON.stringify(existing) !== JSON.stringify(value)) {
          current.errors.push(`第 ${row.rowNum} 行主字段「${key}」与同一订单前序行不一致`)
        }
      }
      if (Object.keys(row.subValues).length > 0) {
        current.subRows.push({ rowNum: row.rowNum, values: row.subValues })
      }
      current.errors.push(...row.errors.map((error) => `第 ${row.rowNum} 行：${error}`))
    }
    return groups
  }

  private async prepareImportGroup(
    user: AuthUser,
    group: OrderImportGroup,
    fields: FieldVO[],
    importType: ImportType,
  ) {
    const prepared = await this.prepareImportRow(
      user,
      group.values,
      fields,
      importType,
      group.resourceId,
    )
    const products: OrderProductInput[] = []
    for (const row of group.subRows) {
      const productRef = row.values['orderProduct']
      if (productRef === undefined || String(productRef).trim() === '') {
        throw new BadRequestException(`第 ${row.rowNum} 行：产品名称不能为空`)
      }
      const product = await this.resolveImportedProduct(user.tenantId, String(productRef).trim())
      const priceValue = row.values['orderProductPrice']
      const numberValue = row.values['orderProductNumber']
      const productPrice = priceValue === undefined || priceValue === '' ? 0 : Number(priceValue)
      const productNumber = numberValue === undefined || numberValue === '' ? 1 : Number(numberValue)
      if (!Number.isFinite(productPrice) || productPrice < 0) {
        throw new BadRequestException(`第 ${row.rowNum} 行：产品单价必须是大于等于 0 的数字`)
      }
      if (!Number.isFinite(productNumber) || productNumber < 0) {
        throw new BadRequestException(`第 ${row.rowNum} 行：数量必须是大于等于 0 的数字`)
      }
      const values = Object.fromEntries(
        Object.entries(row.values).filter(
          ([key, value]) => !ORDER_SUB_KEYS.includes(key as (typeof ORDER_SUB_KEYS)[number]) && value !== undefined,
        ),
      )
      products.push({
        product: product.id,
        productPrice,
        productNumber,
        amount: Math.round(productPrice * productNumber * 100) / 100,
        ...(Object.keys(values).length ? { values } : {}),
      })
    }
    prepared.add.products = products
    if (group.subRows.length > 0) prepared.update.products = products
    return prepared
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
      .filter(
        (field) =>
          !field.system &&
          !field.hidden &&
          values[field.key] !== undefined,
      )
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
    const name = values['name'] === undefined ? undefined : String(values['name']).trim()
    const customerRef = values['customerId'] === undefined ? undefined : String(values['customerId']).trim()
    const contractRef = values['contractId'] === undefined ? undefined : String(values['contractId']).trim()
    const ownerRef = values['owner'] === undefined ? undefined : String(values['owner']).trim()
    const current = resourceId ? await this.ensureInScope(user, resourceId, 'ORDER:UPDATE') : null
    const customer = customerRef ? await this.resolveImportedCustomer(user.tenantId, customerRef) : null
    const customerId = customer?.id
    const effectiveCustomerId = customerId ?? current?.customerId ?? null
    const contractId =
      contractRef === undefined
        ? undefined
        : contractRef
          ? (await this.resolveImportedContract(user.tenantId, contractRef, effectiveCustomerId)).id
          : null
    const owner = ownerRef ? (await this.resolveImportedOwner(user.tenantId, ownerRef)).id : undefined
    if (importType === 'ADD') {
      if (!name) throw new BadRequestException('订单名称不能为空')
      if (!customerRef || !customerId) throw new BadRequestException('关联客户不能为空')
      if (!owner) throw new BadRequestException('负责人不能为空')
    }
    const common = {
      ...(name !== undefined ? { name } : {}),
      ...(customerId !== undefined ? { customerId } : {}),
      ...(contractId !== undefined ? { contractId } : {}),
      ...(owner !== undefined ? { owner } : {}),
      ...(moduleFields.length ? { moduleFields } : {}),
    }
    return { add: common as OrderAddDto, update: common as Omit<OrderUpdateDto, 'id'> }
  }

  async sort(user: AuthUser, dto: OrderSortDto) {
    const current = await this.ensureInScope(user, dto.id, 'ORDER:UPDATE')
    if (current.stage !== dto.stage) {
      throw new BadRequestException('跨阶段拖拽请使用订单阶段流转接口')
    }
    const rows = await this.prisma.order.findMany({
      where: { organizationId: user.tenantId, stage: dto.stage },
      orderBy: { pos: 'asc' },
      select: { id: true },
    })
    const ids = rows.map((row) => row.id).filter((id) => id !== dto.id)
    const index = Math.max(0, Math.min(ids.length, (dto.pos ?? ids.length + 1) - 1))
    ids.splice(index, 0, dto.id)
    await this.prisma.$transaction(
      ids.map((id, pos) =>
        this.prisma.order.update({
          where: { id },
          data: { pos: BigInt(pos + 1), updateTime: BigInt(Date.now()), updateUser: user.id },
        }),
      ),
    )
    return { id: dto.id, stage: dto.stage, pos: index + 1 }
  }

  async remove(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id, 'ORDER:DELETE')
    if (await this.approvals.flowRequired(user.tenantId, 'order', Number(row.amount ?? 0), 'DELETE')) {
      const approval = await this.approvals.submit(user, 'order', id, 'DELETE')
      return { id, name: row.name, approvalId: approval.id, pendingApproval: true }
    }
    await this.prisma.order.delete({ where: { id } })
    return { id, name: row.name, pendingApproval: false }
  }

  async pushApproval(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id, 'ORDER:UPDATE')
    return this.approvals.submit(user, 'order', row.id, 'CREATE')
  }

  async revokeApproval(user: AuthUser, id: string) {
    await this.ensureInScope(user, id, 'ORDER:UPDATE')
    return this.approvals.cancelTarget(user, 'order', id)
  }

  async approvalSimpleDetail(user: AuthUser, id: string) {
    const order = await this.ensureInScope(user, id)
    const instance = await this.approvals.instanceForTarget(user, 'order', id)
    return {
      resourceId: id,
      approveStatus: order.approvalStatus,
      approveUserList:
        instance?.tasks.map((task) => ({
          userId: task.approverId,
          userName: task.approverName ?? null,
          status: task.status,
        })) ?? [],
    }
  }

  async approvalDetail(user: AuthUser, id: string) {
    await this.ensureInScope(user, id)
    return this.approvals.instanceForTarget(user, 'order', id)
  }

  async ensureInScope(user: AuthUser, id: string, permission = READ_PERMISSION) {
    const row = await this.prisma.order.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!row || !(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
      throw new NotFoundException('订单不存在或不在你的数据范围内')
    }
    return row
  }

  async refreshSnapshot(user: AuthUser, id: string) {
    const row = await this.ensureInScope(user, id)
    const [config, dynamic, products] = await Promise.all([
      this.moduleForms.getConfig(user.tenantId, FORM_KEY),
      this.fieldValues.load(user.tenantId, 'order', [id]),
      this.orderFields.loadProducts(user.tenantId, id),
    ])
    await this.prisma.$transaction(async (tx) => {
      await tx.orderSnapshot.deleteMany({ where: { orderId: id } })
      await this.writeSnapshot(
        tx,
        user.tenantId,
        row,
        config,
        dynamic.get(id) ?? {},
        products.map((item) => ({
          product: item.productId,
          productPrice: item.productPrice,
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
    tx: Prisma.TransactionClient,
    organizationId: string,
    row: {
      id: string
      number: string
      name: string
      customerId: string | null
      contractId: string | null
      owner: string | null
      amount: Prisma.Decimal | null
      stage: string
      approvalStatus: string
      approved: boolean
      pos: bigint | null
    },
    config: unknown,
    dynamicValues: Record<string, unknown>,
    products: OrderProductInput[],
  ) {
    const fields = await this.moduleForms.listFieldsInTransaction(tx, organizationId, FORM_KEY)
    await tx.orderSnapshot.create({
      data: {
        orderId: row.id,
        orderProp: JSON.stringify(config ?? {}),
        orderValue: JSON.stringify({
          id: row.id,
          number: row.number,
          name: row.name,
          customerId: row.customerId,
          contractId: row.contractId,
          owner: row.owner,
          amount: row.amount === null ? null : Number(row.amount),
          stage: row.stage,
          approvalStatus: row.approvalStatus,
          approved: row.approved,
          pos: row.pos === null ? null : Number(row.pos),
          moduleFields: fields
            .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(dynamicValues, field.key))
            .map((field) => ({ fieldId: field.id, fieldValue: dynamicValues[field.key] })),
          products,
        }),
      },
    })
  }

  private async moduleFieldsToDynamicValues(
    organizationId: string,
    moduleFields: Array<{ fieldId: string; fieldValue?: unknown }> = [],
  ) {
    const fields = await this.moduleForms.listFields(organizationId, FORM_KEY)
    const map = new Map(fields.flatMap((field) => [[field.id, field], [field.key, field]]))
    const result: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`订单字段不存在：${item.fieldId}`)
      if (field.system) continue
      result[field.key] = item.fieldValue
    }
    return result
  }

  private async assertBatchInScope(user: AuthUser, ids: string[], permission: string) {
    const unique = [...new Set(ids)]
    const rows = await this.prisma.order.findMany({
      where: { id: { in: unique }, organizationId: user.tenantId },
    })
    if (rows.length !== unique.length) throw new NotFoundException('部分订单不存在')
    for (const row of rows) {
      if (!(await this.dataScope.matchesDirectOwner(user, row.owner, permission))) {
        throw new NotFoundException('部分订单不存在或不在你的数据范围内')
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
    const fieldMap = new Map(fields.flatMap((field) => [[field.key, field], [field.id, field]]))
    const directKeys = new Set([
      'number',
      'name',
      'customerId',
      'contractId',
      'owner',
      'amount',
      'stage',
      'approvalStatus',
      'approved',
      'createTime',
      'updateTime',
      'createUser',
      'updateUser',
    ])
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        if (condition.key === 'departmentId') {
          const deptId = String(condition.value ?? '')
          const users = await this.prisma.user.findMany({
            where: { tenantId: organizationId, deptId },
            select: { id: true },
          })
          const ownerIds = users.map((item) => item.id)
          const rows = await this.prisma.order.findMany({
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
          const clause = this.systemFilterClause(condition.key, condition)
          if (!clause) return new Set<string>()
          const rows = await this.prisma.order.findMany({
            where: { organizationId, AND: [clause] },
            select: { id: true },
          })
          return new Set(rows.map((row) => row.id))
        }
        const field = fieldMap.get(condition.key)
        if (!field || field.system || (!isCustomFieldKey(condition.key) && field.hidden)) {
          return new Set<string>()
        }
        const normalized =
          field.key === condition.key ? condition : { ...condition, key: field.key }
        return new Set(
          await this.fieldValues.filterResourceIds(organizationId, 'order', [normalized]),
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

  private systemFilterClause(key: string, condition: FilterCondition): Prisma.OrderWhereInput | null {
    const dateKeys = new Set(['createTime', 'updateTime'])
    const numberKeys = new Set(['amount'])
    const boolKeys = new Set(['approved'])
    let rawValue: unknown = condition.value
    if (dateKeys.has(key)) {
      const direct = Number(condition.value)
      const millis =
        Number.isFinite(direct) && String(condition.value ?? '').trim() !== ''
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
    const fieldKey = key as keyof Prisma.OrderWhereInput
    if (condition.op === 'eq') return { [fieldKey]: { equals: value } } as Prisma.OrderWhereInput
    if (condition.op === 'ne') {
      return { NOT: { [fieldKey]: { equals: value } } } as Prisma.OrderWhereInput
    }
    if (condition.op === 'contains') {
      if (dateKeys.has(key) || numberKeys.has(key) || boolKeys.has(key)) return null
      return {
        [fieldKey]: { contains: String(condition.value ?? ''), mode: 'insensitive' },
      } as Prisma.OrderWhereInput
    }
    if (condition.op === 'gt') return { [fieldKey]: { gt: value } } as Prisma.OrderWhereInput
    if (condition.op === 'gte') return { [fieldKey]: { gte: value } } as Prisma.OrderWhereInput
    if (condition.op === 'lt') return { [fieldKey]: { lt: value } } as Prisma.OrderWhereInput
    if (condition.op === 'lte') return { [fieldKey]: { lte: value } } as Prisma.OrderWhereInput
    if (condition.op === 'isEmpty') return { [fieldKey]: null } as Prisma.OrderWhereInput
    if (condition.op === 'notEmpty') return { NOT: { [fieldKey]: null } } as Prisma.OrderWhereInput
    return null
  }

  private intersectIds(left: string[] | null, right: string[] | null): string[] | null {
    if (left === null) return right
    if (right === null) return left
    const rightSet = new Set(right)
    return left.filter((id) => rightSet.has(id))
  }

  private async defaultStage(organizationId: string) {
    const stage = await this.prisma.orderStageConfig.findFirst({
      where: { organizationId },
      orderBy: { pos: 'asc' },
    })
    if (!stage) throw new BadRequestException('订单状态流尚未配置')
    return stage
  }

  private async nextPos(organizationId: string, stage: string) {
    const result = await this.prisma.order.aggregate({
      where: { organizationId, stage },
      _max: { pos: true },
    })
    return (result._max.pos ?? 0n) + 1n
  }

  private async ensureCustomer(user: AuthUser, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, organizationId: user.tenantId },
      select: { id: true },
    })
    if (!customer) throw new BadRequestException('关联客户不存在')
    return customer
  }

  private async ensureContract(user: AuthUser, id: string, customerId: string) {
    const contract = await this.prisma.contract.findFirst({
      where: { id, organizationId: user.tenantId, customerId },
      select: { id: true },
    })
    if (!contract) throw new BadRequestException('关联合同不存在或不属于当前客户')
    return contract
  }

  private async resolveOwner(user: AuthUser, ownerId: string) {
    const owner = await this.prisma.user.findFirst({
      where: { id: ownerId, tenantId: user.tenantId, status: 'ACTIVE' },
      select: { id: true },
    })
    if (!owner) throw new BadRequestException('负责人不存在或已禁用')
    return owner
  }

  private async resolveImportedCustomer(organizationId: string, ref: string) {
    const rows = await this.prisma.customer.findMany({
      where: {
        organizationId,
        OR: [{ id: ref }, { name: ref }],
      },
      select: { id: true, name: true },
      take: 3,
    })
    const exact = rows.find((row) => row.id === ref)
    if (exact) return exact
    if (rows.length === 0) throw new BadRequestException(`客户不存在：${ref}`)
    if (rows.length > 1) throw new BadRequestException(`客户名称不唯一：${ref}`)
    return rows[0]!
  }

  private async resolveImportedContract(
    organizationId: string,
    ref: string,
    customerId: string | null,
  ) {
    const rows = await this.prisma.contract.findMany({
      where: {
        organizationId,
        ...(customerId ? { customerId } : {}),
        OR: [{ id: ref }, { name: ref }, { number: ref }],
      },
      select: { id: true, name: true, number: true, customerId: true },
      take: 3,
    })
    const exact = rows.find((row) => row.id === ref || row.number === ref)
    if (exact) return exact
    if (rows.length === 0) throw new BadRequestException(`合同不存在：${ref}`)
    if (rows.length > 1) throw new BadRequestException(`合同名称不唯一：${ref}`)
    return rows[0]!
  }

  private async resolveImportedOwner(organizationId: string, ref: string) {
    const rows = await this.prisma.user.findMany({
      where: {
        tenantId: organizationId,
        status: 'ACTIVE',
        OR: [{ id: ref }, { name: ref }, { email: ref }],
      },
      select: { id: true, name: true, email: true },
      take: 3,
    })
    const exact = rows.find((row) => row.id === ref || row.email === ref)
    if (exact) return exact
    if (rows.length === 0) throw new BadRequestException(`负责人不存在：${ref}`)
    if (rows.length > 1) throw new BadRequestException(`负责人名称不唯一：${ref}`)
    return rows[0]!
  }

  private async resolveImportedProduct(organizationId: string, ref: string) {
    const rows = await this.prisma.product.findMany({
      where: {
        organizationId,
        OR: [{ id: ref }, { name: ref }],
      },
      select: { id: true, name: true },
      take: 3,
    })
    const exact = rows.find((row) => row.id === ref)
    if (exact) return exact
    if (rows.length === 0) throw new BadRequestException(`产品不存在：${ref}`)
    if (rows.length > 1) throw new BadRequestException(`产品名称不唯一：${ref}`)
    return rows[0]!
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((id): id is string => !!id))]
    if (!unique.length) return new Map<string, string>()
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    })
    return new Map(users.map((user) => [user.id, user.name]))
  }

  private assertAmount(amount: number) {
    if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('订单金额无效')
    if (amount > MAX_AMOUNT) throw new BadRequestException('订单金额超过最大值')
  }

  private normalizeProducts(
    products: Array<{
      product: string
      productPrice?: number
      productNumber?: number
      amount?: number
      rowId?: string
      bizId?: string
      values?: Record<string, unknown>
    }> = [],
  ): OrderProductInput[] {
    return products.map((item) => ({
      product: item.product,
      productPrice: item.productPrice ?? 0,
      productNumber: item.productNumber ?? 1,
      amount: item.amount,
      rowId: item.rowId,
      bizId: item.bizId,
      values: item.values,
    }))
  }

  private totalAmount(products: OrderProductInput[]) {
    return Math.round(
      products.reduce(
        (sum, item) => sum + (item.amount ?? item.productPrice * (item.productNumber ?? 1)),
        0,
      ) * 100,
    ) / 100
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

  private toVO(
    row: OrderWithRefs,
    dynamicValues: Record<string, unknown>,
    products: Awaited<ReturnType<OrderFieldsService['loadProducts']>>,
    ownerMap: Map<string, string>,
    stageMap: Map<string, string>,
    fields: FieldVO[],
  ): OrderVO {
    return {
      id: row.id,
      number: row.number,
      name: row.name,
      customerId: row.customerId,
      customerName: row.customer?.name ?? null,
      contractId: row.contractId,
      contractName: row.contract?.name ?? null,
      owner: row.owner,
      ownerName: row.owner ? ownerMap.get(row.owner) ?? null : null,
      amount: row.amount === null ? null : Number(row.amount),
      stage: row.stage,
      stageName: stageMap.get(row.stage) ?? null,
      approvalStatus: row.approvalStatus,
      approved: row.approved,
      pos: row.pos === null ? null : Number(row.pos),
      moduleFields: fields
        .filter((field) => !field.system && Object.prototype.hasOwnProperty.call(dynamicValues, field.key))
        .map((field) => ({ fieldId: field.id, fieldValue: dynamicValues[field.key] })),
      products,
      createTime: Number(row.createTime),
      updateTime: Number(row.updateTime),
      organizationId: row.organizationId,
    }
  }
}
