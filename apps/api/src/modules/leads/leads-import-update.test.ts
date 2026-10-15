import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { FieldVO } from '@micromatrix/shared'
import ExcelJS from 'exceljs'
import { SpreadsheetService } from '../import-export/spreadsheet.service'
import { LeadsService } from './leads.service'

const user = { id: 'user-a', tenantId: 'tenant-a' } as AuthUser

function field(key: string, label: string, overrides: Partial<FieldVO> = {}): FieldVO {
  return {
    id: key,
    key,
    label,
    module: 'lead',
    type: 'text',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    ...overrides,
  }
}

const fields = [
  field('name', '线索名称', { required: true, system: true }),
  field('contact', '联系人', { system: true }),
  field('phone', '电话', { system: true, type: 'phone', config: { unique: true } }),
  field('owner', '负责人', { system: true, type: 'member' }),
  field('cf_gender', '性别', {
    type: 'select',
    options: [
      { label: '男', value: 'M' },
      { label: '女', value: 'F' },
    ],
  }),
]

async function sampleFile(withId = false, phone = 1313131): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('导入模板')
  sheet.addRow([...(withId ? ['唯一ID'] : []), '线索名称', '联系人', '电话', '负责人', '性别'])
  sheet.addRow([...(withId ? ['lead-1'] : []), '更新姓名', '测', phone, null, '男'])
  return Buffer.from(await book.xlsx.writeBuffer())
}

interface TestHarness {
  service: LeadsService
  updated: Array<{ id: string; name?: string; gender?: unknown }>
  created: Array<Record<string, unknown>>
  validatedIds: string[]
}

function harness(options?: { matchingPhones?: string[]; uniquePhone?: boolean }): TestHarness {
  const data = (options?.matchingPhones ?? ['1313131']).map((phone, index) => ({
    id: `lead-${index + 1}`,
    name: '旧线索',
    contact: '测',
    phone,
    owner: 'user-a',
    organizationId: 'tenant-a',
    inSharedPool: false,
    poolId: null,
  }))
  const updated: TestHarness['updated'] = []
  const created: TestHarness['created'] = []
  const validatedIds: string[] = []
  const configuredFields = fields.map((item) =>
    item.key === 'phone'
      ? { ...item, config: options?.uniquePhone === false ? {} : { unique: true } }
      : item,
  )

  function query(conditions: Record<string, unknown>) {
    let limit = Number.POSITIVE_INFINITY
    const applied = { ...conditions }
    const result = () =>
      data
        .filter((row) =>
          Object.entries(applied).every(([key, value]) => {
            if (key === 'poolId') return row.poolId === value
            return row[key as keyof typeof row] === value
          }),
        )
        .slice(0, limit)
    const builder = {
      where(next: Record<string, unknown>) {
        Object.assign(applied, next)
        return builder
      },
      select(..._keys: string[]) {
        return builder
      },
      limit(count: number) {
        limit = count
        return builder
      },
      all: async () => result(),
      first: async () => result()[0] ?? null,
    }
    return builder
  }

  const state = Object.create(LeadsService.prototype) as Record<string, unknown>
  state['prisma'] = { client: { orm: { public: { Clue: { where: query } } } } }
  state['metadata'] = {
    listFields: async () => configuredFields,
    validateBatchFieldValue: () => undefined,
  }
  state['pools'] = {
    assertPoolMember: async () => undefined,
    resolveTargetPool: async () => null,
    assertCapacityForOwner: async () => undefined,
  }
  state['fieldValues'] = {
    filterResourceIds: async () => [],
    validate: async (
      _tenant: string,
      _resourceType: string,
      _values: unknown,
      options: { resourceId?: string },
    ) => {
      if (options.resourceId) validatedIds.push(options.resourceId)
    },
  }
  state['spreadsheet'] = new SpreadsheetService()
  state['create'] = async (_user: AuthUser, input: Record<string, unknown>) => {
    created.push(input)
  }
  state['resolveLeadUniqueScope'] = async () => undefined
  state['assertLeadSystemUniqueRules'] = async () => undefined
  state['ensureInScope'] = async (_user: AuthUser, id: string) => {
    const lead = data.find((candidate) => candidate.id === id)
    if (!lead) throw new Error('线索不存在或不在你的数据范围内')
    return lead
  }
  state['updateExisting'] = async (
    _user: AuthUser,
    target: { id: string },
    dto: {
      name?: string
      customData?: Record<string, unknown>
    },
  ) => {
    updated.push({ id: target.id, name: dto.name, gender: dto.customData?.['cf_gender'] })
  }
  return { service: state as unknown as LeadsService, updated, created, validatedIds }
}

