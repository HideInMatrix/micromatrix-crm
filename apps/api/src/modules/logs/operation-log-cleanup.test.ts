import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import { instantFromDate } from '../../prisma/temporal'
import { createPrismaTestTenant, openPrismaTestDatabase } from '../../testing/prisma-test-db'
import { OperationLogCleanupService } from './operation-log-cleanup.service'
import {
  OperationLogCleanupSources,
  OperationLogSettingsService,
} from './operation-log-settings.service'

const databaseUrl = process.env['DATABASE_URL']

test(
  'OperationLog cleanup/settings 由 Prisma 保持原子 upsert、Temporal 状态与批量删除语义',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const testDb = await openPrismaTestDatabase(databaseUrl)
    const prismaClient = testDb.client
    const now = new Date('2026-09-16T12:00:00.000Z')

    let tenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-log')
      tenantId = tenant.id
      await prismaClient.orm.public.OperationLogs.createAll([
        {
          tenantId: tenant.id,
          module: 'PRISMA8_TEST',
          action: 'OLD_A',
          createdAt: instantFromDate(new Date('2026-07-01T00:00:00.000Z')),
        },
        {
          tenantId: tenant.id,
          module: 'PRISMA8_TEST',
          action: 'OLD_B',
          createdAt: instantFromDate(new Date('2026-07-02T00:00:00.000Z')),
        },
        {
          tenantId: tenant.id,
          module: 'PRISMA8_TEST',
          action: 'RECENT',
          createdAt: instantFromDate(new Date('2026-09-10T00:00:00.000Z')),
        },
      ])

      const prisma = { client: prismaClient } as PrismaService
      const settings = new OperationLogSettingsService(prisma)
      const cleanup = new OperationLogCleanupService(prisma, settings)

      const configured = await settings.update(tenant.id, 30)
      assert.equal(configured.configured, true)
      assert.equal(configured.retentionDays, 30)
      assert.equal(configured.permanent, false)

      const result = await cleanup.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO)
      assert.equal(result.skipped, false)
      assert.equal(result.deleted, 2)
      assert.equal(result.cutoff, '2026-08-17T12:00:00.000Z')
      assert.equal(result.setting.retentionDays, 30)
      assert.equal(result.setting.lastCleanupDeleted, 2)
      assert.equal(result.setting.lastCleanupSource, 'AUTO')
      assert.equal(result.setting.lastCleanupAt, now.toISOString())

      const remaining = await prismaClient.orm.public.OperationLogs.where({ tenantId: tenant.id })
        .orderBy((row) => row.createdAt.asc())
        .select('action')
        .all()
      assert.deepEqual(remaining, [{ action: 'RECENT' }])

      assert.deepEqual(await cleanup.clearTenant(tenant.id), { deleted: 1 })
      assert.equal(
        (
          await prismaClient.orm.public.OperationLogs.where({ tenantId: tenant.id })
            .select('id')
            .all()
        ).length,
        0,
      )
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.OperationLogs.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.OperationLogSettings.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
