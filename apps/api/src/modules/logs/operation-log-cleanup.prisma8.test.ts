import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaFixtureClient } from '../../testing/prisma-fixture-client'
import { createPrisma8Client } from '../../prisma/prisma8-client'
import type { Prisma8Service } from '../../prisma/prisma8.service'
import { OperationLogCleanupService } from './operation-log-cleanup.service'
import {
  OperationLogCleanupSources,
  OperationLogSettingsService,
} from './operation-log-settings.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OperationLog cleanup/settings 由 Prisma 8 保持原子 upsert、Temporal 状态与批量删除语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const fixtureDb = createPrismaFixtureClient(databaseUrl)
    const prisma8Client = await createPrisma8Client(databaseUrl)
    const suffix = randomUUID().replaceAll('-', '')
    const now = new Date('2026-09-16T12:00:00.000Z')

    await fixtureDb.$connect()
    await prisma8Client.connect()
    let tenantId: string | null = null
    try {
      const tenant = await fixtureDb.tenant.create({
        data: { name: `Prisma8 operation log ${suffix}`, slug: `p8-log-${suffix}` },
      })
      tenantId = tenant.id
      await fixtureDb.operationLog.createMany({
        data: [
          {
            tenantId: tenant.id,
            module: 'PRISMA8_TEST',
            action: 'OLD_A',
            createdAt: new Date('2026-07-01T00:00:00.000Z'),
          },
          {
            tenantId: tenant.id,
            module: 'PRISMA8_TEST',
            action: 'OLD_B',
            createdAt: new Date('2026-07-02T00:00:00.000Z'),
          },
          {
            tenantId: tenant.id,
            module: 'PRISMA8_TEST',
            action: 'RECENT',
            createdAt: new Date('2026-09-10T00:00:00.000Z'),
          },
        ],
      })

      const prisma8 = { client: prisma8Client } as Prisma8Service
      const settings = new OperationLogSettingsService(prisma8)
      const cleanup = new OperationLogCleanupService(prisma8, settings)

      const configured = await settings.update(tenant.id, 30)
      assert.equal(configured.configured, true)
      assert.equal(configured.retentionDays, 30)
      assert.equal(configured.permanent, false)

      const result = await cleanup.cleanupTenant(
        tenant.id,
        now,
        OperationLogCleanupSources.AUTO,
      )
      assert.equal(result.skipped, false)
      assert.equal(result.deleted, 2)
      assert.equal(result.cutoff, '2026-08-17T12:00:00.000Z')
      assert.equal(result.setting.retentionDays, 30)
      assert.equal(result.setting.lastCleanupDeleted, 2)
      assert.equal(result.setting.lastCleanupSource, 'AUTO')
      assert.equal(result.setting.lastCleanupAt, now.toISOString())

      assert.deepEqual(
        await fixtureDb.operationLog.findMany({
          where: { tenantId: tenant.id },
          orderBy: { createdAt: 'asc' },
          select: { action: true },
        }),
        [{ action: 'RECENT' }],
      )

      assert.deepEqual(await cleanup.clearTenant(tenant.id), { deleted: 1 })
      assert.equal(await fixtureDb.operationLog.count({ where: { tenantId: tenant.id } }), 0)
    } finally {
      if (tenantId) {
        await fixtureDb.operationLog.deleteMany({ where: { tenantId } })
        await fixtureDb.operationLogSetting.deleteMany({ where: { tenantId } })
        await fixtureDb.tenant.deleteMany({ where: { id: tenantId } })
      }
      await prisma8Client.close()
      await fixtureDb.$disconnect()
    }
  },
)
