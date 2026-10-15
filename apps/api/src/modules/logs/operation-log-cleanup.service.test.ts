import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { PrismaService } from '../../prisma.service'
import {
  OperationLogCleanupService,
  resolveOperationLogCleanupConfig,
} from './operation-log-cleanup.service'
import {
  OperationLogCleanupSources,
  type OperationLogSettingsService,
} from './operation-log-settings.service'

interface RawQueryHarness {
  sql: string
  values: unknown[]
  returnsRow: () => RawQueryHarness
  build: () => RawQueryHarness
}

function prismaFixture(
  options: {
    tenants?: Array<{ id: string }>
    onQuery?: (query: RawQueryHarness) => unknown[] | Promise<unknown[]>
  } = {},
) {
  const prisma = {
    client: {
      orm: {
        public: {
          Tenants: {
            select() {
              return this
            },
            all: async () => options.tenants ?? [],
          },
        },
      },
      raw: {
        sql(strings: TemplateStringsArray, ...values: unknown[]) {
          const query: RawQueryHarness = {
            sql: strings.join('?'),
            values,
            returnsRow() {
              return this
            },
            build() {
              return this
            },
          }
          return query
        },
      },
      sql: {
        public: {
          operation_logs: { columns: { id: {} } },
          login_logs: { columns: { id: {} } },
        },
      },
      runtime: () => ({
        query: async function* (query: RawQueryHarness) {
          const rows = (await options.onQuery?.(query)) ?? []
          yield* rows
        },
      }),
    },
  } as unknown as PrismaService
  return prisma
}

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

test('清理仅作用于指定分类及本租户，并独立记录清理状态', async () => {
  const queries: RawQueryHarness[] = []
  const prisma = prismaFixture({
    onQuery: (query) => {
      queries.push(query)
      if (query.sql.includes('FROM login_logs')) return [{ id: 'login-1' }]
      if (query.sql.includes('"module" =')) return [{ id: 'event-1' }]
      return [{ id: 'op-1' }, { id: 'op-2' }]
    },
  })
  const { settings, records } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)
  const now = new Date('2026-09-04T00:00:00.000Z')

  const operation = await service.cleanupTenant(
    'tenant-a',
    now,
    OperationLogCleanupSources.MANUAL,
    'operation',
  )
  const login = await service.cleanupTenant(
    'tenant-a',
    now,
    OperationLogCleanupSources.MANUAL,
    'login',
  )
  const event = await service.cleanupTenant(
    'tenant-a',
    now,
    OperationLogCleanupSources.MANUAL,
    'event',
  )

  assert.equal(operation.deleted, 2)
  assert.equal(login.deleted, 1)
  assert.equal(event.deleted, 1)
  assert.equal(operation.cutoff, '2026-03-08T00:00:00.000Z')
  assert.equal(queries.length, 3)
  assert.match(queries[0].sql, /FROM operation_logs/)
  assert.match(queries[0].sql, /"module" <> 'externalEvent'/)
  assert.match(queries[1].sql, /FROM login_logs/)
  assert.match(queries[2].sql, /"module" = 'externalEvent'/)
  assert.ok(queries.every((q) => q.sql.includes('"tenantId" = ?')))
  assert.ok(
    queries.every(
      (q) =>
        JSON.stringify(q.values) === JSON.stringify(['tenant-a', '2026-03-08T00:00:00.000Z', 1000]),
    ),
  )
  assert.deepEqual(
    records.map(({ deleted }) => deleted),
    [2, 1, 1],
  )
})

test('每种日志都有独立的 maxBatches 限额', async () => {
  let operationCalls = 0
  let loginCalls = 0
  let eventCalls = 0
  const prisma = prismaFixture({
    onQuery: (query) => {
      if (query.sql.includes('FROM login_logs')) loginCalls++
      else if (query.sql.includes('"module" =')) eventCalls++
      else operationCalls++
      return Array.from({ length: 1_000 }, (_, index) => ({ id: String(index) }))
    },
  })
  const { settings } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)
  for (const category of ['operation', 'login', 'event'] as const) {
    const result = await service.cleanupTenant(
      'tenant-a',
      new Date('2026-09-04T00:00:00.000Z'),
      OperationLogCleanupSources.MANUAL,
      category,
    )
    assert.equal(result.deleted, 20_000)
  }
  assert.equal(operationCalls, 20)
  assert.equal(loginCalls, 20)
  assert.equal(eventCalls, 20)
})

