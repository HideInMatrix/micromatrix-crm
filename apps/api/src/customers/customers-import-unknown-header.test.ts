import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../common/auth-user'
import type { FieldVO } from '@micromatrix/shared'
import ExcelJS from 'exceljs'
import { SpreadsheetService } from '../modules/import-export/spreadsheet.service'
import { CustomersService } from './customers.service'

const user = { id: 'user-a', tenantId: 'tenant-a' } as AuthUser

function field(key: string, label: string, overrides: Partial<FieldVO> = {}): FieldVO {
  return {
    id: key,
    key,
    label,
    module: 'customer',
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
  field('name', '客户名称', { required: true, system: true }),
  field('owner', '客户负责人', { type: 'member', system: true }),
  field('cf_phone', '电话', { type: 'phone' }),
  field('cf_level', '客户等级', {
    type: 'select',
    options: [
      { label: '高', value: 'HIGH' },
      { label: '低', value: 'LOW' },
    ],
  }),
]

async function workbook(headers: string[], rows: unknown[][]) {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('导入客户')
  sheet.addRow(headers)
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await book.xlsx.writeBuffer())
}

function harness() {
  const created: Array<Record<string, unknown>> = []
  const updated: Array<{ id: string; dto: Record<string, unknown> }> = []
  const seaCreated: Array<{ poolId: string; dto: Record<string, unknown> }> = []
  const validated: Array<{ data: Record<string, unknown>; mode: string }> = []
  const instance = Object.create(CustomersService.prototype) as Record<string, unknown>
  instance['metadata'] = {
    listFields: async () => fields,
    validateBatchFieldValue: () => undefined,
  }
  instance['spreadsheet'] = new SpreadsheetService()
  instance['pools'] = {
    assertPoolMember: async () => undefined,
    resolveTargetPool: async () => ({ id: 'pool-a' }),
    assertCapacityForOwner: async () => undefined,
  }
  instance['fieldValues'] = {
    validate: async (
      _tenant: string,
      _module: string,
      data: Record<string, unknown>,
      opts: { mode: string },
    ) => {
      validated.push({ data, mode: opts.mode })
    },
  }
  instance['findExactCustomerDuplicate'] = async () => null
  instance['ensureInScope'] = async (_user: AuthUser, id: string) => ({
    id,
    name: '旧客户',
    owner: 'user-a',
    inSharedPool: false,
  })
  instance['prisma'] = {
    client: {
      orm: {
        public: {
          Customer: {
            where: (condition: { id: string }) => ({
              first: async () => ({ id: condition.id, owner: null, inSharedPool: true }),
            }),
          },
        },
      },
    },
  }
  instance['create'] = async (_user: AuthUser, dto: Record<string, unknown>) => {
    created.push(dto)
  }
  instance['createInSea'] = async (
    _user: AuthUser,
    dto: Record<string, unknown>,
    poolId: string,
  ) => {
    seaCreated.push({ dto, poolId })
  }
  instance['update'] = async (_user: AuthUser, id: string, dto: Record<string, unknown>) => {
    updated.push({ id, dto })
  }
  instance['updateExisting'] = async (
    _user: AuthUser,
    existing: { id: string },
    dto: Record<string, unknown>,
  ) => {
    updated.push({ id: existing.id, dto })
  }
  return {
    service: instance as unknown as CustomersService,
    created,
    updated,
    seaCreated,
    validated,
  }
}

test('客户导入新建：忽略混入的两个未知表头，保留电话及自定义客户等级', async () => {
  const file = await workbook(
    ['客户名称', '历史系统编号', '电话', '旧学校备注', '客户等级'],
    [['张同学', 'legacy-42', 13800138000, '不应入库', '高']],
  )
  const { service, created, validated } = harness()
  const check = await service.precheckImportXlsx(user, file, 'ADD')
  assert.equal(check.successCount, 1)
  assert.equal(check.failCount, 0)
  assert.deepEqual(check.ignoredHeaders, ['历史系统编号', '旧学校备注'])
  assert.equal(check.recognizedColumnCount, 3)

  const done = await service.importXlsx(user, file, 'ADD')
  assert.equal(done.successCount, 1)
  assert.deepEqual(done.ignoredHeaders, check.ignoredHeaders)
  assert.deepEqual(created, [
    { name: '张同学', customData: { cf_phone: '13800138000', cf_level: 'HIGH' } },
  ])
  assert.deepEqual(
    validated.map((item) => item.mode),
    ['create', 'create'],
  )
})

