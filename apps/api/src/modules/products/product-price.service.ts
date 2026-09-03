import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  FieldVO,
  FilterCondition,
  ImportResultVO,
  ProductPriceVO,
} from '@micromatrix/shared'
import { randomUUID } from 'node:crypto'
import type { AuthUser } from '../../common/auth-user'
import type { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import { formatForExport } from '../../common/export-format'
import { Prisma, ProductPrice } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import {
  SpreadsheetService,
  type ParsedSubTableSpreadsheetRow,
} from '../import-export/spreadsheet.service'
import { MetadataService } from '../metadata/metadata.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import type {
  ProductPriceAddDto,
  ProductPriceExportDto,
  ProductPriceExportSelectDto,
  ProductPriceItemDto,
  ProductPricePageDto,
  ProductPriceSortDto,
  ProductPriceUpdateDto,
} from './dto/product-price.dto'
import { ProductPriceFieldsService } from './product-price-fields.service'

const MODULE = 'price'
const POS_STEP = 4096
const PRICE_SUB_KEYS = ['product', 'priceProductSku', 'amount', 'priceProductTax'] as const

interface PriceImportGroup {
  key: string
  rowNum: number
  resourceId?: string
  values: Record<string, unknown>
  subRows: Array<{ rowNum: number; values: Record<string, unknown> }>
  errors: string[]
}