test('永久保留租户跳过删除但记录最近检查状态', async () => {
  let touchedOperationLog = false
  const prisma = prismaFixture({
    onQuery: () => {
      touchedOperationLog = true
      return []
    },
  })
  const { settings, records } = settingsMock(null)
  const service = new OperationLogCleanupService(prisma, settings)

  const result = await service.cleanupTenant('tenant-permanent')

  assert.equal(result.skipped, true)
  assert.equal(result.deleted, 0)
  assert.equal(result.cutoff, null)
  assert.equal(touchedOperationLog, false)
  assert.equal(records[0].tenantId, 'tenant-permanent')
})

test('租户永久保留时同时跳过操作和登录日志', async () => {
  const queries: RawQueryHarness[] = []
  const prisma = prismaFixture({
    onQuery: (query) => {
      queries.push(query)
      return []
    },
  })
  const { settings } = settingsMock(null)
  const service = new OperationLogCleanupService(prisma, settings)
  const result = await service.cleanupTenant('tenant-a')
  assert.equal(result.skipped, true)
  assert.equal(queries.length, 0)
})

test('无法关联租户的登录记录在定时任务中按部署默认保留期清理', async () => {
  const queries: RawQueryHarness[] = []
  const prisma = prismaFixture({
    onQuery: (query) => {
      queries.push(query)
      return query.sql.includes('IS NULL') ? [{ id: 'orphan-login' }] : []
    },
  })
  const { settings } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)
  const deleted = await service.cleanupAllTenants(new Date('2026-09-04T00:00:00.000Z'))
  assert.equal(deleted, 1)
  assert.equal(queries.length, 1)
  assert.match(queries[0].sql, /FROM login_logs/)
  assert.match(queries[0].sql, /"tenantId" IS NULL/)
  assert.deepEqual(queries[0].values, ['2026-03-08T00:00:00.000Z', 1000])
})

test('scheduled cleanup 复用 operation-log-cleanup DAILY coordination', async () => {
  const calls: Array<{ job: string; slot: string }> = []
  const coordinator = {
    runScheduledOnce: async (job: string, slot: string, task: () => Promise<unknown>) => {
      calls.push({ job, slot })
      return { executed: true, source: 'REDIS', value: await task() }
    },
  } as unknown as DistributedCoordinatorService
  const prisma = prismaFixture()
  const { settings } = settingsMock()

  await new OperationLogCleanupService(prisma, settings, coordinator).scheduledCleanup(
    new Date('2026-09-04T04:15:00.000Z'),
  )
  assert.deepEqual(calls, [{ job: 'operation-log-cleanup', slot: 'DAILY' }])
})

test('自动清理逐租户执行且单租户失败不阻断其他租户', async () => {
  const prisma = prismaFixture({
    tenants: [{ id: 'tenant-a' }, { id: 'tenant-b' }],
    onQuery: (query) => {
      if (query.values[0] === 'tenant-a') throw new Error('tenant-a failed')
      return []
    },
  })
  const { settings, records } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)

  assert.equal(await service.cleanupAllTenants(new Date('2026-09-04T04:15:00.000Z')), 0)
  assert.equal(
    records.some(({ tenantId }) => tenantId === 'tenant-b'),
    true,
  )
})

test('全量清空只删除当前租户全部操作日志并返回真实数量', async () => {
  const calls: RawQueryHarness[] = []
  const prisma = prismaFixture({
    onQuery: (query) => {
      calls.push(query)
      return Array.from({ length: 37 }, (_, index) => ({ id: `log-${index}` }))
    },
  })
  const { settings, records } = settingsMock(180)
  const service = new OperationLogCleanupService(prisma, settings)

  const result = await service.clearTenant('tenant-a')

  assert.deepEqual(result, { deleted: 37 })
  assert.equal(calls.length, 1)
  assert.match(calls[0].sql, /DELETE FROM operation_logs/)
  assert.deepEqual(calls[0].values, ['tenant-a'])
  assert.equal(records.length, 0)
})
