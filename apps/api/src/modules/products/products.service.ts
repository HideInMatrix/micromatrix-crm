import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type {
  FieldVO,
  FilterCondition,
  ImportResultVO,
  ProductVO,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import type { ResourceBatchEditDto } from '../../common/dto/resource-batch.dto'
import { formatForExport } from '../../common/export-format'
import { Product, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
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

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
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
    const product = await this.prisma.$transaction(async (tx) => {
      const created = await tx.product.create({
        data: {
          name,
          price: dto.price ?? null,
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
        'product',
        created.id,
        customData,
        'create',
        tx,
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
    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({
        where: { id: existing.id },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(dto.price !== undefined ? { price: dto.price ?? null } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          updateTime: BigInt(Date.now()),
          updateUser: user.id,
        },
      })
      if (customData !== undefined) {
        await this.fieldValues.save(
          user.tenantId,
          'product',
          existing.id,
          customData,
          'update',
          tx,
        )
      }
    })
    return this.get(user, existing.id)
  }

  async batchUpdate(user: AuthUser, dto: ResourceBatchEditDto) {
    const ids = [...new Set(dto.ids)]
    const rows = await this.prisma.product.findMany({
      where: { organizationId: user.tenantId, id: { in: ids } },
      select: { id: true },
    })
    if (rows.length !== ids.length) throw new BadRequestException('选中产品包含不存在的数据')
    const fields = await this.metadata.listFields(user.tenantId, MODULE)
    const field = fields.find((item) => item.id === dto.fieldId || item.key === dto.fieldId)
    if (!field || field.type === 'formula' || field.hidden) {
      throw new BadRequestException('字段不存在或不支持批量修改')
    }
    if (!field.system) {
      return this.prisma.$transaction((tx) =>
        this.fieldValues.saveBatch(
          user.tenantId,
          'product',
          ids,
          field.id,
          dto.fieldValue,
          tx,
        ),
      )
    }
    const data = await this.systemBatchUpdateData(user, field.key, dto.fieldValue, ids)
    const result = await this.prisma.product.updateMany({
      where: { organizationId: user.tenantId, id: { in: ids } },
      data: { ...data, updateTime: BigInt(Date.now()), updateUser: user.id },
    })
    return { count: result.count }
  }

  async delete(user: AuthUser, id: string) {
    const product = await this.ensureExists(user, id)
    await this.prisma.product.delete({ where: { id: product.id } })
    return { id: product.id, name: product.name }
  }

  async batchDelete(user: AuthUser, ids: string[]) {
    const uniqueIds = [...new Set(ids)]
    if (!uniqueIds.length) throw new BadRequestException('请选择产品')
    const rows = await this.prisma.product.findMany({
      where: { organizationId: user.tenantId, id: { in: uniqueIds } },
      select: { id: true },
    })
    if (rows.length !== uniqueIds.length) throw new BadRequestException('选中产品包含不存在的数据')
    const result = await this.prisma.product.deleteMany({ where: { id: { in: uniqueIds } } })
    return { count: result.count }
  }

  async editPos(user: AuthUser, dto: ProductSortDto) {
    if (dto.dragNodeId === dto.dropNodeId) return { id: dto.dragNodeId }
    const rows = await this.prisma.product.findMany({
      where: { organizationId: user.tenantId },
      orderBy: [{ pos: 'asc' }, { id: 'asc' }],
      select: { id: true },
    })
    const ordered = rows.map((row) => row.id)
    const dragIndex = ordered.indexOf(dto.dragNodeId)
    if (dragIndex < 0) throw new NotFoundException('产品不存在')
    ordered.splice(dragIndex, 1)
    const targetIndex = dto.dropNodeId ? ordered.indexOf(dto.dropNodeId) : -1
    if (dto.dropNodeId && targetIndex < 0) throw new NotFoundException('目标产品不存在')
    const insertAt =
      targetIndex < 0 ? ordered.length : Math.max(0, targetIndex + (dto.dropPosition > 0 ? 1 : 0))
    ordered.splice(insertAt, 0, dto.dragNodeId)
    const now = BigInt(Date.now())
    await this.prisma.$transaction(
      ordered.map((id, index) =>
        this.prisma.product.update({
          where: { id },
          data: { pos: BigInt((index + 1) * POS_STEP), updateTime: now, updateUser: user.id },
        }),
      ),
    )
    return { id: dto.dragNodeId, pos: (insertAt + 1) * POS_STEP }
  }

  async listOption(user: AuthUser) {
    return this.prisma.product.findMany({
      where: { organizationId: user.tenantId },
      orderBy: [{ pos: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    })
  }

  async exportAll(user: AuthUser, dto: ProductExportDto) {
    return this.exportXlsx(user, dto, { fileName: dto.fileName, headList: dto.headList })
  }

  async exportSelected(user: AuthUser, dto: ProductExportSelectDto) {
    return this.exportXlsx(user, {}, { fileName: dto.fileName, headList: dto.headList, ids: dto.ids })
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
      ? await this.filterIds(user.tenantId, fields, dto.filters)
      : null
    const where: Prisma.ProductWhereInput = {
      organizationId: user.tenantId,
      ...(dto.status ? { status: dto.status } : {}),
      ...(dto.keyword ? { name: { contains: dto.keyword, mode: 'insensitive' } } : {}),
      ...(filteredIds ? { id: { in: filteredIds } } : {}),
    }
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ pos: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ])
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

  private async collectExportItems(
    user: AuthUser,
    query: Partial<ProductPageDto>,
    ids?: string[],
  ) {
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
    if (status !== undefined && !['1', '2'].includes(status)) throw new BadRequestException('产品状态无效')
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

  private async systemBatchUpdateData(
    user: AuthUser,
    key: string,
    value: unknown,
    ids: string[],
  ): Promise<Prisma.ProductUpdateManyMutationInput> {
    if (key === 'name') {
      const name = String(value ?? '').trim()
      if (!name) throw new BadRequestException('产品名称不能为空')
      if (ids.length > 1) throw new BadRequestException('唯一产品名称不能批量设置为相同值')
      await this.assertNameUnique(user.tenantId, name, ids[0])
      return { name }
    }
    if (key === 'price') {
      if (value === null || value === '') return { price: null }
      const price = Number(value)
      if (!Number.isFinite(price) || price <= 0) throw new BadRequestException('产品价格必须大于 0')
      return { price }
    }
    if (key === 'status') {
      const status = String(value ?? '')
      if (!['1', '2'].includes(status)) throw new BadRequestException('产品状态无效')
      return { status }
    }
    throw new BadRequestException(`字段「${key}」不支持批量修改`)
  }

  private async filterIds(organizationId: string, fields: FieldVO[], conditions: FilterCondition[]) {
    const fieldMap = new Map(fields.map((field) => [field.key, field]))
    const sets = await Promise.all(
      conditions.map(async (condition) => {
        const field = fieldMap.get(condition.key)
        if (!field) return new Set<string>()
        if (!field.system) {
          return new Set(await this.fieldValues.filterResourceIds(organizationId, 'product', [condition]))
        }
        const clause = this.systemFilterClause(field, condition)
        if (!clause) return new Set<string>()
        const rows = await this.prisma.product.findMany({
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

  private systemFilterClause(field: FieldVO, condition: FilterCondition): Prisma.ProductWhereInput | null {
    const key = condition.key as 'name' | 'price' | 'status'
    if (!['name', 'price', 'status'].includes(key)) return null
    const value = field.type === 'currency' || field.type === 'number' ? Number(condition.value) : condition.value
    if (condition.op === 'eq') return { [key]: { equals: value as never } } as Prisma.ProductWhereInput
    if (condition.op === 'ne') return { NOT: { [key]: { equals: value as never } } } as Prisma.ProductWhereInput
    if (condition.op === 'contains' && key === 'name') {
      return { name: { contains: String(condition.value), mode: 'insensitive' } }
    }
    if (condition.op === 'gt') return { [key]: { gt: value as never } } as Prisma.ProductWhereInput
    if (condition.op === 'gte') return { [key]: { gte: value as never } } as Prisma.ProductWhereInput
    if (condition.op === 'lt') return { [key]: { lt: value as never } } as Prisma.ProductWhereInput
    if (condition.op === 'lte') return { [key]: { lte: value as never } } as Prisma.ProductWhereInput
    if (condition.op === 'isEmpty') return { [key]: null } as Prisma.ProductWhereInput
    if (condition.op === 'notEmpty') return { NOT: { [key]: null } } as Prisma.ProductWhereInput
    return null
  }

  private async nextPos(organizationId: string) {
    const row = await this.prisma.product.findFirst({
      where: { organizationId },
      orderBy: { pos: 'desc' },
      select: { pos: true },
    })
    return (row?.pos ?? 0n) + BigInt(POS_STEP)
  }

  private async assertNameUnique(organizationId: string, name: string, excludeId?: string) {
    const row = await this.prisma.product.findFirst({
      where: {
        organizationId,
        name,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (row) throw new BadRequestException('产品名称不能重复')
  }

  private async ensureExists(user: AuthUser, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, organizationId: user.tenantId },
    })
    if (!product) throw new NotFoundException('产品不存在')
    return product
  }

  private toVO(product: Product, fields: FieldVO[], customData: Record<string, unknown>): ProductVO {
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