@Injectable()
export class ProductPriceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metadata: MetadataService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly productFields: ProductPriceFieldsService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  getModuleForm(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, MODULE)
  }

  async page(user: AuthUser, dto: ProductPricePageDto) {
    const result = await this.findAll(user, dto)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    return {
      list: result.items,
      total: result.total,
      current: result.page,
      pageSize: result.pageSize,
      optionMap: Object.fromEntries(
        fields.filter((field) => field.options?.length).map((field) => [field.key, field.options]),
      ),
    }
  }

  async get(user: AuthUser, id: string): Promise<ProductPriceVO> {
    const price = await this.ensureExists(user, id)
    const [fields, values, products] = await Promise.all([
      this.metadata.listFields(user.tenantId, MODULE),
      this.fieldValues.load(user.tenantId, 'productPrice', [id]),
      this.productFields.loadProducts(user.tenantId, id),
    ])
    return this.toVO(price, fields, values.get(id) ?? {}, products)
  }

  async add(user: AuthUser, dto: ProductPriceAddDto): Promise<ProductPriceVO> {
    const name = dto.name.trim()
    await this.assertNameUnique(user.tenantId, name)
    const customData = await this.moduleFieldsToCustomData(user, dto.moduleFields)
    const now = BigInt(Date.now())
    const pos = await this.nextPos(user.tenantId)
    const created = await this.prisma.$transaction(async (tx) => {
      const price = await tx.productPrice.create({
        data: {
          name,
          status: dto.status,
          pos,
          organizationId: user.tenantId,
          createTime: now,
          updateTime: now,
          createUser: user.id,
          updateUser: user.id,
        },
      })
      await this.fieldValues.save(
        user.tenantId,
        'productPrice',
        price.id,
        customData,
        'create',
        tx,
      )
      await this.productFields.saveProducts(user.tenantId, price.id, dto.products ?? [], tx)
      return price
    })
    return this.get(user, created.id)
  }

  async update(user: AuthUser, dto: ProductPriceUpdateDto): Promise<ProductPriceVO> {
    const existing = await this.ensureExists(user, dto.id)
    const name = dto.name === undefined ? undefined : dto.name.trim()
    if (name !== undefined) {
      if (!name) throw new BadRequestException('价格表名称不能为空')
      await this.assertNameUnique(user.tenantId, name, existing.id)
    }
    const customData =
      dto.moduleFields === undefined
        ? undefined
        : await this.moduleFieldsToCustomData(user, dto.moduleFields)
    await this.prisma.$transaction(async (tx) => {
      await tx.productPrice.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData !== undefined) {
        await this.fieldValues.save(
          user.tenantId,
          'productPrice',
          existing.id,
          customData,
          'update',
          tx,
        )
      }
      if (dto.products !== undefined) {
        await this.productFields.saveProducts(user.tenantId, existing.id, dto.products, tx)
      }
    })
    return this.get(user, existing.id)
  }

  async copy(user: AuthUser, id: string) {
    const source = await this.get(user, id)
    const base = source.name.length > 243 ? source.name.slice(0, 243) : source.name
    const suffix = randomUUID().replaceAll('-', '').slice(0, 6)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const moduleFields = fields
      .filter((field) => !field.system && source.customData[field.key] !== undefined)
      .map((field) => ({ fieldId: field.id, fieldValue: source.customData[field.key] }))
    return this.add(user, {
      name: `${base}_copy_${suffix}`,
      status: source.status,
      moduleFields,
      products: source.products.map((item) => ({
        product: item.productId,
        amount: item.amount,
        values: item.values,
      })),
    })
  }

  async delete(user: AuthUser, id: string) {
    const price = await this.ensureExists(user, id)
    const [quotationField, quotationBlobField] = await Promise.all([
      this.prisma.opportunityQuotationField.findFirst({
        where: {
          fieldValue: id,
          resource: { organizationId: user.tenantId },
        },
        select: { id: true },
      }),
      this.prisma.opportunityQuotationFieldBlob.findFirst({
        where: {
          fieldValue: id,
          resource: { organizationId: user.tenantId },
        },
        select: { id: true },
      }),
    ])
    if (quotationField || quotationBlobField) {
      throw new BadRequestException('价格表已被报价单关联，无法删除！')
    }
    await this.prisma.productPrice.delete({ where: { id: price.id } })
    return { id: price.id, name: price.name }
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto) {
    const ids = [...new Set(dto.ids)]
    const rows = await this.prisma.productPrice.findMany({
      where: { organizationId: user.tenantId, id: { in: ids } },
      select: { id: true },
    })
    if (rows.length !== ids.length) throw new BadRequestException('选中价格表包含不存在的数据')
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.type === 'formula' || field.hidden) {
      throw new BadRequestException('字段不存在或不支持批量修改')
    }
    if (!field.system) {
      return this.prisma.$transaction((tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'productPrice',
          ids,
          field.id,
          dto.fieldValue,
          tx,
        ),
      )
    }
    const data = await this.systemBatchUpdateData(user, field.key, dto.fieldValue, ids)
    const result = await this.prisma.productPrice.updateMany({
      where: { organizationId: user.tenantId, id: { in: ids } },
      data: { ...data, updateTime: BigInt(Date.now()), updateUser: user.id },
    })
    return { count: result.count }
  }

  async editPos(user: AuthUser, dto: ProductPriceSortDto) {
    if (dto.dragNodeId === dto.dropNodeId) return { id: dto.dragNodeId }
    const rows = await this.prisma.productPrice.findMany({
      where: { organizationId: user.tenantId },
      orderBy: [{ pos: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })
    const ordered = rows.map((row) => row.id)
    const dragIndex = ordered.indexOf(dto.dragNodeId)
    if (dragIndex < 0) throw new NotFoundException('价格表不存在')
    ordered.splice(dragIndex, 1)
    const targetIndex = dto.dropNodeId ? ordered.indexOf(dto.dropNodeId) : -1
    if (dto.dropNodeId && targetIndex < 0) throw new NotFoundException('目标价格表不存在')
    const insertAt =
      targetIndex < 0 ? ordered.length : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    ordered.splice(insertAt, 0, dto.dragNodeId)
    const now = BigInt(Date.now())
    await this.prisma.$transaction(
      ordered.map((priceId, index) =>
        this.prisma.productPrice.update({
          where: { id: priceId },
          data: { pos: BigInt((index + 1) * POS_STEP), updateTime: now, updateUser: user.id },
        }),
      ),
    )
    return { id: dto.dragNodeId, pos: (insertAt + 1) * POS_STEP }
  }

  async exportAll(user: AuthUser, dto: ProductPriceExportDto) {
    return this.exportXlsx(user, dto, { fileName: dto.fileName, headList: dto.headList })
  }

  async exportSelected(user: AuthUser, dto: ProductPriceExportSelectDto) {
    return this.exportXlsx(user, {}, { fileName: dto.fileName, headList: dto.headList, ids: dto.ids })
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const { mainFields, subFields, parent } = this.spreadsheetFields(fields)
    const data = await this.spreadsheet.buildSubTableImportTemplate(
      mainFields,
      subFields,
      importType,
      parent.label,
    )
    return {
      filename: `价格表${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
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
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
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

  private async findAll(user: AuthUser, dto: ProductPricePageDto) {
    const page = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const filteredIds = dto.filters?.length
      ? await this.filterIds(user.tenantId, fields, dto.filters)
      : null
    const where: Prisma.ProductPriceWhereInput = {
      organizationId: user.tenantId,
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.keyword ? { name: { contains: dto.keyword, mode: 'insensitive' } } : {}),
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productPrice.findMany({
        where,
        orderBy: [{ pos: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.productPrice.count({ where }),
    ])
    const values = await this.fieldValues.load(
      user.tenantId,
      'productPrice',
      rows.map((row) => row.id),
    )
    return {
      items: rows.map((row) => this.toVO(row, fields, values.get(row.id) ?? {}, [])),
      total,
      page,
      pageSize,
    }
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<ProductPricePageDto>,
    input: { fileName: string; headList: string[]; ids?: string[] },
  ) {
    return this.exportTasks.enqueue(user, {
      module: 'price',
      fileName: input.fileName,
      payload: {
        version: 1,
        query,
        input: { headList: input.headList, ids: input.ids },
      },
    })
  }

  async buildQueuedExport(
    user: AuthUser,
    payload: QueuedExportTaskPayload,
  ): Promise<ExportBuildResult> {
    return this.buildExportXlsx(
      user,
      payload.query as Partial<ProductPricePageDto>,
      payload.input as { headList: string[]; ids?: string[] },
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<ProductPricePageDto>,
    input: { headList: string[]; ids?: string[] },
  ): Promise<ExportBuildResult> {
    const items = await this.collectExportItems(user, query, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const { parent } = this.spreadsheetFields(fields)
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const subKeySet = new Set<string>(PRICE_SUB_KEYS)
    const extraColumns = new Map([
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
      ['createUser', '创建人'],
      ['updateUser', '更新人'],
    ])
    const mainColumns: Array<{ key: string; label: string }> = []
    const subColumns: Array<{ key: string; label: string }> = []
    for (const key of input.headList) {
      const field = fieldMap.get(key)
      const label = extraColumns.get(key)
      if (subKeySet.has(key)) {
        if (!field) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
        subColumns.push({ key, label: field.label })
        continue
      }
      if ((!field || field.hidden) && !label) {
        throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      }
      mainColumns.push({ key, label: field?.label ?? (label as string) })
    }

    const mainRows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        mainColumns.map((column) => {
          const field = fieldMap.get(column.key)
          if (field) return [column.key, formatForExport(field, source)]
          return [column.key, source[column.key] ?? '']
        }),
      )
    })
    if (!subColumns.length) {
      return {
        data: await this.spreadsheet.buildExportWorkbook(mainColumns, mainRows),
        rowCount: items.length,
      }
    }

    const productsMap = await this.productFields.loadProductsBatch(
      user.tenantId,
      items.map((item) => item.id),
    )
    const groups = items.map((item, index) => ({
      values: mainRows[index] ?? {},
      subRows: (productsMap.get(item.id) ?? []).map((product) => ({
        product: product.productName ?? product.productId,
        amount: product.amount,
        priceProductSku: product.values['priceProductSku'],
        priceProductTax: product.values['priceProductTax'],
      })),
    }))
    const data = await this.spreadsheet.buildSubTableExportWorkbook(
      mainColumns,
      subColumns,
      groups,
      parent.label,
    )
    return { data, rowCount: items.length }
  }

  private async collectExportItems(
    user: AuthUser,
    query: Partial<ProductPricePageDto>,
    ids?: string[],
  ) {
    const all: ProductPriceVO[] = []
    let current = 1
    const pageSize = 500
    while (true) {
      const result = await this.findAll(user, { ...query, current, pageSize })
      all.push(...result.items)
      if (all.length >= result.total || !result.items.length) break
      current++
    }
    if (!ids?.length) return all
    const wanted = new Set(ids)
    const selected = all.filter((item) => wanted.has(item.id))
    if (selected.length !== wanted.size) throw new BadRequestException('选中数据包含不存在的价格表')
    return selected
  }

  private spreadsheetFields(fields: FieldVO[]) {
    const parent = fields.find((field) => field.key === 'products')
    const subFields = PRICE_SUB_KEYS.map((key) => fields.find((field) => field.key === key))
    if (!parent || subFields.some((field) => !field)) {
      throw new BadRequestException('价格表产品子表字段配置不完整')
    }
    const subKeySet = new Set<string>(['products', ...PRICE_SUB_KEYS])
    return {
      parent,
      subFields: subFields as FieldVO[],
      mainFields: fields.filter((field) => !subKeySet.has(field.key)),
    }
  }

  private groupImportRows(rows: ParsedSubTableSpreadsheetRow[], importType: ImportType) {
    const groups: PriceImportGroup[] = []
    let current: PriceImportGroup | undefined
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
          errors: [importType === 'UPDATE' ? '唯一ID不能为空' : '价格表名称不能为空'],
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
          current.errors.push(`第 ${row.rowNum} 行主字段「${key}」与同一价格表前序行不一致`)
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
    group: PriceImportGroup,
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
    const products: ProductPriceItemDto[] = []
    for (const row of group.subRows) {
      const productRef = row.values['product']
      const amountValue = row.values['amount']
      if (productRef === undefined || String(productRef).trim() === '') {
        throw new BadRequestException(`第 ${row.rowNum} 行：产品不能为空`)
      }
      if (amountValue === undefined || amountValue === null || amountValue === '') {
        throw new BadRequestException(`第 ${row.rowNum} 行：产品定价不能为空`)
      }
      const amount = Number(amountValue)
      if (!Number.isFinite(amount) || amount < 0) {
        throw new BadRequestException(`第 ${row.rowNum} 行：产品定价必须是大于等于 0 的数字`)
      }
      const product = await this.resolveImportedProduct(user.tenantId, String(productRef).trim())
      const values = Object.fromEntries(
        Object.entries(row.values).filter(
          ([key, value]) => !['product', 'amount'].includes(key) && value !== undefined,
        ),
      )
      products.push({ product: product.id, amount, ...(Object.keys(values).length ? { values } : {}) })
    }
    prepared.add.products = products
    if (group.subRows.length > 0) prepared.update.products = products
    return prepared
  }

  private async resolveImportedProduct(organizationId: string, productRef: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        organizationId,
        OR: [{ id: productRef }, { name: productRef }],
      },
      select: { id: true, name: true },
    })
    if (!product) throw new BadRequestException(`产品「${productRef}」不存在`)
    return product
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ): Promise<{ add: ProductPriceAddDto; update: Omit<ProductPriceUpdateDto, 'id'> }> {
    if (importType === 'UPDATE' && !resourceId) throw new BadRequestException('唯一ID不能为空')
    const moduleFields = fields
      .filter((field) => !field.system && values[field.key] !== undefined)
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
    const name = values['name'] === undefined ? undefined : String(values['name']).trim()
    if (importType === 'ADD' && !name) throw new BadRequestException('价格表名称不能为空')
    const rawStatus = values['status']
    const status = rawStatus === undefined || rawStatus === '' ? undefined : String(rawStatus)
    if (status !== undefined && !['1', '2'].includes(status)) throw new BadRequestException('价格表状态无效')
    const add: ProductPriceAddDto = {
      name: name ?? '',
      status: (status ?? '1') as '1' | '2',
      moduleFields,
      products: [],
    }
    const update: Omit<ProductPriceUpdateDto, 'id'> = {
      ...(name !== undefined ? { name } : {}),
      ...(status !== undefined ? { status: status as '1' | '2' } : {}),
      ...(moduleFields.length ? { moduleFields } : {}),
    }
    if (resourceId) await this.ensureExists(user, resourceId)
    return { add, update }
  }

  private async moduleFieldsToCustomData(
    user: AuthUser,
    moduleFields?: Array<{ fieldId: string; fieldValue?: unknown }>,
  ) {
    if (!moduleFields?.length) return {}
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const map = new Map(
      fields
        .filter((field) => !field.system)
        .flatMap((field) => [
          [field.id, field],
          [field.key, field],
        ]),
    )
    const values: Record<string, unknown> = {}
    for (const item of moduleFields) {
      const field = map.get(item.fieldId)
      if (!field) throw new BadRequestException(`动态字段不存在：${item.fieldId}`)
      values[field.key] = item.fieldValue
    }
    return values
  }

  private async systemBatchUpdateData(
    user: AuthUser,
    key: string,
    value: unknown,
    ids: string[],
  ): Promise<Prisma.ProductPriceUpdateManyMutationInput> {
    if (key === 'name') {
      const name = String(value ?? '').trim()
      if (!name) throw new BadRequestException('价格表名称不能为空')
      if (ids.length > 1) throw new BadRequestException('唯一价格表名称不能批量设置为相同值')
      await this.assertNameUnique(user.tenantId, name, ids[0])
      return { name }
    }
    if (key === 'status') {
      const status = String(value ?? '')
      if (!['1', '2'].includes(status)) throw new BadRequestException('价格表状态无效')
      return { status }
    }
    throw new BadRequestException(`字段「${key}」不支持批量修改`)
  }

  private async filterIds(organizationId: string, fields: FieldVO[], conditions: FilterCondition[]) {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        const field = fieldMap.get(condition.key)
        if (!field || field.hidden) return new Set<string>()
        if (!field.system) {
          return new Set(
            await this.fieldValues.filterResourceIds(organizationId, 'productPrice', [condition]),
          )
        }
        const clause = this.systemFilterClause(condition)
        if (!clause) return new Set<string>()
        const rows = await this.prisma.productPrice.findMany({
          where: { organizationId, AND: [clause] },
          select: { id: true },
        })
        return new Set(rows.map((row) => row.id))
      }),
    )
    if (!sets.length) return []
    return [
      ...sets
        .slice(1)
        .reduce(
          (result, set) => new Set([...result].filter((id) => set.has(id))),
          sets[0]!,
        ),
    ]
  }

  private systemFilterClause(condition: FilterCondition): Prisma.ProductPriceWhereInput | null {
    const key = condition.key as 'name' | 'status'
    if (!['name', 'status'].includes(key)) return null
    if (condition.op === 'eq') return { [key]: { equals: condition.value as never } } as Prisma.ProductPriceWhereInput
    if (condition.op === 'ne') return { NOT: { [key]: { equals: condition.value as never } } } as Prisma.ProductPriceWhereInput
    if (condition.op === 'contains' && key === 'name') {
      return { name: { contains: String(condition.value), mode: 'insensitive' } }
    }
    if (condition.op === 'isEmpty') return { [key]: null } as Prisma.ProductPriceWhereInput
    if (condition.op === 'notEmpty') return { NOT: { [key]: null } } as Prisma.ProductPriceWhereInput
    return null
  }

  private async nextPos(organizationId: string) {
    const row = await this.prisma.productPrice.findFirst({
      where: { organizationId },
      orderBy: { pos: 'desc' },
      select: { pos: true },
    })
    return (row?.pos ?? 0n) + BigInt(POS_STEP)
  }

  private async assertNameUnique(organizationId: string, name: string, excludeId?: string) {
    const row = await this.prisma.productPrice.findFirst({
      where: { organizationId, name, ...(excludeId ? { NOT: { id: excludeId } } : {}) },
      select: { id: true },
    })
    if (row) throw new BadRequestException('价格表名称不能重复')
  }

  private async ensureExists(user: AuthUser, id: string) {
    const row = await this.prisma.productPrice.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!row) throw new NotFoundException('价格表不存在')
    return row
  }

  private toVO(
    price: ProductPrice,
    fields: FieldVO[],
    customData: Record<string, unknown>,
    products: ProductPriceVO['products'],
  ): ProductPriceVO {
    const formulas = this.metadata.computeFormulas(
      fields,
      { name: price.name, status: price.status },
      customData,
    )
    return {
      id: price.id,
      name: price.name,
      status: price.status as ProductPriceVO['status'],
      pos: Number(price.pos),
      customData: { ...customData, ...formulas },
      products,
      createdAt: new Date(Number(price.createTime)).toISOString(),
      updatedAt: new Date(Number(price.updateTime)).toISOString(),
      createUser: price.createUser,
      updateUser: price.updateUser,
    }
  }
}
