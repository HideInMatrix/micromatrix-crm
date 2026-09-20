import assert from 'node:assert/strict'
import test from 'node:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import { UserViewsService } from './user-views.service'

interface ConditionRow {
  id: string
  sysUserViewId: string
  name: string
  value: string | null
  valueType: string | null
  _type: string | null
  multipleValue: boolean
  operator: string | null
  childrenValue: string | null
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
}

interface ViewRow {
  id: string
  userId: string
  name: string
  fixed: boolean
  enable: boolean
  resourceType: string
  organizationId: string
  pos: bigint
  searchMode: string
  createTime: bigint
  updateTime: bigint
  createUser: string
  updateUser: string
}

const userA = {
  id: 'user-a',
  tenantId: 'org-a',
  email: null,
  name: '甲',
  deptId: null,
  leaderId: null,
  roles: [],
  permissions: [],
} satisfies AuthUser

const userB = { ...userA, id: 'user-b', name: '乙' } satisfies AuthUser

function createHarness() {
  const views: ViewRow[] = []
  const conditions: ConditionRow[] = []
  type Order = { field: string; direction: 'asc' | 'desc' }
  const accessor = new Proxy(
    {},
    {
      get: (_target, field: string) => ({
        asc: () => ({ field, direction: 'asc' as const }),
        desc: () => ({ field, direction: 'desc' as const }),
      }),
    },
  ) as Record<string, { asc(): Order; desc(): Order }>

  const matches = <T extends object>(row: T, where: Partial<T>) =>
    Object.entries(where).every(([key, value]) => row[key as keyof T] === value)

  const makeViewCollection = (
    where: Partial<ViewRow> = {},
    selected: string[] | null = null,
    orders: Order[] = [],
    limit: number | null = null,
  ) => ({
    where(next: Partial<ViewRow>) {
      return makeViewCollection({ ...where, ...next }, selected, orders, limit)
    },
    select(...fields: string[]) {
      return makeViewCollection(where, fields, orders, limit)
    },
    orderBy(selector: (row: typeof accessor) => Order) {
      return makeViewCollection(where, selected, [...orders, selector(accessor)], limit)
    },
    limit(value: number) {
      return makeViewCollection(where, selected, orders, value)
    },
    async all() {
      const rows = views.filter((view) => matches(view, where)).slice()
      rows.sort((left, right) => {
        for (const order of orders) {
          const a = left[order.field as keyof ViewRow]
          const b = right[order.field as keyof ViewRow]
          if (a === b) continue
          const result = a! < b! ? -1 : 1
          return order.direction === 'asc' ? result : -result
        }
        return 0
      })
      const limited = limit === null ? rows : rows.slice(0, limit)
      if (!selected) return limited.map((view) => ({ ...view }))
      return limited.map((view) =>
        Object.fromEntries(selected.map((field) => [field, view[field as keyof ViewRow]])),
      )
    },
    async first() {
      return (await this.all())[0] ?? null
    },
    async create(data: ViewRow) {
      if (
        views.some(
          (view) =>
            view.organizationId === data.organizationId &&
            view.userId === data.userId &&
            view.resourceType === data.resourceType &&
            view.name === data.name,
        )
      ) {
        throw Object.assign(new Error('duplicate'), { sqlState: '23505' })
      }
      views.push({ ...data })
      return { ...data }
    },
    async update(data: Partial<ViewRow>) {
      const view = views.find((item) => matches(item, where))
      if (!view) return null
      Object.assign(view, data)
      return { ...view }
    },
    async delete() {
      const index = views.findIndex((view) => matches(view, where))
      if (index < 0) return null
      const [removed] = views.splice(index, 1)
      for (let cursor = conditions.length - 1; cursor >= 0; cursor -= 1) {
        if (conditions[cursor]?.sysUserViewId === removed?.id) conditions.splice(cursor, 1)
      }
      return removed ?? null
    },
  })

  const makeConditionCollection = (where: Partial<ConditionRow> = {}, orders: Order[] = []) => ({
    where(next: Partial<ConditionRow>) {
      return makeConditionCollection({ ...where, ...next }, orders)
    },
    orderBy(selector: (row: typeof accessor) => Order) {
      return makeConditionCollection(where, [...orders, selector(accessor)])
    },
    async all() {
      const rows = conditions.filter((condition) => matches(condition, where)).slice()
      rows.sort((left, right) => {
        for (const order of orders) {
          const a = left[order.field as keyof ConditionRow]
          const b = right[order.field as keyof ConditionRow]
          if (a === b) continue
          const result = a! < b! ? -1 : 1
          return order.direction === 'asc' ? result : -result
        }
        return 0
      })
      return rows.map((condition) => ({ ...condition }))
    },
    async createAll(data: ConditionRow[]) {
      conditions.push(...data.map((condition) => ({ ...condition })))
      return data.map((condition) => ({ ...condition }))
    },
    async deleteAndCount() {
      let count = 0
      for (let index = conditions.length - 1; index >= 0; index -= 1) {
        if (!matches(conditions[index]!, where)) continue
        conditions.splice(index, 1)
        count += 1
      }
      return count
    },
  })

  const publicOrm = {
    SysUserView: makeViewCollection(),
    SysUserViewCondition: makeConditionCollection(),
  }
  const prisma = {
    client: {
      orm: { public: publicOrm },
      transaction: async (
        callback: (tx: { orm: { public: typeof publicOrm } }) => Promise<unknown>,
      ) => callback({ orm: { public: publicOrm } }),
    },
  } as unknown as PrismaService

  return {
    service: new UserViewsService(prisma),
    views,
    conditions,
  }
}