test('更新模式必须包含唯一ID，即使已设置电话唯一也不能通过电话匹配', async () => {
  const { service, updated } = harness()
  const source = await sampleFile()
  await assert.rejects(service.precheckImportXlsx(user, source, 'UPDATE'), /必须包含「唯一ID」/)
  await assert.rejects(service.importXlsx(user, source, 'UPDATE'), /必须包含「唯一ID」/)
  assert.deepEqual(updated, [])
})

test('唯一ID 精确定位已有线索；修改手机号与其他字段后预检和更新均通过', async () => {
  const { service, updated, validatedIds } = harness()
  const source = await sampleFile(true, 9999999)
  const check = await service.precheckImportXlsx(user, source, 'UPDATE')
  assert.equal(check.successCount, 1)
  assert.equal(check.failCount, 0)
  const result = await service.importXlsx(user, source, 'UPDATE')
  assert.equal(result.successCount, 1)
  assert.deepEqual(updated, [{ id: 'lead-1', name: '更新姓名', gender: 'M' }])
  assert.deepEqual(validatedIds, ['lead-1', 'lead-1'])
})

test('唯一ID 找不到目标记录时只报告行错误，不根据手机号猜测线索', async () => {
  const { service, updated } = harness({ matchingPhones: ['9999999'] })
  const result = await service.importXlsx(user, await sampleFile(true, 9999999), 'UPDATE')
  assert.equal(result.successCount, 1)
  assert.deepEqual(
    updated.map((entry) => entry.id),
    ['lead-1'],
  )

  const { service: missingService, updated: missingUpdates } = harness({ matchingPhones: [] })
  const notFound = await missingService.importXlsx(user, await sampleFile(true, 9999999), 'UPDATE')
  assert.equal(notFound.successCount, 0)
  assert.equal(notFound.failCount, 1)
  assert.match(notFound.errorMessages[0]?.errMsg ?? '', /不存在/)
  assert.deepEqual(missingUpdates, [])
})

test('字段没有配置唯一值时，仍然只用唯一ID定位已有线索', async () => {
  const { service, updated } = harness({ uniquePhone: false })
  const result = await service.importXlsx(user, await sampleFile(true), 'UPDATE')
  assert.equal(result.successCount, 1)
  assert.deepEqual(
    updated.map((item) => item.id),
    ['lead-1'],
  )
})

test('更新模板自动提供唯一ID，线索池模板排除负责人', async () => {
  const spreadsheet = new SpreadsheetService()
  const exported = await spreadsheet.buildImportTemplate(fields, 'UPDATE')
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(exported as unknown as Parameters<typeof book.xlsx.load>[0])
  assert.deepEqual((book.worksheets[0]!.getRow(1).values as string[]).slice(1), [
    '唯一ID',
    ...fields.map((item) => item.label),
  ])
  const pool = await spreadsheet.buildImportTemplate(fields, 'UPDATE', {
    excludeKeys: ['owner', 'ownerId'],
  })
  const poolBook = new ExcelJS.Workbook()
  await poolBook.xlsx.load(pool as unknown as Parameters<typeof poolBook.xlsx.load>[0])
  const poolHeaders = (poolBook.worksheets[0]!.getRow(1).values as string[]).slice(1)
  assert.equal(poolHeaders[0], '唯一ID')
  assert.equal(poolHeaders.includes('负责人'), false)
})

