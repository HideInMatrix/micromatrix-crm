import assert from 'node:assert/strict'
import test from 'node:test'
import { instantFromDate } from '../../prisma/temporal'
import type { PrismaService } from '../../prisma/prisma.service'
import {
  OperationLogCleanupSources,
  OperationLogSettingsService,
} from './operation-log-settings.service'

type StoredSetting = {
  retentionDays: number | null
  lastCleanupAt: ReturnType<typeof instantFromDate> | null
  lastCleanupDeleted: number
  lastCleanupSource: 'AUTO' | 'MANUAL' | null
}

interface RawQueryHarness {
  sql: string
  values: unknown[]
  returnsRow: () => RawQueryHarness
  build: () => RawQueryHarness
}

function prismaFixture(initial: StoredSetting | null = null) {
  let row = initial
  const writes: RawQueryHarness[] = []
  const collection = {
    where() {
      return this
    },
    select() {
      return this
    },
    first: async () => row,
  }
  const prisma = {
    client: {
      orm: { public: { OperationLogSettings: collection } },
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
          writes.push(query)
          return query
        },
      },
      sql: {
        public: {
          operation_log_settings: {
            columns: {
              retentionDays: {},
              lastCleanupAt: {},
              lastCleanupDeleted: {},
              lastCleanupSource: {},
            },
          },
        },
      },
      runtime: () => ({
        query: async function* (query: RawQueryHarness) {
          if (query.values.length === 4) {
            const [tenantId, atIso, deleted, source] = query.values
            assert.equal(typeof tenantId, 'string')
            row = {
              retentionDays: row?.retentionDays ?? null,
              lastCleanupAt: instantFromDate(new Date(String(atIso))),
              lastCleanupDeleted: Number(deleted),
              lastCleanupSource: source as 'AUTO' | 'MANUAL',
            }
          } else {
            const [tenantId, retentionDays] = query.values
            assert.equal(typeof tenantId, 'string')
            row = {
              retentionDays: Number(retentionDays),
              lastCleanupAt: row?.lastCleanupAt ?? null,
              lastCleanupDeleted: row?.lastCleanupDeleted ?? 0,
              lastCleanupSource: row?.lastCleanupSource ?? null,
            }
          }
          yield row
        },
      }),
    },
  } as unknown as PrismaService

  return { prisma, writes, getRow: () => row }
}

test('未配置租户继承 180 天默认值且不伪装为已配置', async () => {
  const { prisma } = prismaFixture()
  const service = new OperationLogSettingsService(prisma)

  assert.deepEqual(await service.get('tenant-a'), {
    configured: false,
    retentionDays: 180,
    defaultRetentionDays: 180,
    permanent: false,
    lastCleanupAt: null,
    lastCleanupDeleted: 0,
    lastCleanupSource: null,
  })
})

test('状态行 retentionDays=null 继续继承部署默认值', async () => {
  const { prisma } = prismaFixture({
    retentionDays: null,
    lastCleanupAt: instantFromDate(new Date('2026-09-04T04:15:00.000Z')),
    lastCleanupDeleted: 12,
    lastCleanupSource: OperationLogCleanupSources.AUTO,
  })
  const service = new OperationLogSettingsService(prisma)
  const setting = await service.get('tenant-a')

  assert.equal(setting.configured, false)
  assert.equal(setting.retentionDays, 180)
  assert.equal(setting.lastCleanupDeleted, 12)
  assert.equal(setting.lastCleanupSource, 'AUTO')
})

test('显式天数与永久保留分别写入数字和内部 0 sentinel', async () => {
  const { prisma, writes } = prismaFixture()
  const service = new OperationLogSettingsService(prisma)

  const days = await service.update('tenant-a', 365)
  const permanent = await service.update('tenant-a', null)

  assert.deepEqual(
    writes.map(({ values }) => values[1]),
    [365, 0],
  )
  assert.equal(days.configured, true)
  assert.equal(days.retentionDays, 365)
  assert.equal(days.permanent, false)
  assert.equal(permanent.configured, true)
  assert.equal(permanent.retentionDays, null)
  assert.equal(permanent.permanent, true)
})

test('策略服务拒绝越界保留天数', async () => {
  const { prisma } = prismaFixture()
  const service = new OperationLogSettingsService(prisma)
  await assert.rejects(() => service.update('tenant-a', 29), /30～3650/)
  await assert.rejects(() => service.update('tenant-a', 3651), /30～3650/)
})

test('自动清理状态首次落库保持 retentionDays=null 继承默认值', async () => {
  const { prisma, getRow } = prismaFixture()
  const service = new OperationLogSettingsService(prisma)
  const at = new Date('2026-09-04T04:15:00.000Z')

  const setting = await service.recordCleanup('tenant-a', 5, OperationLogCleanupSources.AUTO, at)

  assert.equal(getRow()?.retentionDays, null)
  assert.equal(setting.configured, false)
  assert.equal(setting.retentionDays, 180)
  assert.equal(setting.lastCleanupDeleted, 5)
  assert.equal(setting.lastCleanupAt, at.toISOString())
})
