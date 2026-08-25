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
  type: string | null
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
  let sequence = 0

  const attachConditions = (view: ViewRow) => ({
    ...view,
    conditions: conditions.filter((condition) => condition.sysUserViewId === view.id),
  })
  const matches = (view: ViewRow, where: Partial<ViewRow>) =>
    Object.entries(where).every(([key, value]) => view[key as keyof ViewRow] === value)

  const sysUserView = {
    findMany: async ({ where }: { where: Partial<ViewRow> }) =>
      views
        .filter((view) => matches(view, where))
        .sort((a, b) => Number(b.pos - a.pos))
        .map(({ id, name, fixed, enable }) => ({ id, name, fixed, enable })),
    findFirst: async ({
      where,
      include,
    }: {
      where: Partial<ViewRow>
      include?: Record<string, unknown>
    }) => {
      const view = views.find((item) => matches(item, where))
      if (!view) return null
      return include ? attachConditions(view) : { ...view }
    },
    aggregate: async ({ where }: { where: Partial<ViewRow> }) => {
      const scoped = views.filter((view) => matches(view, where))
      return {
        _max: {
          pos: scoped.reduce<bigint | null>(
            (max, view) => (max === null || view.pos > max ? view.pos : max),
            null,
          ),
        },
      }
    },
    create: async ({ data, include }: { data: Record<string, unknown>; include?: unknown }) => {
      const id = `view-${++sequence}`
      const nested = data['conditions'] as { create?: Array<Record<string, unknown>> }
      const { conditions: _ignored, ...viewData } = data
      const view = { id, ...viewData } as ViewRow
      views.push(view)
      for (const item of nested?.create ?? []) {
        conditions.push({
          id: `condition-${++sequence}`,
          sysUserViewId: id,
          ...item,
        } as ConditionRow)
      }
      return include ? attachConditions(view) : { ...view }
    },
    update: async ({
      where,
      data,
      include,
    }: {
      where: { id: string }
      data: Record<string, unknown>
      include?: unknown
    }) => {
      const view = views.find((item) => item.id === where.id)
      if (!view) throw new Error('missing view')
      const nested = data['conditions'] as { create?: Array<Record<string, unknown>> } | undefined
      const { conditions: _ignored, ...viewData } = data
      Object.assign(view, viewData)
      for (const item of nested?.create ?? []) {
        conditions.push({
          id: `condition-${++sequence}`,
          sysUserViewId: view.id,
          ...item,
        } as ConditionRow)
      }
      return include ? attachConditions(view) : { ...view }
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = views.findIndex((view) => view.id === where.id)
      const [removed] = views.splice(index, 1)
      for (let cursor = conditions.length - 1; cursor >= 0; cursor--) {
        if (conditions[cursor]?.sysUserViewId === where.id) conditions.splice(cursor, 1)
      }
      return removed
    },
  }

  const prismaRecord = {
    sysUserView,
    sysUserViewCondition: {
      deleteMany: async ({ where }: { where: { sysUserViewId: string } }) => {
        let count = 0
        for (let index = conditions.length - 1; index >= 0; index--) {
          if (conditions[index]?.sysUserViewId === where.sysUserViewId) {
            conditions.splice(index, 1)
            count++
          }
        }
        return { count }
      },
    },
    $transaction: async (input: unknown) => {
      if (typeof input === 'function') return input(prismaRecord)
      return Promise.all(input as Promise<unknown>[])
    },
  }

  return {
    service: new UserViewsService(prismaRecord as unknown as PrismaService),
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