test('导出任务自动包含唯一ID，导出的姓名、联系人、自定义字段可原样用于更新', async () => {
  const obj = Object.create(LeadsService.prototype) as Record<string, unknown>
  obj['metadata'] = { listFields: async () => fields }
  obj['spreadsheet'] = new SpreadsheetService()
  obj['collectExportItems'] = async () => [
    {
      id: 'lead-1',
      name: '张三',
      contactName: '李四',
      phone: '13800138000',
      ownerName: '负责人A',
      status: 'PENDING',
      customData: { cf_gender: 'M' },
      createdAt: '2026-10-01T09:00:00.000Z',
    },
  ]
  obj['leadStageLabelMap'] = async () => new Map([['PENDING', '待联系']])
  const service = obj as unknown as LeadsService
  const result = await service.buildQueuedExport(user, {
    version: 1,
    query: {},
    input: { headList: ['name', 'contact', 'phone', 'cf_gender', 'status', 'createdAt'] },
  })
  const book = new ExcelJS.Workbook()
  await book.xlsx.load(result.data as unknown as Parameters<typeof book.xlsx.load>[0])
  const sheet = book.worksheets[0]!
  assert.deepEqual((sheet.getRow(1).values as string[]).slice(1), [
    '唯一ID',
    '线索名称',
    '联系人',
    '电话',
    '性别',
    '状态',
    '创建时间',
  ])
  assert.deepEqual((sheet.getRow(2).values as string[]).slice(1), [
    'lead-1',
    '张三',
    '李四',
    '13800138000',
    '男',
    '待联系',
    '2026-10-01T09:00:00.000Z',
  ])
  sheet.getCell('B2').value = '张三（更新）'
  const updatedFile = Buffer.from(await book.xlsx.writeBuffer())
  const parsed = await new SpreadsheetService().parseImport(updatedFile, fields, 'UPDATE')
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.resourceId, 'lead-1')
  assert.deepEqual(parsed[0]?.values, {
    name: '张三（更新）',
    contact: '李四',
    phone: '13800138000',
    cf_gender: 'M',
  })
  assert.deepEqual(parsed[0]?.errors, [])
})

/** 未知列夹在可识别字段之间，不能影响字段对齐或业务更新。 */
test('预检与正式更新都忽略未知表头，已识别字段按原始列位置准确入库', async () => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('混合表头')
  sheet.addRow(['唯一ID', '线索名称', '历史编号', '电话', '旧系统说明', '性别'])
  sheet.addRow(['lead-1', '更新姓名', 'Legacy-123', 9999999, '不应入库', '男'])
  const file = Buffer.from(await book.xlsx.writeBuffer())
  const { service, updated, validatedIds } = harness()

  const check = await service.precheckImportXlsx(user, file, 'UPDATE')
  assert.equal(check.successCount, 1)
  assert.equal(check.failCount, 0)
  assert.deepEqual(check.ignoredHeaders, ['历史编号', '旧系统说明'])
  assert.equal(check.recognizedColumnCount, 3)

  const result = await service.importXlsx(user, file, 'UPDATE')
  assert.equal(result.successCount, 1)
  assert.equal(result.failCount, 0)
  assert.deepEqual(result.ignoredHeaders, check.ignoredHeaders)
  assert.equal(result.recognizedColumnCount, 3)
  assert.deepEqual(updated, [{ id: 'lead-1', name: '更新姓名', gender: 'M' }])
  assert.deepEqual(validatedIds, ['lead-1', 'lead-1'])
})

