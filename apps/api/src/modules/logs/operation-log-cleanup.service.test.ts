import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { OperationLogCleanupSource } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  OperationLogCleanupService,
  resolveOperationLogCleanupConfig,
} from './operation-log-cleanup.service'
import type { OperationLogSettingsService } from './operation-log-settings.service'

const baseSetting = {
  configured: false,
  retentionDays: 180,
  defaultRetentionDays: 180,
  permanent: false,
  lastCleanupAt: null,
  lastCleanupDeleted: 0,
  lastCleanupSource: null,
} as const

function settingsMock(retentionDays: number | null = 180) {
  const records: Array<{ tenantId: string; deleted: number; source: string; at: Date }> = []
  const settings = {
    resolvePolicy: async () => ({
      retentionDays,
      setting: {
        ...baseSetting,
        retentionDays,
        permanent: retentionDays === null,
      },
    }),
    recordCleanup: async (tenantId: string, deleted: number, source: string, at: Date) => {
      records.push({ tenantId, deleted, source, at })
      return {
        ...baseSetting,
        retentionDays,
        permanent: retentionDays === null,
        lastCleanupAt: at.toISOString(),
        lastCleanupDeleted: deleted,
        lastCleanupSource: source,
      }
    },
  } as unknown as OperationLogSettingsService
  return { settings, records }
}

test('操作日志清理配置使用安全默认值并拒绝危险批次', () => {
  assert.deepEqual(resolveOperationLogCleanupConfig({}), {
    retentionDays: 180,
    batchSize: 1_000,
    maxBatches: 20,
  })
  assert.deepEqual(
    resolveOperationLogCleanupConfig({
      OPERATION_LOG_RETENTION_DAYS: '90',
      OPERATION_LOG_CLEANUP_BATCH_SIZE: '500',
      OPERATION_LOG_CLEANUP_MAX_BATCHES: '8',
    }),
    { retentionDays: 90, batchSize: 500, maxBatches: 8 },
  )
  assert.throws(
    () => resolveOperationLogCleanupConfig({ OPERATION_LOG_CLEANUP_BATCH_SIZE: '10001' }),
    /OPERATION_LOG_CLEANUP_BATCH_SIZE/,
  )
  assert.throws(
    () => resolveOperationLogCleanupConfig({ OPERATION_LOG_CLEANUP_MAX_BATCHES: '0' }),
    /OPERATION_LOG_CLEANUP_MAX_BATCHES/,
  )
})

test('租户清理只删除当前租户 cutoff 之前记录并保存执行状态', async () => {
  const finds: Array<Record<string, unknown>> = []
  const deletedWhere: Array<Record<string, unknown>> = []
  const batches = [[{ id: 'old-1' }, { id: 'old-2' }]]
  const prisma = {
    operationLog: {
      findMany: async (args: Record<string, unknown>) => {
        finds.push(args)
        return batches.shift() ?? []
      },
      deleteMany: async (args: { where: Record<string, unknown> }) => {
        deletedWhere.push(args.where)
        return { count: 2 }
      },
    },
  } as unknown as PrismaService
  const { settings, records } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)
  const now = new Date('2026-09-04T00:00:00.000Z')

  const result = await service.cleanupTenant('tenant-a', now, OperationLogCleanupSource.MANUAL)

  assert.equal(result.deleted, 2)
  assert.equal(result.skipped, false)
  assert.equal(result.cutoff, '2026-03-08T00:00:00.000Z')
  assert.equal(finds.length, 1)
  assert.equal((finds[0].where as { tenantId: string }).tenantId, 'tenant-a')
  assert.equal(
    (finds[0].where as { createdAt: { lt: Date } }).createdAt.lt.toISOString(),
    '2026-03-08T00:00:00.000Z',
  )
  assert.equal(deletedWhere[0].tenantId, 'tenant-a')
  assert.deepEqual(
    records.map(({ tenantId, deleted, source }) => ({ tenantId, deleted, source })),
    [{ tenantId: 'tenant-a', deleted: 2, source: 'MANUAL' }],
  )
})

test('历史积压时单租户清理严格受 maxBatches 上限约束', async () => {
  let findCalls = 0
  let deleteCalls = 0
  const prisma = {
    operationLog: {
      findMany: async () => {
        findCalls += 1
        return Array.from({ length: 1_000 }, (_, index) => ({ id: `${findCalls}-${index}` }))
      },
      deleteMany: async () => {
        deleteCalls += 1
        return { count: 1_000 }
      },
    },
  } as unknown as PrismaService
  const { settings } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)

  const result = await service.cleanupTenant('tenant-a', new Date('2026-09-04T00:00:00.000Z'))

  assert.equal(result.deleted, 20_000)
  assert.equal(findCalls, 20)
  assert.equal(deleteCalls, 20)
})

test('永久保留租户跳过删除但记录最近检查状态', async () => {
  let touchedOperationLog = false
  const prisma = {
    operationLog: {
      findMany: async () => {
        touchedOperationLog = true
        return []
      },
      deleteMany: async () => {
        touchedOperationLog = true
        return { count: 0 }
      },
    },
  } as unknown as PrismaService
  const { settings, records } = settingsMock(null)
  const service = new OperationLogCleanupService(prisma, settings)

  const result = await service.cleanupTenant('tenant-permanent')

  assert.equal(result.skipped, true)
  assert.equal(result.deleted, 0)
  assert.equal(result.cutoff, null)
  assert.equal(touchedOperationLog, false)
  assert.equal(records[0].tenantId, 'tenant-permanent')
})

test('scheduled cleanup 复用 operation-log-cleanup DAILY coordination', async () => {
  const calls: Array<{ job: string; slot: string }> = []
  const coordinator = {
    runScheduledOnce: async (job: string, slot: string, task: () => Promise<unknown>) => {
      calls.push({ job, slot })
      return { executed: true, source: 'REDIS', value: await task() }
    },
  } as unknown as DistributedCoordinatorService
  const prisma = {
    tenant: { findMany: async () => [] },
  } as unknown as PrismaService
  const { settings } = settingsMock()

  await new OperationLogCleanupService(prisma, settings, coordinator).scheduledCleanup(
    new Date('2026-09-04T04:15:00.000Z'),
  )
  assert.deepEqual(calls, [{ job: 'operation-log-cleanup', slot: 'DAILY' }])
})

test('自动清理逐租户执行且单租户失败不阻断其他租户', async () => {
  const prisma = {
    tenant: { findMany: async () => [{ id: 'tenant-a' }, { id: 'tenant-b' }] },
    operationLog: {
      findMany: async ({ where }: { where: { tenantId: string } }) => {
        if (where.tenantId === 'tenant-a') throw new Error('tenant-a failed')
        return []
      },
      deleteMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaService
  const { settings, records } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)

  assert.equal(await service.cleanupAllTenants(new Date('2026-09-04T04:15:00.000Z')), 0)
  assert.equal(
    records.some(({ tenantId }) => tenantId === 'tenant-b'),
    true,
  )
})

test('全量清空只删除当前租户全部操作日志并返回真实数量', async () => {
  const calls: Array<Record<string, unknown>> = []
  const prisma = {
    operationLog: {
      deleteMany: async (args: Record<string, unknown>) => {
        calls.push(args)
        return { count: 37 }
      },
    },
  } as unknown as PrismaService
  const { settings, records } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)

  const result = await service.clearTenant('tenant-a')

  assert.deepEqual(result, { deleted: 37 })
  assert.deepEqual(calls, [{ where: { tenantId: 'tenant-a' } }])
  assert.equal(records.length, 0)
})
