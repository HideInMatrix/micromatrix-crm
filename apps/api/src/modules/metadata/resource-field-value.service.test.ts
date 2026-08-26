import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import type { PrismaService } from '../../prisma/prisma.service'
import type { ModuleFormsService } from './module-forms.service'
import { ResourceFieldValueService } from './resource-field-value.service'

interface ValueRow {
  resourceId: string
  fieldId: string
  fieldValue: string
}

const fields: FieldVO[] = [
  {
    id: 'system-name',
    module: 'customer',
    key: 'name',
    label: '客户名称',
    type: 'text',
    required: true,
    system: true,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: 200,
  },
  {
    id: 'field-required',
    module: 'customer',
    key: 'cf_required',
    label: '必填文本',
    type: 'text',
    required: true,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 1,
    span: 12,
    showInList: true,
    listWidth: null,
  },
  {
    id: 'field-note',
    module: 'customer',
    key: 'cf_note',
    label: '备注',
    type: 'textarea',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 2,
    span: 24,
    showInList: false,
    listWidth: null,
  },
  {
    id: 'field-score',
    module: 'customer',
    key: 'cf_score',
    label: '评分',
    type: 'number',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: { min: 0, max: 100 },
    sort: 3,
    span: 12,
    showInList: true,
    listWidth: null,
  },
  {
    id: 'field-tags',
    module: 'customer',
    key: 'cf_tags',
    label: '标签',
    type: 'multiselect',
    required: false,
    system: false,
    hidden: false,
    options: [
      { label: '重点', value: 'important' },
      { label: '长期', value: 'long-term' },
    ],
    config: null,
    sort: 4,
    span: 12,
    showInList: true,
    listWidth: null,
  },
  {
    id: 'field-code',
    module: 'customer',
    key: 'cf_code',
    label: '客户编码',
    type: 'text',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: { unique: true },
    sort: 5,
    span: 12,
    showInList: true,
    listWidth: null,
  },
  {
    id: 'field-phone',
    module: 'customer',
    key: 'cf_phone',
    label: '联系电话',
    type: 'phone',
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 6,
    span: 12,
    showInList: true,
    listWidth: null,
  },
]

function createHarness() {
  const normal: ValueRow[] = []
  const blob: ValueRow[] = []
  const organizations = new Map([
    ['customer-a', 'tenant-a'],
    ['customer-b', 'tenant-a'],
    ['customer-c', 'tenant-b'],
  ])
  let normalReads = 0
  let blobReads = 0
  let failBlobCreate = false

  function delegate(rows: ValueRow[], kind: 'normal' | 'blob') {
    return {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const excluded = where['resourceId'] as { not?: string } | undefined
        const organizationId = (where['resource'] as { organizationId?: string } | undefined)
          ?.organizationId
        return rows.find(
          (row) =>
            row.fieldId === where['fieldId'] &&
            row.fieldValue === where['fieldValue'] &&
            row.resourceId !== excluded?.not &&
            organizations.get(row.resourceId) === organizationId,
        )
          ? { id: 'match' }
          : null
      },
      deleteMany: async ({
        where,
      }: {
        where: { resourceId: string; fieldId: { in: string[] } }
      }) => {
        for (let index = rows.length - 1; index >= 0; index--) {
          const row = rows[index]
          if (row && row.resourceId === where.resourceId && where.fieldId.in.includes(row.fieldId))
            rows.splice(index, 1)
        }
        return { count: 1 }
      },
      createMany: async ({ data }: { data: ValueRow[] }) => {
        if (kind === 'blob' && failBlobCreate) throw new Error('blob insert failed')
        rows.push(...data)
        return { count: data.length }
      },
      findMany: async ({
        where,
      }: {
        where: { resourceId: { in: string[] }; resource: { organizationId: string } }
      }) => {
        if (kind === 'normal') normalReads++
        else blobReads++
        return rows.filter(
          (row) =>
            where.resourceId.in.includes(row.resourceId) &&
            organizations.get(row.resourceId) === where.resource.organizationId,
        )
      },
    }
  }

  const customerField = delegate(normal, 'normal')
  const customerFieldBlob = delegate(blob, 'blob')
  const emptyDelegate = delegate([], 'normal')
  const prismaRecord = {
    customer: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        organizations.get(where.id) === where.organizationId ? { id: where.id } : null,
    },
    clue: { findFirst: async () => null },
    customerContact: { findFirst: async () => null },
    customerField,
    customerFieldBlob,
    clueField: emptyDelegate,
    clueFieldBlob: emptyDelegate,
    customerContactField: emptyDelegate,
    customerContactFieldBlob: emptyDelegate,
    $queryRaw: async () => [],
  }
  const moduleForms = {
    listFields: async () => fields,
    listFieldsInTransaction: async () => fields,
  } as unknown as ModuleFormsService
  const prisma = prismaRecord as unknown as PrismaService
  return {
    service: new ResourceFieldValueService(prisma, moduleForms),
    tx: prismaRecord as never,
    normal,
    blob,
    reads: () => ({ normal: normalReads, blob: blobReads }),
    setFailBlobCreate: (value: boolean) => {
      failBlobCreate = value
    },
    transaction: async <T>(operation: () => Promise<T>): Promise<T> => {
      const normalSnapshot = structuredClone(normal)
      const blobSnapshot = structuredClone(blob)
      try {
        return await operation()
      } catch (error) {
        normal.splice(0, normal.length, ...normalSnapshot)
        blob.splice(0, blob.length, ...blobSnapshot)
        throw error
      }
    },
  }
}

