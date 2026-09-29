import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { FieldVO } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { ExternalResourceResolverService } from './external-resource-resolver.service'

const user = { id: 'user-1', tenantId: 'tenant-1' } as AuthUser

function field(input: Partial<FieldVO> & Pick<FieldVO, 'id' | 'key' | 'label' | 'type'>): FieldVO {
  return {
    required: false,
    system: false,
    hidden: false,
    options: null,
    config: null,
    sort: 0,
    span: 12,
    showInList: true,
    listWidth: null,
    module: 'lead',
    ...input,
  }
}

test('Strict Resolver 把动态字段固定编译为 AND eq，不依赖 cf_ 命名判断', async () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    metadata: { listFields: () => Promise<FieldVO[]> }
    prepareWhere: (
      organizationId: string,
      target: 'customer' | 'lead',
      entries: Array<[string, unknown]>,
    ) => Promise<{ supported: boolean; conditions: Array<{ key: string; op: string; value: unknown }> }>
  }
  resolver.metadata = {
    listFields: async () => [
      field({ id: 'field-name', key: 'cf_student_name', label: '学生姓名', type: 'text' }),
      field({ id: 'field-phone', key: 'cf_phone', label: '手机号', type: 'phone' }),
    ],
  }

  const prepared = await resolver.prepareWhere('tenant-1', 'customer', [
    ['field-name', '张三'],
    ['cf_phone', '13800000000'],
  ])

  assert.equal(prepared.supported, true)
  assert.deepEqual(prepared.conditions, [
    { key: 'cf_student_name', op: 'eq', value: '张三' },
    { key: 'cf_phone', op: 'eq', value: '13800000000' },
  ])
})

test('Strict Resolver 对未知字段和不支持 eq 的字段 fail-closed', async () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    metadata: { listFields: () => Promise<FieldVO[]> }
    prepareWhere: (
      organizationId: string,
      target: 'customer' | 'lead',
      entries: Array<[string, unknown]>,
    ) => Promise<{ supported: boolean; issues: string[] }>
  }
  resolver.metadata = {
    listFields: async () => [
      field({ id: 'date-field', key: 'cf_date', label: '报名日期', type: 'date' }),
    ],
  }

  const prepared = await resolver.prepareWhere('tenant-1', 'customer', [
    ['missing', 'x'],
    ['cf_date', '2026-09-28'],
  ])
  assert.equal(prepared.supported, false)
  assert.equal(prepared.issues.length, 2)
})

test('Strict Resolver Customer 优先，Customer 唯一命中后不再查询 Lead', async () => {
  let leadCalled = false
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    validateWhere: (where: Record<string, unknown>) => Array<[string, unknown]>
    prepareWhere: () => Promise<{ supported: boolean; conditions: []; system: []; issues: [] }>
    findCustomerIds: () => Promise<string[]>
    findLeads: () => Promise<unknown[]>
    resolve: ExternalResourceResolverService['resolve']
  }
  resolver.validateWhere = (where) => Object.entries(where)
  resolver.prepareWhere = async () => ({ supported: true, conditions: [], system: [], issues: [] })
  resolver.findCustomerIds = async () => ['customer-1']
  resolver.findLeads = async () => {
    leadCalled = true
    return []
  }

  const result = await resolver.resolve(user, { phone: '13800000000' })
  assert.deepEqual(result, { kind: 'CUSTOMER', customerId: 'customer-1' })
  assert.equal(leadCalled, false)
})

test('Strict Resolver 多条 Customer 命中返回 NON_UNIQUE_MATCH', async () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    validateWhere: (where: Record<string, unknown>) => Array<[string, unknown]>
    prepareWhere: () => Promise<{ supported: boolean; conditions: []; system: []; issues: [] }>
    findCustomerIds: () => Promise<string[]>
    resolve: ExternalResourceResolverService['resolve']
  }
  resolver.validateWhere = (where) => Object.entries(where)
  resolver.prepareWhere = async () => ({ supported: true, conditions: [], system: [], issues: [] })
  resolver.findCustomerIds = async () => ['customer-1', 'customer-2']

  await assert.rejects(
    () => resolver.resolve(user, { phone: '13800000000' }),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException)
      assert.equal((error.getResponse() as { code?: string }).code, 'NON_UNIQUE_MATCH')
      return true
    },
  )
})

