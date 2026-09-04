import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  OperationLogCleanupService,
  resolveOperationLogCleanupConfig,
} from './operation-log-cleanup.service'

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

test('清理只删除 cutoff 之前记录并在不足一批时停止', async () => {
  const finds: Array<Record<string, unknown>> = []
  const deletedIds: string[][] = []
  const batches = [[{ id: 'old-1' }, { id: 'old-2' }]]
  const prisma = {
    operationLog: {
      findMany: async (args: Record<string, unknown>) => {
        finds.push(args)
        return batches.shift() ?? []
      },
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        deletedIds.push(args.where.id.in)
        return { count: args.where.id.in.length }
      },
    },
  } as unknown as PrismaService

  const service = new OperationLogCleanupService(prisma)
  const now = new Date('2026-09-04T00:00:00.000Z')
  assert.equal(await service.cleanup(now), 2)
  assert.equal(finds.length, 1)
  assert.deepEqual(deletedIds, [['old-1', 'old-2']])

  const where = finds[0].where as { createdAt: { lt: Date } }
  assert.equal(where.createdAt.lt.toISOString(), '2026-03-08T00:00:00.000Z')
})

test('历史积压时单轮清理严格受 maxBatches 上限约束', async () => {
  let findCalls = 0
  let deleteCalls = 0
  const prisma = {
    operationLog: {
      findMany: async () => {
        findCalls += 1
        return Array.from({ length: 1_000 }, (_, index) => ({ id: `${findCalls}-${index}` }))
      },
      deleteMany: async (args: { where: { id: { in: string[] } } }) => {
        deleteCalls += 1
        return { count: args.where.id.in.length }
      },
    },
  } as unknown as PrismaService

  const service = new OperationLogCleanupService(prisma)
  assert.equal(await service.cleanup(new Date('2026-09-04T00:00:00.000Z')), 20_000)
  assert.equal(findCalls, 20)
  assert.equal(deleteCalls, 20)
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
    operationLog: {
      findMany: async () => [],
      deleteMany: async () => ({ count: 0 }),
    },
  } as unknown as PrismaService

  await new OperationLogCleanupService(prisma, coordinator).scheduledCleanup(
    new Date('2026-09-04T04:15:00.000Z'),
  )
  assert.deepEqual(calls, [{ job: 'operation-log-cleanup', slot: 'DAILY' }])
})
