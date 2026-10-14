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
  return { service: state as unknown as LeadsService, updated, validatedIds }
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
