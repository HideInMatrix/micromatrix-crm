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