test('新增视图使用 Cordys resourceType 与 4096 pos，并序列化全部条件值类型', async () => {
  const { service, views, conditions } = createHarness()
  const created = await service.create(userA, 'CLUE', {
    name: ' 重点线索 ',
    searchMode: 'OR',
    conditions: [
      { name: 'tags', operator: 'contains', value: ['重点'], multipleValue: true },
      { name: 'score', operator: 'gte', value: 10 },
      { name: 'rate', operator: 'gt', value: 1.5 },
      { name: 'active', operator: 'eq', value: true },
      {
        name: 'department',
        operator: 'eq',
        value: 'dept-a',
        containChildIds: ['dept-a'],
      },
    ],
  })

  assert.equal(created.name, '重点线索')
  assert.equal(views[0]?.resourceType, 'CLUE')
  assert.equal(views[0]?.organizationId, 'org-a')
  assert.equal(views[0]?.pos, 4096n)
  assert.deepEqual(
    conditions.map((condition) => [condition.valueType, condition.value]),
    [
      ['ARRAY', '["重点"]'],
      ['INT', '10'],
      ['FLOAT', '1.5'],
      ['BOOLEAN', 'true'],
      ['STRING', 'dept-a'],
    ],
  )
  assert.equal(conditions[4]?.childrenValue, '["dept-a"]')
})

test('详情与列表按组织、用户和 resourceType 三重隔离，并还原条件文本', async () => {
  const { service } = createHarness()
  const created = await service.create(userA, 'CUSTOMER', {
    name: '我的客户',
    conditions: [{ name: 'level', operator: 'eq', value: ['A', 'B'] }],
  })
  await service.create(userA, 'CLUE', { name: '我的线索' })
  await service.create(userB, 'CUSTOMER', { name: '乙的客户' })

  assert.deepEqual(
    (await service.list(userA, 'CUSTOMER')).map((view) => view.name),
    ['我的客户'],
  )
  const detail = await service.detail(userA, created.id, 'CUSTOMER')
  assert.deepEqual(detail.conditions[0]?.value, ['A', 'B'])
  await assert.rejects(() => service.detail(userB, created.id, 'CUSTOMER'), NotFoundException)
  await assert.rejects(() => service.detail(userA, created.id, 'CLUE'), NotFoundException)
})

