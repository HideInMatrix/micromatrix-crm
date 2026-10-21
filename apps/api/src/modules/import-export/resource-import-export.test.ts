import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../../common/auth-user'
import type { FieldVO } from '@micromatrix/shared'
import ExcelJS from 'exceljs'
import { CustomersService } from '../../customers/customers.service'
import { SpreadsheetService } from './spreadsheet.service'

function field(key: string, label: string, extras: Partial<FieldVO> = {}): FieldVO {
  return {
    id: key,
    key,
    label,
    module: 'customer',
    type: 'text',
    required: false,
    system: true,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    ...extras,
  }
}

async function verifyExport(
  data: Buffer,
  expectedHeaders: string[],
  expectedId: string,
  fields: FieldVO[],
  excludeKeys: string[] = [],
) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const sheet = workbook.worksheets[0]!
  assert.deepEqual((sheet.getRow(1).values as string[]).slice(1), expectedHeaders)
  assert.equal(sheet.getCell('A2').value, expectedId)

  sheet.getCell('B2').value = '修改后的名称'
  const updated = Buffer.from(await workbook.xlsx.writeBuffer())
  const parsed = await new SpreadsheetService().parseImport(updated, fields, 'UPDATE', {
    excludeKeys,
  })
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0]?.resourceId, expectedId)
  assert.equal(parsed[0]?.values.name, '修改后的名称')
  assert.deepEqual(parsed[0]?.errors, [])
}

const customerFields = [
  field('name', '客户名称'),
  field('owner', '负责人', { type: 'member' }),
  field('cf_level', '客户等级', {
    system: false,
    type: 'select',
    options: [
      { label: '高', value: 'HIGH' },
      { label: '低', value: 'LOW' },
    ],
  }),
]

const customer = {
  id: 'customer-a',
  name: '客户原名',
  ownerName: '经办人甲',
  owner: 'user-a',
  customData: { cf_level: 'HIGH' },
  createdAt: '2026-10-13T01:00:00.000Z',
}

function customerHarness() {
  const instance = Object.create(CustomersService.prototype) as Record<string, unknown>
  instance['collectExportItems'] = async () => [customer]
  instance['metadata'] = { listFields: async () => customerFields }
  instance['spreadsheet'] = new SpreadsheetService()
  instance['pools'] = { assertPoolMember: async () => undefined }
  return instance as unknown as CustomersService
}

const user = {
  id: 'user-a',
  tenantId: 'tenant-a',
  permissions: ['customer:export'],
} as AuthUser

test('客户导出总是首列唯一ID，修改后可作为 UPDATE 导入文件', async () => {
  const result = await customerHarness().buildQueuedExport(user, {
    version: 1,
    query: {},
    input: {
      headList: ['name', 'cf_level', 'createdAt'],
    },
  })
  await verifyExport(
    result.data,
    ['唯一ID', '客户名称', '客户等级', '创建时间'],
    customer.id,
    customerFields,
  )
})

test('客户公海导出同样含唯一ID，更新模式忽略公海不可编辑的负责人', async () => {
  const result = await customerHarness().buildQueuedExport(user, {
    version: 1,
    query: {},
    input: {
      headList: ['name', 'owner', 'cf_level'],
      poolId: 'pool-a',
    },
  })
  await verifyExport(
    result.data,
    ['唯一ID', '客户名称', '负责人', '客户等级'],
    customer.id,
    customerFields,
    ['owner', 'ownerId'],
  )
})