test('创建校验执行必填、数字范围和选项约束，同时忽略主表系统字段', async () => {
  const { service } = createHarness()
  await assert.rejects(
    () => service.validate('tenant-a', 'customer', { name: '甲公司' }, { mode: 'create' }),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.validate(
        'tenant-a',
        'customer',
        { cf_required: '有值', cf_score: 101 },
        { mode: 'create' },
      ),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.validate(
        'tenant-a',
        'customer',
        { cf_required: '有值', cf_tags: ['invalid'] },
        { mode: 'create' },
      ),
    BadRequestException,
  )
  assert.deepEqual(
    await service.validate(
      'tenant-a',
      'customer',
      { name: '甲公司', cf_required: '有值', cf_score: 88, cf_tags: ['important'] },
      { mode: 'create' },
    ),
    { cf_required: '有值', cf_score: 88, cf_tags: ['important'] },
  )
})

test('同一事务保存时普通值和复杂值分别进入 field 与 field_blob', async () => {
  const { service, tx, normal, blob } = createHarness()
  await service.save(
    'tenant-a',
    'customer',
    'customer-a',
    { cf_required: '短文本', cf_note: '长备注', cf_tags: ['important'], cf_score: 90 },
    'create',
    tx,
  )
  assert.deepEqual(normal.map((row) => [row.fieldId, row.fieldValue]).sort(), [
    ['field-required', '短文本'],
    ['field-score', '90'],
  ])
  assert.deepEqual(blob.map((row) => [row.fieldId, row.fieldValue]).sort(), [
    ['field-note', '长备注'],
    ['field-tags', '["important"]'],
  ])
})

test('唯一字段按组织隔离，更新当前资源时排除自身', async () => {
  const { service, tx, normal } = createHarness()
  normal.push({ resourceId: 'customer-b', fieldId: 'field-code', fieldValue: 'C-001' })
  await assert.rejects(
    () => service.save('tenant-a', 'customer', 'customer-a', { cf_code: 'C-001' }, 'update', tx),
    ConflictException,
  )
  await service.save('tenant-a', 'customer', 'customer-b', { cf_code: 'C-001' }, 'update', tx)
  normal.push({ resourceId: 'customer-c', fieldId: 'field-code', fieldValue: 'C-002' })
  await service.save('tenant-a', 'customer', 'customer-a', { cf_code: 'C-002' }, 'update', tx)
})

test('批量装配只查询普通表和 Blob 表各一次并恢复字段类型', async () => {
  const { service, normal, blob, reads } = createHarness()
  normal.push(
    { resourceId: 'customer-a', fieldId: 'field-score', fieldValue: '88' },
    { resourceId: 'customer-b', fieldId: 'field-required', fieldValue: '文本' },
  )
  blob.push({ resourceId: 'customer-a', fieldId: 'field-tags', fieldValue: '["important"]' })
  const result = await service.load('tenant-a', 'customer', ['customer-a', 'customer-b'])
  assert.deepEqual(result.get('customer-a'), { cf_score: 88, cf_tags: ['important'] })
  assert.deepEqual(result.get('customer-b'), { cf_required: '文本' })
  assert.deepEqual(reads(), { normal: 1, blob: 1 })
})

test('批改使用同一事务写正确分表，唯一字段禁止多资源写同值', async () => {
  const { service, tx, blob } = createHarness()
  assert.deepEqual(
    await service.saveBatch(
      'tenant-a',
      'customer',
      ['customer-a', 'customer-b'],
      'cf_tags',
      ['long-term'],
      tx,
    ),
    { count: 2 },
  )
  assert.equal(blob.length, 2)
  await assert.rejects(
    () =>
      service.saveBatch(
        'tenant-a',
        'customer',
        ['customer-a', 'customer-b'],
        'cf_code',
        'SAME',
        tx,
      ),
    BadRequestException,
  )
})

test('高级筛选编译为组织隔离的参数化普通值/Blob SQL', async () => {
  const { service } = createHarness()
  const query = await service.buildFilter('tenant-a', 'customer', [
    { key: 'cf_score', op: 'gte', value: 60 },
    { key: 'cf_tags', op: 'contains', value: 'important' },
  ])
  const sql = query.sql
  assert.match(sql, /FROM customer AS resource/)
  assert.match(sql, /customer_field/)
  assert.match(sql, /customer_field_blob/)
  assert.match(sql, /organization_id/)
  assert.equal(query.values.includes('tenant-a'), true)
})

test('电话字段 contains 允许普通关键字子串而不执行完整电话格式校验', async () => {
  const { service } = createHarness()
  const query = await service.buildFilter('tenant-a', 'customer', [
    { key: 'cf_phone', op: 'contains', value: '客户名称关键字' },
  ])
  assert.equal(query.values.includes('%客户名称关键字%'), true)
})

test('字段值写入失败时由调用方同一事务整体回滚', async () => {
  const { service, tx, normal, blob, setFailBlobCreate, transaction } = createHarness()
  normal.push({ resourceId: 'customer-a', fieldId: 'field-required', fieldValue: '旧值' })
  setFailBlobCreate(true)
  await assert.rejects(
    () =>
      transaction(() =>
        service.save(
          'tenant-a',
          'customer',
          'customer-a',
          { cf_required: '新值', cf_note: '触发失败' },
          'update',
          tx,
        ),
      ),
    /blob insert failed/,
  )
  assert.deepEqual(normal, [
    { resourceId: 'customer-a', fieldId: 'field-required', fieldValue: '旧值' },
  ])
  assert.deepEqual(blob, [])
})
