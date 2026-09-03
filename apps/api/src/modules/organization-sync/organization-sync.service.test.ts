import assert from 'node:assert/strict'
import test from 'node:test'
import { OrganizationSyncService } from './organization-sync.service'

test('跳过部门冲突会级联跳过下级部门和成员并更新最终统计', async () => {
  const items = [
    {
      id: 'dept-conflict',
      tenantId: 'tenant-a',
      batchId: 'batch-a',
      resourceType: 'DEPARTMENT',
      externalId: '2',
      externalKey: '2',
      parentExternalKey: '1',
      action: 'CONFLICT',
      localId: 'local-dept',
    },
    {
      id: 'dept-child',
      tenantId: 'tenant-a',
      batchId: 'batch-a',
      resourceType: 'DEPARTMENT',
      externalId: '3',
      externalKey: '3',
      parentExternalKey: '2',
      action: 'CREATE',
      localId: null,
    },
    {
      id: 'user-child',
      tenantId: 'tenant-a',
      batchId: 'batch-a',
      resourceType: 'USER',
      externalId: 'user-a',
      externalKey: 'user-a',
      parentExternalKey: '3',
      action: 'CREATE',
      localId: null,
    },
  ]
  let savedCounts: Record<string, number> | undefined
  const tx = {
    organizationSyncItem: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(
          items.find((item) => item.id === where.id)!,
          data,
        )
      },
      findMany: async ({ select }: { select?: Record<string, boolean> }) =>
        select
          ? items
              .filter((item) => item.resourceType === 'DEPARTMENT')
              .map(({ externalKey, parentExternalKey }) => ({ externalKey, parentExternalKey }))
          : items,
      updateMany: async () => {
        for (const item of items) Object.assign(item, { action: 'SKIP' })
        return { count: 3 }
      },
    },
    organizationSyncBatch: {
      update: async ({ data }: { data: { counts: Record<string, number> } }) => {
        savedCounts = data.counts
      },
    },
  }
  const prisma = {
    organizationSyncBatch: {
      findFirst: async () => ({
        id: 'batch-a',
        tenantId: 'tenant-a',
        provider: 'WECOM',
        status: 'PREVIEW_READY',
      }),
    },
    organizationSyncItem: {
      findMany: async () => [items[0]],
    },
    $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
  }
  const service = new OrganizationSyncService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
  )
  service.batch = async () =>
    ({
      id: 'batch-a',
      status: 'PREVIEW_READY',
    }) as never

  await service.resolve(
    { id: 'admin-a', tenantId: 'tenant-a', name: '管理员' } as never,
    'batch-a',
    { items: [{ itemId: 'dept-conflict', resolution: 'SKIP' }] },
  )

  assert.deepEqual(
    items.map((item) => item.action),
    ['SKIP', 'SKIP', 'SKIP'],
  )
  assert.equal(savedCounts?.skip, 3)
  assert.equal(savedCounts?.conflict, 0)
})

test('Redis 组织同步 lease busy 时在企业微信和数据库预览路径前快速冲突', async () => {
  let syncContextCalls = 0
  const coordination = {
    run: async () => ({ executed: false, source: 'REDIS', reason: 'BUSY' }),
    runtimeStatus: async () => null,
  }
  const service = new OrganizationSyncService(
    {} as never,
    {
      getWeComSyncContext: async () => {
        syncContextCalls += 1
        throw new Error('不应进入企业微信配置读取')
      },
    } as never,
    {} as never,
    {} as never,
    coordination as never,
  )

  await assert.rejects(
    () =>
      service.createPreview(
        { id: 'admin-a', tenantId: 'tenant-a', name: '管理员' } as never,
        { targetDepartmentId: 'root' },
      ),
    /当前正在执行组织同步任务/,
  )
  assert.equal(syncContextCalls, 0)
})

test('Redis unavailable 时组织同步仍进入原数据库预览核心路径', async () => {
  let coreCalls = 0
  const coordination = {
    run: async (
      _tenantId: string,
      _operatorId: string,
      _phase: string,
      _batchId: string | null,
      task: (runtime: { setBatchId(batchId: string): Promise<void> }) => Promise<unknown>,
    ) => ({
      executed: true,
      source: 'UNCOORDINATED',
      value: await task({ setBatchId: async () => undefined }),
    }),
    runtimeStatus: async () => null,
  }
  const service = new OrganizationSyncService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    coordination as never,
  )
  ;(service as unknown as {
    createPreviewCore: () => Promise<{ id: string; status: string }>
  }).createPreviewCore = async () => {
    coreCalls += 1
    return { id: 'batch-a', status: 'PREVIEW_READY' }
  }

  const result = await service.createPreview(
    { id: 'admin-a', tenantId: 'tenant-a', name: '管理员' } as never,
    { targetDepartmentId: 'root' },
  )
  assert.equal(coreCalls, 1)
  assert.equal(result.id, 'batch-a')
})

test('Redis 运行态包含 active batch 时 gate 只读取该批次一次并复用 latest', async () => {
  let batchQueries = 0
  const batch = {
    id: 'batch-running',
    tenantId: 'tenant-a',
    provider: 'WECOM',
    status: 'FETCHING',
  }
  const prisma = {
    organizationSyncBatch: {
      findFirst: async () => {
        batchQueries += 1
        return batch
      },
    },
  }
  const integrations = {
    getWeCom: async () => ({
      configured: true,
      lastTestSucceeded: true,
      syncEnabled: true,
      syncDefaultRoleId: 'role-a',
    }),
  }
  const coordination = {
    runtimeStatus: async () => ({
      phase: 'FETCHING',
      operatorId: 'admin-a',
      batchId: 'batch-running',
      startedAt: '2026-09-03T12:00:00.000Z',
    }),
  }
  const service = new OrganizationSyncService(
    prisma as never,
    integrations as never,
    {} as never,
    {} as never,
    coordination as never,
  )
  ;(service as unknown as { toBatchVO: (row: typeof batch) => { id: string; status: string } }).toBatchVO =
    (row) => ({ id: row.id, status: row.status })

  const result = await service.gate('tenant-a')
  assert.equal(batchQueries, 1)
  assert.equal(result.disabledReason, '正在获取企业微信组织数据')
  assert.equal(result.activeBatch?.id, 'batch-running')
  assert.equal(result.latestBatch?.id, 'batch-running')
})
