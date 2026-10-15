import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma.service'
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
    let otherTenantId: string | null = null
    try {
      const tenant = await createPrismaTestTenant(prismaClient, 'p8-log')
      tenantId = tenant.id
      const otherTenant = await createPrismaTestTenant(prismaClient, 'p8-log-foreign')
      otherTenantId = otherTenant.id
      await prismaClient.orm.public.LoginLogs.createAll([
        {
          tenantId: tenant.id,
          email: 'old-1@example.invalid',
          success: true,
          authType: 'PASSWORD',
          createdAt: instantFromDate(new Date('2026-07-01T00:00:00.000Z')),
        },
        {
          tenantId: tenant.id,
          email: 'old-2@example.invalid',
          success: false,
          authType: 'PASSWORD',
          createdAt: instantFromDate(new Date('2026-07-02T00:00:00.000Z')),
        },
        {
          tenantId: tenant.id,
          email: 'recent@example.invalid',
          success: true,
          authType: 'WECOM',
          createdAt: instantFromDate(new Date('2026-09-10T00:00:00.000Z')),
        },
        {
          tenantId: otherTenant.id,
          email: 'other-old@example.invalid',
          success: true,
          authType: 'PASSWORD',
          createdAt: instantFromDate(new Date('2026-07-01T00:00:00.000Z')),
        },
      ])
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
        {
          tenantId: tenant.id,
          module: 'externalEvent',
          action: 'EVENT_OLD',
          createdAt: instantFromDate(new Date('2026-07-01T00:00:00.000Z')),
        },
        {
          tenantId: tenant.id,
          module: 'externalEvent',
          action: 'EVENT_RECENT',
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
      const loginLong = await settings.update(tenant.id, 365, 'login')
      const eventPermanent = await settings.update(tenant.id, null, 'event')
      assert.equal(loginLong.retentionDays, 365)
      assert.equal(eventPermanent.permanent, true)
      assert.equal((await settings.get(tenant.id, 'operation')).retentionDays, 30)

      const result = await cleanup.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO)
      assert.equal(result.skipped, false)
      assert.equal(result.deleted, 2)
      assert.equal(result.cutoff, '2026-08-17T12:00:00.000Z')
      assert.equal(result.setting.retentionDays, 30)
      assert.equal(result.setting.lastCleanupDeleted, 2)
      assert.equal(result.setting.lastCleanupSource, 'AUTO')
      assert.equal(result.setting.lastCleanupAt, now.toISOString())

      const remaining = await prismaClient.orm.public.OperationLogs.where({
        tenantId: tenant.id,
      })
        .orderBy((row) => row.createdAt.asc())
        .select('action')
        .all()
      assert.deepEqual(
        remaining.map((row) => row.action),
        ['EVENT_OLD', 'RECENT', 'EVENT_RECENT'],
      )
      assert.equal(
        (await prismaClient.orm.public.LoginLogs.where({ tenantId: tenant.id }).all()).length,
        3,
      )
      assert.equal(
        (await cleanup.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO, 'event'))
          .skipped,
        true,
      )
      assert.equal((await settings.get(tenant.id, 'event')).permanent, true)
      assert.equal(
        (await cleanup.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO, 'login'))
          .deleted,
        0,
      )
      assert.equal(
        (await prismaClient.orm.public.LoginLogs.where({ tenantId: tenant.id }).all()).length,
        3,
      )

      assert.equal((await settings.update(tenant.id, 30, 'login')).retentionDays, 30)
      assert.equal(
        (await cleanup.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO, 'login'))
          .deleted,
        2,
      )
      assert.deepEqual(
        (
          await prismaClient.orm.public.LoginLogs.where({ tenantId: tenant.id })
            .select('email')
            .all()
        ).map((row) => row.email),
        ['recent@example.invalid'],
      )
      assert.equal((await settings.get(tenant.id, 'operation')).retentionDays, 30)
      assert.equal((await settings.get(tenant.id, 'event')).permanent, true)

      assert.equal((await settings.update(tenant.id, 30, 'event')).retentionDays, 30)
      assert.equal(
        (await cleanup.cleanupTenant(tenant.id, now, OperationLogCleanupSources.AUTO, 'event'))
          .deleted,
        1,
      )
      assert.deepEqual(
        (
          await prismaClient.orm.public.OperationLogs.where({
            tenantId: tenant.id,
            module: 'externalEvent',
          })
            .select('action')
            .all()
        ).map((row) => row.action),
        ['EVENT_RECENT'],
      )
      assert.equal(
        (await prismaClient.orm.public.LoginLogs.where({ tenantId: otherTenant.id }).all()).length,
        1,
      )

      assert.deepEqual(await cleanup.clearTenant(tenant.id), { deleted: 1 })
      assert.equal(
        (
          await prismaClient.orm.public.OperationLogs.where({
            tenantId: tenant.id,
            module: 'externalEvent',
          }).all()
        ).length,
        1,
      )
      // 全量清空操作日志并不影响登录日志
      assert.equal(
        (await prismaClient.orm.public.LoginLogs.where({ tenantId: tenant.id }).all()).length,
        1,
      )
      assert.equal(
        (await prismaClient.orm.public.OperationLogs.where({ tenantId: tenant.id }).all()).length,
        1,
      )
      assert.deepEqual(await cleanup.clearTenant(tenant.id, 'event'), { deleted: 1 })
      assert.equal(
        (await prismaClient.orm.public.OperationLogs.where({ tenantId: tenant.id }).all()).length,
        0,
      )
    } finally {
      if (tenantId) {
        await prismaClient.orm.public.OperationLogs.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.LoginLogs.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.OperationLogSettings.where({ tenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: tenantId }).deleteAll()
      }
      if (otherTenantId) {
        await prismaClient.orm.public.LoginLogs.where({ tenantId: otherTenantId }).deleteAll()
        await prismaClient.orm.public.Tenants.where({ id: otherTenantId }).deleteAll()
      }
      await testDb.close()
    }
  },
)
