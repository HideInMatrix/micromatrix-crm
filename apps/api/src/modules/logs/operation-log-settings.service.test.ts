import assert from 'node:assert/strict'
import test from 'node:test'
import { OperationLogCleanupSource } from '../../generated/prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { OperationLogSettingsService } from './operation-log-settings.service'

test('未配置租户继承 180 天默认值且不伪装为已配置', async () => {
  const prisma = {
    operationLogSetting: { findUnique: async () => null },
  } as unknown as PrismaService
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
  const prisma = {
    operationLogSetting: {
      findUnique: async () => ({
        retentionDays: null,
        lastCleanupAt: new Date('2026-09-04T04:15:00.000Z'),
        lastCleanupDeleted: 12,
        lastCleanupSource: OperationLogCleanupSource.AUTO,
      }),
    },
  } as unknown as PrismaService
  const service = new OperationLogSettingsService(prisma)
  const setting = await service.get('tenant-a')

  assert.equal(setting.configured, false)
  assert.equal(setting.retentionDays, 180)
  assert.equal(setting.lastCleanupDeleted, 12)
  assert.equal(setting.lastCleanupSource, 'AUTO')
})

test('显式天数与永久保留分别写入数字和内部 0 sentinel', async () => {
  const stored: Array<number | null> = []
  const prisma = {
    operationLogSetting: {
      upsert: async (args: {
        create: { retentionDays: number | null }
        update: { retentionDays: number | null }
      }) => {
        const retentionDays = args.update.retentionDays
        stored.push(retentionDays)
        return {
          retentionDays,
          lastCleanupAt: null,
          lastCleanupDeleted: 0,
          lastCleanupSource: null,
        }
      },
    },
  } as unknown as PrismaService
  const service = new OperationLogSettingsService(prisma)

  const days = await service.update('tenant-a', 365)
  const permanent = await service.update('tenant-a', null)

  assert.deepEqual(stored, [365, 0])
  assert.equal(days.configured, true)
  assert.equal(days.retentionDays, 365)
  assert.equal(days.permanent, false)
  assert.equal(permanent.configured, true)
  assert.equal(permanent.retentionDays, null)
  assert.equal(permanent.permanent, true)
})

test('策略服务拒绝越界保留天数', async () => {
  const service = new OperationLogSettingsService({} as PrismaService)
  await assert.rejects(() => service.update('tenant-a', 29), /30～3650/)
  await assert.rejects(() => service.update('tenant-a', 3651), /30～3650/)
})

test('自动清理状态首次落库保持 retentionDays=null 继承默认值', async () => {
  let createRetentionDays: number | null | undefined
  const prisma = {
    operationLogSetting: {
      upsert: async (args: {
        create: {
          retentionDays: number | null
          lastCleanupAt: Date
          lastCleanupDeleted: number
          lastCleanupSource: OperationLogCleanupSource
        }
      }) => {
        createRetentionDays = args.create.retentionDays
        return args.create
      },
    },
  } as unknown as PrismaService
  const service = new OperationLogSettingsService(prisma)
  const at = new Date('2026-09-04T04:15:00.000Z')

  const setting = await service.recordCleanup('tenant-a', 5, OperationLogCleanupSource.AUTO, at)

  assert.equal(createRetentionDays, null)
  assert.equal(setting.configured, false)
  assert.equal(setting.retentionDays, 180)
  assert.equal(setting.lastCleanupDeleted, 5)
  assert.equal(setting.lastCleanupAt, at.toISOString())
})
