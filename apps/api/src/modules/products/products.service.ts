import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { FieldVO, FilterCondition, ImportResultVO, ProductVO } from '@micromatrix/shared'
import { not } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import type { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import { formatForExport } from '../../common/export-format'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Numeric } from '../../prisma/prisma8-values'
import { createLegacyId32 } from '../../common/legacy-id'
import {
  ExportTasksService,
  type ExportBuildResult,
  type QueuedExportTaskPayload,
} from '../import-export/export-tasks.service'
import type { ImportType } from '../import-export/dto/import-export.dto'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { MetadataService } from '../metadata/metadata.service'
import { ModuleFormsService } from '../metadata/module-forms.service'
import { ResourceFieldValueService } from '../metadata/resource-field-value.service'
import {
  ProductAddDto,
  ProductExportDto,
  ProductExportSelectDto,
  ProductPageDto,
  ProductSortDto,
  ProductUpdateDto,
} from './dto/product.dto'

const MODULE = 'product'
const POS_STEP = 4096

interface ProductRow {
  id: string
  name: string
  price: unknown | null
  status: string
  pos: bigint
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly metadata: MetadataService,
    private readonly moduleForms: ModuleFormsService,
    private readonly fieldValues: ResourceFieldValueService,
    private readonly spreadsheet: SpreadsheetService,
    private readonly exportTasks: ExportTasksService,
  ) {}

  getModuleForm(user: AuthUser) {
    return this.moduleForms.getConfig(user.tenantId, MODULE)
  }

  async page(user: AuthUser, dto: ProductPageDto) {
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

  async get(user: AuthUser, id: string): Promise<ProductVO> {
    const product = await this.ensureExists(user, id)
    const [fields, values] = await Promise.all([
      this.metadata.listFields(user.tenantId, MODULE),
      this.fieldValues.load(user.tenantId, 'product', [id]),
    ])
    return this.toVO(product, fields, values.get(id) ?? {})
  }

  async add(user: AuthUser, dto: ProductAddDto): Promise<ProductVO> {
    const name = dto.name.trim()
    await this.assertNameUnique(user.tenantId, name)
    const customData = await this.moduleFieldsToCustomData(user, dto.moduleFields)
    const now = BigInt(Date.now())
    const pos = await this.nextPos(user.tenantId)
    const product = await this.prisma8.client.transaction(async (tx) => {
      const created = await tx.orm.public.Product.create({
        id: createLegacyId32(),
        name: name,
        price:
          dto.price === undefined || dto.price === null ? null : prisma8Numeric(dto.price, 14, 4),
        status: dto.status,
        pos,
        organizationId: user.tenantId,
        createTime: now,
        updateTime: now,
        createUser: user.id,
        updateUser: user.id,
      })
      await this.fieldValues.save(
        user.tenantId,
        'product',
        created.id,
        customData,
        'create',
        tx,
        user.id,
      )
      return created
    })
    return this.get(user, product.id)
  }

  async update(user: AuthUser, dto: ProductUpdateDto): Promise<ProductVO> {
    const existing = await this.ensureExists(user, dto.id)
    const name = dto.name === undefined ? undefined : dto.name.trim()
    if (name !== undefined) {
      if (!name) throw new BadRequestException('产品名称不能为空')
      await this.assertNameUnique(user.tenantId, name, existing.id)
    }
    const customData =
      dto.moduleFields === undefined
        ? undefined
        : await this.moduleFieldsToCustomData(user, dto.moduleFields)
    await this.prisma8.client.transaction(async (tx) => {
      await tx.orm.public.Product.where({ id: existing.id }).update({
        ...(name !== undefined ? { name: name } : {}),
        ...(dto.price !== undefined
          ? { price: dto.price === null ? null : prisma8Numeric(dto.price, 14, 4) }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
      if (customData !== undefined) {
        await this.fieldValues.save(
          user.tenantId,
          'product',
          existing.id,
          customData,
          'update',
          tx,
          user.id,
        )
      }
    })
    return this.get(user, existing.id)
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto) {
    const ids = [...new Set(dto.ids)]
    const rows = ids.length
      ? await this.prisma8.client.orm.public.Product.where({
          organizationId: user.tenantId,
        })
          .where((row) => row.id.in(ids))
          .select('id')
          .all()
      : []
    if (rows.length !== ids.length) throw new BadRequestException('选中产品包含不存在的数据')
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.type === 'formula' || field.hidden) {
      throw new BadRequestException('字段不存在或不支持批量修改')
    }
    if (!field.system) {
      return this.prisma8.client.transaction((tx) =>
        this.fieldValues.saveBatch(user.tenantId, 'product', ids, field.id, dto.fieldValue, tx),
      )
    }
    const data = await this.systemBatchUpdateData(user, field.key, dto.fieldValue, ids)
    const count = await this.prisma8.client.orm.public.Product.where({
      organizationId: user.tenantId,
    })
      .where((row) => row.id.in(ids))
      .updateAndCount({
        ...data,
        updateTime: BigInt(Date.now()),
        updateUser: user.id,
      })
    return { count }
  }

  async delete(user: AuthUser, id: string) {
    const product = await this.ensureExists(user, id)
    await this.prisma8.client.orm.public.Product.where({
      id: product.id,
      organizationId: user.tenantId,
    }).delete()
    return { id: product.id, name: product.name }
  }

  async batchDelete(user: AuthUser, ids: string[]) {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new BadRequestException('请选择产品')
    const rows = await this.prisma8.client.orm.public.Product.where({
      organizationId: user.tenantId,
    })
      .where((row) => row.id.in(uniqueIds))
      .select('id')
      .all()
    if (rows.length !== uniqueIds.length) throw new BadRequestException('选中产品包含不存在的数据')
    const count = await this.prisma8.client.orm.public.Product.where((row) =>
      row.id.in(uniqueIds),
    ).deleteAndCount()
    return { count }
  }

  async editPos(user: AuthUser, dto: ProductSortDto) {
    if (dto.dragNodeId === dto.dropNodeId) return { id: dto.dragNodeId }
    const rows = await this.prisma8.client.orm.public.Product.where({
      organizationId: user.tenantId,
    })
      .orderBy([(row) => row.pos.asc(), (row) => row.id.asc()])
      .select('id')
      .all()
    const ordered = rows.map((row) => String(row.id))
    const dragIndex = ordered.indexOf(dto.dragNodeId)
    if (dragIndex < 0) throw new NotFoundException('产品不存在')
    ordered.splice(dragIndex, 1)
    const targetIndex = dto.dropNodeId ? ordered.indexOf(dto.dropNodeId) : -1
    if (dto.dropNodeId && targetIndex < 0) throw new NotFoundException('目标产品不存在')
    const insertAt =
      targetIndex < 0 ? ordered.length : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    ordered.splice(insertAt, 0, dto.dragNodeId)
    const now = BigInt(Date.now())
    await this.prisma8.client.transaction(async (tx) => {
      for (const [index, id] of ordered.entries()) {
        await tx.orm.public.Product.where({ id: id }).update({
          pos: BigInt((index + 1) * POS_STEP),
          updateTime: now,
          updateUser: user.id,
        })
      }
    })
    return { id: dto.dragNodeId, pos: (insertAt + 1) * POS_STEP }
  }

  async listOption(user: AuthUser) {
    return this.prisma8.client.orm.public.Product.where({
      organizationId: user.tenantId,
    })
      .orderBy([(row) => row.pos.asc(), (row) => row.id.asc()])
      .select('id', 'name')
      .all()
  }

  async exportAll(user: AuthUser, dto: ProductExportDto) {
    return this.exportXlsx(user, dto, { fileName: dto.fileName, headList: dto.headList })
  }

  async exportSelected(user: AuthUser, dto: ProductExportSelectDto) {
    return this.exportXlsx(
      user,
      {},
      { fileName: dto.fileName, headList: dto.headList, ids: dto.ids },
    )
  }

  async importTemplate(user: AuthUser, importType: ImportType) {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const data = await this.spreadsheet.buildImportTemplate(fields, importType)
    return {
      filename: `产品${importType === 'ADD' ? '导入新建' : '导入更新'}模板.xlsx`,
      data,
    }
  }

  async precheckImportXlsx(
    user: AuthUser,
    file: Buffer,
    importType: ImportType,
  ): Promise<ImportResultVO> {
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
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
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
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

  private async findAll(user: AuthUser, dto: ProductPageDto) {
    const page = dto.current ?? 1
    const pageSize = dto.pageSize ?? 10
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const filteredIds = dto.filters?.length
      ? await this.filterIds(user.tenantId, fields, dto.filters, dto.filterMode ?? 'AND')
      : null
    let query = this.prisma8.client.orm.public.Product.where({
      organizationId: user.tenantId,
    })
    if (dto.status) query = query.where({ status: dto.status })
    if (dto.keyword) query = query.where((row) => row.name.ilike(`%${dto.keyword}%`))
    if (filteredIds) query = query.where((row) => row.id.in(filteredIds))
    const [rows, aggregate] = await Promise.all([
      query
        .orderBy([(row) => row.pos.asc(), (row) => row.id.asc()])
        .offset((page - 1) * pageSize)
        .limit(pageSize)
        .all(),
      query.aggregate((value) => ({ count: value.count() })),
    ])
    const total = aggregate.count
    const values = await this.fieldValues.load(
      user.tenantId,
      'product',
      rows.map((row) => row.id),
    )
    return {
      items: rows.map((row) => this.toVO(row, fields, values.get(row.id) ?? {})),
      total,
      page,
      pageSize,
    }
  }

  private async exportXlsx(
    user: AuthUser,
    query: Partial<ProductPageDto>,
    input: { fileName: string; headList: string[]; ids?: string[] },
  ) {
    return this.exportTasks.enqueue(user, {
      module: 'product',
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
      payload.query as Partial<ProductPageDto>,
      payload.input as { headList: string[]; ids?: string[] },
    )
  }

  private async buildExportXlsx(
    user: AuthUser,
    query: Partial<ProductPageDto>,
    input: { headList: string[]; ids?: string[] },
  ): Promise<ExportBuildResult> {
    const items = await this.collectExportItems(user, query, input.ids)
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const fieldMap = new Map(
      fields
        .filter((field) => !field.hidden && field.type !== 'picture')
        .map((field) => [field.key, field]),
    )
    const extraColumns = new Map([
      ['createTime', '创建时间'],
      ['updateTime', '更新时间'],
      ['createUser', '创建人'],
      ['updateUser', '更新人'],
    ])
    const columns = input.headList.map((key) => {
      const field = fieldMap.get(key)
      const label = extraColumns.get(key)
      if (!field && !label) throw new BadRequestException(`导出字段「${key}」不存在或不可导出`)
      return { key, label: field?.label ?? (label as string) }
    })
    const rows = items.map((item) => {
      const source = item as unknown as Record<string, unknown>
      return Object.fromEntries(
        columns.map((column) => {
          const field = fieldMap.get(column.key)
          if (field) return [column.key, formatForExport(field, source)]
          return [column.key, source[column.key] ?? '']
        }),
      )
    })
    return {
      data: await this.spreadsheet.buildExportWorkbook(columns, rows),
      rowCount: items.length,
    }
  }

  private async collectExportItems(user: AuthUser, query: Partial<ProductPageDto>, ids?: string[]) {
    const all: ProductVO[] = []
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
    if (selected.length !== wanted.size) throw new BadRequestException('选中数据包含不存在的产品')
    return selected
  }

  private async prepareImportRow(
    user: AuthUser,
    values: Record<string, unknown>,
    fields: FieldVO[],
    importType: ImportType,
    resourceId?: string,
  ): Promise<{ add: ProductAddDto; update: Omit<ProductUpdateDto, 'id'> }> {
    if (importType === 'UPDATE' && !resourceId) throw new BadRequestException('唯一ID不能为空')
    const moduleFields = fields
      .filter((field) => !field.system && values[field.key] !== undefined)
      .map((field) => ({ fieldId: field.id, fieldValue: values[field.key] }))
    const name = values['name'] === undefined ? undefined : String(values['name']).trim()
    if (importType === 'ADD' && !name) throw new BadRequestException('产品名称不能为空')
    const priceValue = values['price']
    const price =
      priceValue === undefined || priceValue === null || priceValue === ''
        ? undefined
        : Number(priceValue)
    if (price !== undefined && (!Number.isFinite(price) || price <= 0)) {
      throw new BadRequestException('产品价格必须大于 0')
    }
    const rawStatus = values['status']
    const status = rawStatus === undefined || rawStatus === '' ? undefined : String(rawStatus)
    if (status !== undefined && !['1', '2'].includes(status))
      throw new BadRequestException('产品状态无效')
    const add: ProductAddDto = {
      name: name ?? '',
      price,
      status: (status ?? '1') as '1' | '2',
      ...(moduleFields.length ? { moduleFields } : {}),
    }
    const update: Omit<ProductUpdateDto, 'id'> = {
      ...(name !== undefined ? { name } : {}),
      ...(priceValue !== undefined ? { price } : {}),
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

  private async systemBatchUpdateData(user: AuthUser, key: string, value: unknown, ids: string[]) {
    if (key === 'name') {
      const name = String(value ?? '').trim()
      if (!name) throw new BadRequestException('产品名称不能为空')
      if (ids.length > 1) throw new BadRequestException('唯一产品名称不能批量设置为相同值')
      await this.assertNameUnique(user.tenantId, name, ids[0])
      return { name: name }
    }
    if (key === 'price') {
      if (value === null || value === '') return { price: null }
      const price = Number(value)
      if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('产品价格必须大于 0')
      return { price: prisma8Numeric(price, 14, 4) }
    }
    if (key === 'status') {
      const status = String(value ?? '')
      if (!['1', '2'].includes(status)) throw new BadRequestException('产品状态无效')
      return { status: status }
    }
    throw new BadRequestException(`字段「${key}」不支持批量修改`)
  }

  private async filterIds(
    organizationId: string,
    fields: FieldVO[],
    conditions: FilterCondition[],
    searchMode: 'AND' | 'OR' = 'AND',
  ) {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        const field = fieldMap.get(condition.key)
        if (!field) return new Set<string>()
        if (!field.system) {
          return new Set(
            await this.fieldValues.filterResourceIds(organizationId, 'product', [condition]),
          )
        }
        let query = this.prisma8.client.orm.public.Product.where({
          organizationId: organizationId,
        })
        query = this.applySystemFilter(query, field, condition)
        const rows = await query.select('id').all()
        return new Set(rows.map((row) => row.id))
      }),
    )
    if (!sets.length) return []
    if (searchMode === 'OR') return [...new Set(sets.flatMap((set) => [...set]))]
    return [
      ...sets
        .slice(1)
        .reduce((result, set) => new Set([...result].filter((id) => set.has(id))), sets[0]!),
    ]
  }

  private applySystemFilter(
    collection: ReturnType<typeof this.prisma8.client.orm.public.Product.where>,
    field: FieldVO,
    condition: FilterCondition,
  ) {
    const key = condition.key as 'name' | 'price' | 'status'
    if (!['name', 'price', 'status'].includes(key)) return collection.where((row) => row.id.eq(''))
    if (key === 'price') {
      if (condition.op === 'isEmpty') return collection.where((row) => row.price.isNull())
      if (condition.op === 'notEmpty') return collection.where((row) => row.price.isNotNull())
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => prisma8Numeric(Number(item), 14, 4),
      )
      const value = values[0]!
      if (condition.op === 'eq') return collection.where((row) => row.price.eq(value))
      if (condition.op === 'ne') return collection.where((row) => row.price.neq(value))
      if (condition.op === 'in') return collection.where((row) => row.price.in(values))
      if (condition.op === 'notIn') return collection.where((row) => not(row.price.in(values)))
      if (condition.op === 'gt') return collection.where((row) => row.price.gt(value))
      if (condition.op === 'gte') return collection.where((row) => row.price.gte(value))
      if (condition.op === 'lt') return collection.where((row) => row.price.lt(value))
      if (condition.op === 'lte') return collection.where((row) => row.price.lte(value))
      return collection.where((row) => row.id.eq(''))
    }
    if (condition.op === 'isEmpty') {
      return collection.where((row) => row.id.eq(''))
    }
    if (condition.op === 'notEmpty') return collection
    if (key === 'name') {
      const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
        (item) => String(item ?? ''),
      )
      const value = values[0]!
      if (condition.op === 'eq') return collection.where((row) => row.name.eq(value))
      if (condition.op === 'ne') return collection.where((row) => row.name.neq(value))
      if (condition.op === 'in') return collection.where((row) => row.name.in(values))
      if (condition.op === 'notIn') return collection.where((row) => not(row.name.in(values)))
      if (condition.op === 'contains')
        return collection.where((row) => row.name.ilike(`%${String(condition.value ?? '')}%`))
      if (condition.op === 'notContains')
        return collection.where((row) => not(row.name.ilike(`%${String(condition.value ?? '')}%`)))
      if (condition.op === 'gt') return collection.where((row) => row.name.gt(value))
      if (condition.op === 'gte') return collection.where((row) => row.name.gte(value))
      if (condition.op === 'lt') return collection.where((row) => row.name.lt(value))
      if (condition.op === 'lte') return collection.where((row) => row.name.lte(value))
      return collection.where((row) => row.id.eq(''))
    }
    const values = (Array.isArray(condition.value) ? condition.value : [condition.value]).map(
      (item) => String(item ?? ''),
    )
    const value = values[0]!
    if (condition.op === 'eq') return collection.where((row) => row.status.eq(value))
    if (condition.op === 'ne') return collection.where((row) => row.status.neq(value))
    if (condition.op === 'in') return collection.where((row) => row.status.in(values))
    if (condition.op === 'notIn') return collection.where((row) => not(row.status.in(values)))
    return collection.where((row) => row.id.eq(''))
  }

  private async nextPos(organizationId: string) {
    const row = await this.prisma8.client.orm.public.Product.where({
      organizationId: organizationId,
    })
      .orderBy((product) => product.pos.desc())
      .select('pos')
      .first()
    return (row?.pos ?? 0n) + BigInt(POS_STEP)
  }

  private async assertNameUnique(organizationId: string, name: string, excludeId?: string) {
    let query = this.prisma8.client.orm.public.Product.where({
      organizationId: organizationId,
      name: name,
    })
    if (excludeId) query = query.where((row) => row.id.neq(excludeId))
    const row = await query.select('id').first()
    if (row) throw new BadRequestException('产品名称不能重复')
  }

  private async ensureExists(user: AuthUser, id: string) {
    const product = await this.prisma8.client.orm.public.Product.where({
      id: id,
      organizationId: user.tenantId,
    }).first()
    if (!product) throw new NotFoundException('产品不存在')
    return product
  }

  private toVO(
    product: ProductRow,
    fields: FieldVO[],
    customData: Record<string, unknown>,
  ): ProductVO {
    const record: Record<string, unknown> = {
      name: product.name,
      price: product.price === null ? null : Number(product.price),
      status: product.status,
    }
    const formulas = this.metadata.computeFormulas(fields, record, customData)
    return {
      id: product.id,
      name: product.name,
      price: product.price === null ? null : Number(product.price),
      status: product.status as ProductVO['status'],
      pos: Number(product.pos),
      customData: { ...customData, ...formulas },
      createdAt: new Date(Number(product.createTime)).toISOString(),
      updatedAt: new Date(Number(product.updateTime)).toISOString(),
      createUser: product.createUser,
      updateUser: product.updateUser,
    }
  }
}
