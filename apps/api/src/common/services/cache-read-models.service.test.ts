import assert from 'node:assert/strict'
import test from 'node:test'
import { NAVIGATION_MODULES, type HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../auth-user'
import type { PrismaService } from '../../prisma/prisma.service'
import type { TenantDerivedCacheService } from './tenant-derived-cache.service'
import { ModuleConfigsService } from '../../modules/module-configs/module-configs.service'
import { DepartmentsService } from '../../modules/departments/departments.service'
import { HomeStatisticService } from '../../modules/home/home-statistic.service'
import type { HomeDepartmentScopeService } from '../../modules/home/home-department-scope.service'
import type { HomeClueStatisticQuery } from '../../modules/home/home-clue-statistic.query'
import type { HomeOpportunityStatisticQuery } from '../../modules/home/home-opportunity-statistic.query'

function createCache() {
  const values = new Map<string, unknown>()
  const versions = new Map<string, number>()
  const invalidations: string[] = []
  const cache = {
    remember: async <T>(options: {
      tenantId: string
      namespace: string
      key: string
      loader: () => Promise<T>
      versioned?: boolean
    }) => {
      const versionKey = `${options.namespace}:${options.tenantId}`
      const version = options.versioned === false ? 0 : (versions.get(versionKey) ?? 0)
      const key = `${versionKey}:v${version}:${options.key}`
      if (values.has(key)) return values.get(key) as T
      const value = await options.loader()
      values.set(key, value)
      return value
    },
    invalidate: async (tenantId: string, namespace: string) => {
      const key = `${namespace}:${tenantId}`
      versions.set(key, (versions.get(key) ?? 0) + 1)
      invalidations.push(key)
    },
    fingerprint: (value: unknown) => JSON.stringify(value),
  } as unknown as TenantDerivedCacheService
  return { cache, invalidations }
}

test('ModuleConfig cache hit 跳过默认补种与查询，写后版本失效立即读取新值', async () => {
  const rows: Array<{ id: string; tenantId: string; key: string; enabled: boolean; sort: number }> = []
  let createManyCalls = 0
  let findManyCalls = 0
  const moduleConfig = {
    createMany: async ({ data }: { data: Array<Omit<(typeof rows)[number], 'id'>> }) => {
      createManyCalls += 1
      for (const item of data) {
        if (rows.some((row) => row.tenantId === item.tenantId && row.key === item.key)) continue
        rows.push({ ...item, id: `${item.tenantId}-${item.key}` })
      }
      return { count: data.length }
    },
    findMany: async ({ where }: { where: { tenantId: string } }) => {
      findManyCalls += 1
      return rows
        .filter((row) => row.tenantId === where.tenantId)
        .sort((left, right) => left.sort - right.sort || left.key.localeCompare(right.key))
    },
    update: async ({
      where,
      data,
    }: {
      where: { tenantId_key: { tenantId: string; key: string } }
      data: { enabled?: boolean; sort?: number }
    }) => {
      const row = rows.find(
        (item) =>
          item.tenantId === where.tenantId_key.tenantId && item.key === where.tenantId_key.key,
      )
      assert.ok(row)
      Object.assign(row, data)
      return row
    },
  }
  const prisma = {
    moduleConfig,
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  } as unknown as PrismaService
  const { cache, invalidations } = createCache()
  const service = new ModuleConfigsService(prisma, cache)

  const first = await service.list('tenant-a')
  const second = await service.list('tenant-a')
  assert.deepEqual(second, first)
  assert.equal(createManyCalls, 1)
  assert.equal(findManyCalls, 1)

  const configurable = NAVIGATION_MODULES.find((item) => item.configurable)
  assert.ok(configurable)
  const nextEnabled = !configurable.defaultEnabled
  await service.update('tenant-a', configurable.key, nextEnabled)
  const third = await service.list('tenant-a')
  assert.equal(third.find((item) => item.moduleKey === configurable.key)?.enabled, nextEnabled)
  assert.equal(findManyCalls, 2)
  assert.ok(invalidations.includes('module-config:tenant-a'))
})

test('Directory 部门树 cache hit 不重复查询，部门创建后主动失效', async () => {
  const now = new Date()
  const departments: Array<{
    id: string
    tenantId: string
    name: string
    parentId: string | null
    leaderId: string | null
    sort: number
    createdAt: Date
  }> = [
    {
      id: 'dept-root',
      tenantId: 'tenant-a',
      name: '总部',
      parentId: null,
      leaderId: null,
      sort: 0,
      createdAt: now,
    },
  ]
  let findManyCalls = 0
  const prisma = {
    department: {
      findMany: async () => {
        findManyCalls += 1
        return departments
      },
      findFirst: async () => null,
      create: async ({ data }: { data: Omit<(typeof departments)[number], 'id' | 'createdAt' | 'leaderId'> }) => {
        const row = { ...data, id: `dept-${departments.length}`, createdAt: now, leaderId: null }
        departments.push(row)
        return row
      },
    },
    user: { findMany: async () => [] },
  } as unknown as PrismaService
  const { cache, invalidations } = createCache()
  const service = new DepartmentsService(prisma, cache)

  assert.equal((await service.tree('tenant-a')).length, 1)
  assert.equal((await service.tree('tenant-a')).length, 1)
  assert.equal(findManyCalls, 1)

  await service.create('tenant-a', { name: '华东区', parentId: null, sort: 1 })
  assert.equal((await service.tree('tenant-a')).length, 2)
  assert.equal(findManyCalls, 2)
  assert.ok(invalidations.includes('directory:tenant-a'))
})

test('Home statistic 相同用户和筛选命中缓存，不同筛选摘要隔离', async () => {
  const { cache } = createCache()
  let clueLoads = 0
  const departments = { tree: async () => [] } as unknown as HomeDepartmentScopeService
  const clues = {
    execute: async () => ({ load: ++clueLoads }),
  } as unknown as HomeClueStatisticQuery
  const opportunities = { execute: async () => ({}) } as unknown as HomeOpportunityStatisticQuery
  const service = new HomeStatisticService(departments, clues, opportunities, cache)
  const user: AuthUser = {
    id: 'user-a',
    tenantId: 'tenant-a',
    email: 'admin@example.com',
    name: '管理员',
    deptId: 'dept-a',
    leaderId: null,
    permissions: ['menu:lead'],
    roles: [
      {
        id: 'role-a',
        name: '销售',
        permissions: ['menu:lead'],
        dataScope: 'DEPT',
        scopeDeptIds: [],
      },
    ],
  }
  const firstRequest: HomeStatisticRequest = {
    searchType: 'DEPARTMENT',
    deptIds: ['dept-b', 'dept-a'],
  }

  const first = await service.lead(user, firstRequest)
  const second = await service.lead(user, { ...firstRequest, deptIds: ['dept-a', 'dept-b'] })
  const third = await service.lead(user, { searchType: 'SELF', deptIds: [] })

  assert.deepEqual(second, first)
  assert.equal(clueLoads, 2)
  assert.notDeepEqual(third, first)
})