test('客户导入更新：保留唯一ID 精确定位并忽略中间的陌生列', async () => {
  const file = await workbook(
    ['唯一ID', '客户名称', '旧系统代码', '客户等级'],
    [['customer-1', '更新客户', 'ignore-me', '低']],
  )
  const { service, updated } = harness()
  const check = await service.precheckImportXlsx(user, file, 'UPDATE')
  const done = await service.importXlsx(user, file, 'UPDATE')
  assert.equal(check.successCount, 1)
  assert.equal(done.successCount, 1)
  assert.deepEqual(check.ignoredHeaders, ['旧系统代码'])
  assert.deepEqual(done.ignoredHeaders, ['旧系统代码'])
  assert.deepEqual(updated, [
    { id: 'customer-1', dto: { name: '更新客户', customData: { cf_level: 'LOW' } } },
  ])
})

test('客户公海导入新建：负责人列与未知字段均被忽略，不影响合法客户字段', async () => {
  const file = await workbook(
    ['客户名称', '客户负责人', '电话', '历史备注', '客户等级'],
    [['公海学生', '管理员', 13800138001, '原始归档内容', '高']],
  )
  const { service, seaCreated } = harness()
  const check = await service.precheckImportXlsx(user, file, 'ADD', 'pool-a')
  assert.equal(check.successCount, 1)
  assert.deepEqual(check.ignoredHeaders, ['客户负责人', '历史备注'])
  assert.equal(check.recognizedColumnCount, 3)
  const done = await service.importXlsx(user, file, 'ADD', 'pool-a')
  assert.equal(done.successCount, 1)
  assert.deepEqual(done.ignoredHeaders, check.ignoredHeaders)
  assert.deepEqual(seaCreated, [
    {
      poolId: 'pool-a',
      dto: { name: '公海学生', customData: { cf_phone: '13800138001', cf_level: 'HIGH' } },
    },
  ])
})

test('客户导入保留强校验：缺失客户名称、更新缺唯一ID、重复映射拒绝', async () => {
  const { service, created } = harness()
  const missingName = await workbook(['旧系统客户姓名', '电话'], [['未知姓名', 13800138002]])
  const check = await service.precheckImportXlsx(user, missingName, 'ADD')
  assert.equal(check.successCount, 0)
  assert.equal(check.failCount, 1)
  assert.deepEqual(check.ignoredHeaders, ['旧系统客户姓名'])
  assert.match(check.errorMessages[0]?.errMsg ?? '', /客户名称不能为空/)
  await assert.rejects(
    service.precheckImportXlsx(user, missingName, 'UPDATE'),
    /必须包含「唯一ID」/,
  )

  const duplicate = await workbook(['客户名称', 'name', '电话'], [['张三', '张四', 13800138003]])
  await assert.rejects(service.precheckImportXlsx(user, duplicate, 'ADD'), /表头重复映射/)
  assert.deepEqual(created, [])
})

test('客户文件全是未知表头时拒绝；无效的已识别字段仍保留行级校验', async () => {
  const { service } = harness()
  const unknown = await workbook(['原学校编码', '历史备注'], [['A-1', '仅存档']])
  await assert.rejects(service.precheckImportXlsx(user, unknown, 'ADD'), /没有可识别的业务字段/)
  const invalid = await workbook(
    ['客户名称', '外部号', '客户等级'],
    [['无效选项学生', 'ignore', '不存在的等级']],
  )
  const check = await service.precheckImportXlsx(user, invalid, 'ADD')
  assert.equal(check.successCount, 0)
  assert.equal(check.failCount, 1)
  assert.deepEqual(check.ignoredHeaders, ['外部号'])
  assert.match(check.errorMessages[0]?.errMsg ?? '', /客户等级/)
})

test('客户公海导入更新：只更新唯一ID 命中的客户，忽略未知表头与公海负责人', async () => {
  const file = await workbook(
    ['唯一ID', '客户名称', '外部合同号', '客户负责人', '客户等级'],
    [['customer-sea-1', '公海已更新客户', 'agreement-42', '应忽略', '低']],
  )
  const { service, updated } = harness()
  const check = await service.precheckImportXlsx(user, file, 'UPDATE', 'pool-a')
  assert.equal(check.successCount, 1)
  assert.equal(check.failCount, 0)
  assert.deepEqual(check.ignoredHeaders, ['外部合同号'])
  const done = await service.importXlsx(user, file, 'UPDATE', 'pool-a')
  assert.equal(done.successCount, 1)
  assert.deepEqual(done.ignoredHeaders, ['外部合同号'])
  assert.deepEqual(updated, [
    { id: 'customer-sea-1', dto: { name: '公海已更新客户', customData: { cf_level: 'LOW' } } },
  ])
})
