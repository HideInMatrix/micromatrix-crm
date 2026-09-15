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

test('客户分页关键词只搜索客户名称，不查询可配置动态字段', async () => {
  let capturedWhere: unknown
  const prisma = {
    customer: {
      findMany: async ({ where }: { where: unknown }) => {
        capturedWhere = where
        return []
      },
      count: async () => 0,
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }
  const dataScope = {
    directOwnerFilter: async () => ({ owner: user.id }),
  }
  const metadata = {
    listFields: async () => [],
  }
  const fieldValues = {
    filterResourceIds: async () => {
      throw new Error('关键词搜索不应查询动态字段')
    },
    load: async () => new Map(),
  }

  const service = new CustomersService(
    prisma as never,
    dataScope as never,
    metadata as never,
    {} as never,
    fieldValues as never,
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

  const result = await service.findAll(user, { keyword: 'Acme' })

  assert.deepEqual(result, { items: [], total: 0, page: 1, pageSize: 10 })
  assert.deepEqual(capturedWhere, {
    organizationId: 'tenant-a',
    AND: [{ inSharedPool: false, owner: 'user-a' }],
    name: { contains: 'Acme', mode: 'insensitive' },
  })
})

test('客户 /account/page 高级筛选直接使用 FilterCondition[] 并约束最终列表查询', async () => {
  const finalWheres: unknown[] = []
  const prisma = {
    customer: {
      findMany: async ({ where, select }: { where: unknown; select?: unknown }) => {
        if (select) {
          assert.deepEqual(where, {
            organizationId: 'tenant-a',
            AND: [{ name: { contains: '张', mode: 'insensitive' } }],
          })
          return [{ id: 'customer-zhang' }]
        }
        finalWheres.push(where)
        return []
      },
      count: async ({ where }: { where: unknown }) => {
        finalWheres.push(where)
        return 0
      },
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  }
  const dataScope = {
    directOwnerFilter: async () => ({ owner: user.id }),
  }
  const metadata = {
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
  }
  const fieldValues = {
    filterResourceIds: async () => {
      throw new Error('name 系统字段不应走动态字段筛选')
    },
    load: async () => new Map(),
  }

  const service = new CustomersService(
    prisma as never,
    dataScope as never,
    metadata as never,
    {} as never,
    fieldValues as never,
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

  assert.equal(finalWheres.length, 2)
  for (const where of finalWheres) {
    assert.deepEqual(where, {
      organizationId: 'tenant-a',
      AND: [{ inSharedPool: false, owner: 'user-a' }],
      id: { in: ['customer-zhang'] },
    })
  }
})