test('空白表头的数据列也忽略并提示；只有未知列时拒绝导入', async () => {
  const spreadsheet = new SpreadsheetService()
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('空白表头')
  sheet.addRow(['线索名称', '', '电话'])
  sheet.addRow(['王同学', '过期来源', 13812345678])
  const mixed = Buffer.from(await book.xlsx.writeBuffer())
  const result = await spreadsheet.parseImportWithReport(mixed, fields, 'ADD', {
    ignoreUnknownHeaders: true,
  })
  assert.deepEqual(result.ignoredHeaders, ['第2列（空白表头）'])
  assert.deepEqual(result.rows[0]?.values, { name: '王同学', phone: '13812345678' })
  assert.equal(result.recognizedColumnCount, 2)

  const unknown = new ExcelJS.Workbook()
  unknown.addWorksheet('未知').addRow(['自建编号', '历史备注'])
  unknown.worksheets[0]!.addRow(['legacy', '无需导入'])
  const buffer = Buffer.from(await unknown.xlsx.writeBuffer())
  await assert.rejects(
    spreadsheet.parseImportWithReport(buffer, fields, 'ADD', { ignoreUnknownHeaders: true }),
    /没有可识别的业务字段/,
  )
  // 未开启宽容模式的其他模块，仍然对未知表头报错。
  await assert.rejects(spreadsheet.parseImport(buffer, fields, 'ADD'), /无法识别的表头/)
})

test('重复命中同一字段的表头不能静默覆盖，更新模式仍强制唯一ID', async () => {
  const spreadsheet = new SpreadsheetService()
  const duplicates = new ExcelJS.Workbook()
  duplicates.addWorksheet('重复字段').addRow(['线索名称', 'name', '电话'])
  duplicates.worksheets[0]!.addRow(['甲', '乙', 1313131])
  const source = Buffer.from(await duplicates.xlsx.writeBuffer())
  await assert.rejects(
    spreadsheet.parseImportWithReport(source, fields, 'ADD', { ignoreUnknownHeaders: true }),
    /表头重复映射/,
  )
  await assert.rejects(
    spreadsheet.parseImportWithReport(await sampleFile(), fields, 'UPDATE', {
      ignoreUnknownHeaders: true,
    }),
    /必须包含「唯一ID」/,
  )
})

test('未知表头不能替代必填的线索名称：整行校验仍阻止导入', async () => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('缺少名称')
  sheet.addRow(['旧系统姓名', '电话'])
  sheet.addRow(['无法映射姓名', 9999999])
  const file = Buffer.from(await book.xlsx.writeBuffer())
  const { service, updated } = harness()
  const result = await service.precheckImportXlsx(user, file, 'ADD')
  assert.equal(result.successCount, 0)
  assert.equal(result.failCount, 1)
  assert.deepEqual(result.ignoredHeaders, ['旧系统姓名'])
  assert.match(result.errorMessages[0]?.errMsg ?? '', /线索名称不能为空/)
  assert.deepEqual(updated, [])
})

test('导入新建：陌生表头夹在姓名与电话中间时仍能预检并实际创建线索', async () => {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('新建混合表头')
  sheet.addRow(['线索名称', '旧来源代码', '电话', '外部备注', '性别'])
  sheet.addRow(['测试新线索', 'code-123', 13800001234, '不要保存', '女'])
  const file = Buffer.from(await book.xlsx.writeBuffer())
  const { service, created } = harness()

  const preview = await service.precheckImportXlsx(user, file, 'ADD')
  assert.equal(preview.successCount, 1)
  assert.equal(preview.failCount, 0)
  assert.deepEqual(preview.ignoredHeaders, ['旧来源代码', '外部备注'])
  assert.equal(preview.recognizedColumnCount, 3)

  const done = await service.importXlsx(user, file, 'ADD')
  assert.equal(done.successCount, 1)
  assert.equal(done.failCount, 0)
  assert.deepEqual(done.ignoredHeaders, preview.ignoredHeaders)
  assert.equal(created.length, 1)
  assert.equal(created[0]?.name, '测试新线索')
  assert.equal(created[0]?.phone, '13800001234')
  assert.deepEqual(created[0]?.customData, { cf_gender: 'F' })
  assert.equal('旧来源代码' in created[0]!, false)
})