test('Strict Resolver Customer 未命中后回退到唯一 Lead', async () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    validateWhere: (where: Record<string, unknown>) => Array<[string, unknown]>
    prepareWhere: () => Promise<{ supported: boolean; conditions: []; system: []; issues: [] }>
    findCustomerIds: () => Promise<string[]>
    findLeads: () => Promise<Array<{
      id: string
      owner: string | null
      transitionType: string | null
      transitionId: string | null
    }>>
    resolve: ExternalResourceResolverService['resolve']
  }
  resolver.validateWhere = (where) => Object.entries(where)
  resolver.prepareWhere = async () => ({ supported: true, conditions: [], system: [], issues: [] })
  resolver.findCustomerIds = async () => []
  resolver.findLeads = async () => [
    {
      id: 'lead-1',
      owner: 'owner-1',
      transitionType: null,
      transitionId: null,
    },
  ]

  const result = await resolver.resolve(user, { phone: '13800000000' })
  assert.deepEqual(result, { kind: 'LEAD', leadId: 'lead-1', ownerId: 'owner-1' })
})

test('Strict Resolver Customer / Lead 均未命中返回 NOT_FOUND', async () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    validateWhere: (where: Record<string, unknown>) => Array<[string, unknown]>
    prepareWhere: () => Promise<{ supported: boolean; conditions: []; system: []; issues: [] }>
    findCustomerIds: () => Promise<string[]>
    findLeads: () => Promise<unknown[]>
    resolve: ExternalResourceResolverService['resolve']
  }
  resolver.validateWhere = (where) => Object.entries(where)
  resolver.prepareWhere = async () => ({ supported: true, conditions: [], system: [], issues: [] })
  resolver.findCustomerIds = async () => []
  resolver.findLeads = async () => []

  await assert.rejects(
    () => resolver.resolve(user, { phone: '13800000000' }),
    (error: unknown) => {
      assert.equal(
        (error as { getResponse?: () => { code?: string } }).getResponse?.().code,
        'NOT_FOUND',
      )
      return true
    },
  )
})

test('Strict Resolver Customer 查询应用 API Key 用户的数据范围 owner 过滤', async () => {
  let appliedOwner: unknown
  const query: Record<string, unknown> = {}
  Object.assign(query, {
    where: (input: unknown) => {
      if (
        input &&
        typeof input === 'object' &&
        !Array.isArray(input) &&
        'owner' in (input as Record<string, unknown>)
      ) {
        appliedOwner = (input as Record<string, unknown>)['owner']
      }
      return query
    },
    select: () => query,
    all: async () => [{ id: 'customer-visible' }],
  })
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    prisma: unknown
    dataScope: {
      resolveScope: () => Promise<{ hasPermission: boolean }>
      directOwnerFilter: () => Promise<{ owner: string }>
    }
    fieldValues: unknown
    findCustomerIds: (
      user: AuthUser,
      prepared: { supported: boolean; conditions: []; system: []; issues: [] },
    ) => Promise<string[]>
  }
  resolver.prisma = {
    client: {
      orm: {
        public: {
          Customer: {
            where: () => query,
          },
        },
      },
    },
  }
  resolver.dataScope = {
    resolveScope: async () => ({ hasPermission: true }),
    directOwnerFilter: async () => ({ owner: 'api-user-owner' }),
  }
  resolver.fieldValues = {}

  const ids = await resolver.findCustomerIds(user, {
    supported: true,
    conditions: [],
    system: [],
    issues: [],
  })

  assert.deepEqual(ids, ['customer-visible'])
  assert.equal(appliedOwner, 'api-user-owner')
})

test('Strict Resolver 拒绝空 where 和复合对象值', () => {
  const resolver = Object.create(ExternalResourceResolverService.prototype) as unknown as {
    validateWhere: (where: Record<string, unknown>) => Array<[string, unknown]>
  }
  assert.throws(() => resolver.validateWhere({}), BadRequestException)
  assert.throws(() => resolver.validateWhere({ phone: { eq: '13800000000' } }), BadRequestException)
})