test('编辑在同一事务中替换条件，不保留旧 SavedView JSON 契约', async () => {
  const { service, conditions } = createHarness()
  const created = await service.create(userA, 'CUSTOMER_CONTACT', {
    name: '联系人视图',
    conditions: [{ name: 'phone', operator: 'contains', value: '138' }],
  })
  const updated = await service.update(userA, 'CUSTOMER_CONTACT', {
    id: created.id,
    name: '有效联系人',
    searchMode: 'AND',
    conditions: [{ name: 'enable', operator: 'eq', value: true }],
  })

  assert.equal(updated.name, '有效联系人')
  assert.equal(conditions.length, 1)
  assert.equal(conditions[0]?.name, 'enable')
  assert.equal(conditions[0]?.valueType, 'BOOLEAN')
})

test('停用视图不能参与业务列表筛选，启用后可还原 FilterCondition', async () => {
  const { service } = createHarness()
  const created = await service.create(userA, 'CLUE_POOL', {
    name: '线索池视图',
    searchMode: 'OR',
    conditions: [{ name: 'source', operator: 'eq', value: 'website' }],
  })
  await service.toggleEnabled(userA, created.id, 'CLUE_POOL')
  await assert.rejects(
    () => service.resolveFilters(userA, created.id, 'CLUE_POOL'),
    BadRequestException,
  )
  await service.toggleEnabled(userA, created.id, 'CLUE_POOL')
  assert.deepEqual(await service.resolveFilters(userA, created.id, 'CLUE_POOL'), {
    searchMode: 'OR',
    conditions: [{ key: 'source', op: 'eq', value: 'website' }],
  })
})

test('固定、删除与跨资源操作均执行所有权校验', async () => {
  const { service } = createHarness()
  const created = await service.create(userA, 'CUSTOMER_POOL', { name: '公海视图' })
  await service.toggleFixed(userA, created.id, 'CUSTOMER_POOL')
  assert.equal((await service.list(userA, 'CUSTOMER_POOL'))[0]?.fixed, true)
  await assert.rejects(() => service.remove(userA, created.id, 'CUSTOMER'), NotFoundException)
  assert.deepEqual(await service.remove(userA, created.id, 'CUSTOMER_POOL'), {
    id: created.id,
    name: '公海视图',
  })
  assert.deepEqual(await service.list(userA, 'CUSTOMER_POOL'), [])
})

test('Cordys BEFORE/AFTER 拖拽只重排当前组织、用户和资源的视图', async () => {
  const { service } = createHarness()
  const first = await service.create(userA, 'CLUE', { name: '第一' })
  const second = await service.create(userA, 'CLUE', { name: '第二' })
  await service.create(userA, 'CUSTOMER', { name: '客户' })

  assert.deepEqual(
    (await service.list(userA, 'CLUE')).map((view) => view.id),
    [second.id, first.id],
  )
  await service.editPos(userA, 'CLUE', {
    orgId: 'org-a',
    moveId: first.id,
    targetId: second.id,
    moveMode: 'BEFORE',
  })
  assert.deepEqual(
    (await service.list(userA, 'CLUE')).map((view) => view.id),
    [first.id, second.id],
  )
  await assert.rejects(
    () =>
      service.editPos(userA, 'CLUE', {
        orgId: 'org-b',
        moveId: first.id,
        targetId: second.id,
        moveMode: 'AFTER',
      }),
    BadRequestException,
  )
})

test('对象和对象数组不会被错误写成 Cordys STRING 条件', async () => {
  const { service } = createHarness()
  await assert.rejects(
    () =>
      service.create(userA, 'CLUE', {
        name: '非法对象',
        conditions: [{ name: 'bad', operator: 'eq', value: { id: 'x' } }],
      }),
    BadRequestException,
  )
  await assert.rejects(
    () =>
      service.create(userA, 'CLUE', {
        name: '非法数组',
        conditions: [{ name: 'bad', operator: 'eq', value: [{ id: 'x' }] }],
      }),
    BadRequestException,
  )
})
