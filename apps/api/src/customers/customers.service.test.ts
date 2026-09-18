import assert from 'node:assert/strict'
import test from 'node:test'
import type { AuthUser } from '../common/auth-user'
import { CustomersService } from './customers.service'

const user: AuthUser = {
  id: 'user-a',
  tenantId: 'tenant-a',
  email: null,
  name: '测试用户',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: [],
}

function prisma8Harness(selectedIds: string[] = []) {
  const calls: Array<{ op: string; value?: unknown }> = []
  const scalar = (name: string) => ({
    eq: (value: unknown) => {
      calls.push({ op: name + '.eq', value })
      return { op: 'eq', name, value }
    },
    neq: (value: unknown) => {
      calls.push({ op: name + '.neq', value })
      return { op: 'neq', name, value }
    },
    in: (value: unknown) => {
      calls.push({ op: name + '.in', value })
      return { op: 'in', name, value }
    },
    ilike: (value: unknown) => {
      calls.push({ op: name + '.ilike', value })
      return { op: 'ilike', name, value }
    },
    isNull: () => ({ op: 'isNull', name }),
    isNotNull: () => ({ op: 'isNotNull', name }),
    gt: (value: unknown) => ({ op: 'gt', name, value }),
    gte: (value: unknown) => ({ op: 'gte', name, value }),
    lt: (value: unknown) => ({ op: 'lt', name, value }),
    lte: (value: unknown) => ({ op: 'lte', name, value }),
    asc: () => ({ op: 'asc', name }),
    desc: () => ({ op: 'desc', name }),
  })
  const row = {
    id: scalar('id'),
    name: scalar('name'),
    owner: scalar('owner'),
    collectionTime: scalar('collectionTime'),
    poolId: scalar('poolId'),
    createTime: scalar('createTime'),
    updateTime: scalar('updateTime'),
    createUser: scalar('createUser'),
    updateUser: scalar('updateUser'),
    inSharedPool: scalar('inSharedPool'),
    follower: scalar('follower'),
    followTime: scalar('followTime'),
    reasonId: scalar('reasonId'),
  }

  const makeCollection = (selected = false): any => ({
    where: (input: unknown) => {
      if (typeof input === 'function') input(row)
      else calls.push({ op: 'where.object', value: input })
      return makeCollection(selected)
    },
    orderBy: () => makeCollection(selected),
    offset: () => makeCollection(selected),
    limit: () => makeCollection(selected),
    select: () => makeCollection(true),
    all: async () => (selected ? selectedIds.map((id) => ({ id })) : []),
    aggregate: async () => ({ count: 0 }),
  })

  return {
    calls,
    prisma8: {
      client: {
        orm: {
          public: {
            Customer: {
              where: (input: unknown) => {
                calls.push({ op: 'where.object', value: input })
                return makeCollection(false)
              },
            },
          },
        },
      },
    },
  }
}

function createService(options: {
  prisma8: unknown
  metadata: unknown
  fieldValues: unknown
  dataScope?: unknown
}) {
  return new CustomersService(
    options.prisma8 as never,
    (options.dataScope ?? { directOwnerFilter: async () => ({ owner: user.id }) }) as never,
    options.metadata as never,
    {} as never,
    options.fieldValues as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  )
}

test('客户分页关键词只搜索客户名称，不查询可配置动态字段', async () => {
  const harness = prisma8Harness()
  const service = createService({
    prisma8: harness.prisma8,
    metadata: { listFields: async () => [] },
    fieldValues: {
      filterResourceIds: async () => {
        throw new Error('关键词搜索不应查询动态字段')
      },
      load: async () => new Map(),
    },
  })

  const result = await service.findAll(user, { keyword: 'Acme' })

  assert.deepEqual(result, { items: [], total: 0, page: 1, pageSize: 10 })
  assert.equal(
    harness.calls.some((call) => call.op === 'name.ilike' && call.value === '%Acme%'),
    true,
  )
})

test('客户 /account/page 高级筛选直接使用 FilterCondition[] 并约束最终列表查询', async () => {
  const harness = prisma8Harness(['customer-zhang'])
  const service = createService({
    prisma8: harness.prisma8,
    metadata: {
      listFields: async () => [
        {
          id: 'field-name',
          key: 'name',
          label: '家长姓名',
          type: 'text',
          system: true,
          required: true,
        },
      ],
    },
    fieldValues: {
      filterResourceIds: async () => {
        throw new Error('name 系统字段不应走动态字段筛选')
      },
      load: async () => new Map(),
    },
  })

  const result = await service.page(
    {
      ...user,
      roles: [
        {
          id: 'role-all',
          name: '全部客户',
          permissions: ['customer:read'],
          dataScope: 'ALL',
          scopeDeptIds: [],
        },
      ],
      permissions: ['customer:read'],
    },
    {
      current: 1,
      pageSize: 10,
      view: 'ALL',
      filters: [{ key: 'name', op: 'contains', value: '张' }],
    },
  )

  assert.deepEqual(result, { list: [], total: 0, pageSize: 10, current: 1, optionMap: {} })
  assert.equal(
    harness.calls.some((call) => call.op === 'name.ilike' && call.value === '%张%'),
    true,
  )
  assert.equal(
    harness.calls.some(
      (call) =>
        call.op === 'id.in' &&
        Array.isArray(call.value) &&
        call.value.map(String).includes('customer-zhang'),
    ),
    true,
  )
})
