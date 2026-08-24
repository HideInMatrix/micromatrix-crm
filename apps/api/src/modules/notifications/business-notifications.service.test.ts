import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { BusinessNotificationsService } from './business-notifications.service'
import type { NotificationsService } from './notifications.service'

test('业务通知去重、排除操作者并过滤非租户有效成员', async () => {
  const delivered: string[][] = []
  const prisma = {
    user: {
      findMany: async () => [{ id: 'member-a' }],
    },
  } as unknown as PrismaService
  const notifications = {
    notifyMany: async (_tenantId: string, userIds: string[]) => {
      delivered.push(userIds)
    },
  } as unknown as NotificationsService
  const service = new BusinessNotificationsService(
    prisma,
    notifications,
    {} as MessageSettingsService,
  )

  const count = await service.send({
    tenantId: 'tenant-a',
    event: 'CUSTOMER_ADD',
    operatorId: 'operator',
    recipientIds: ['operator', 'member-a', 'member-a', 'cross-tenant'],
    excludeSelf: true,
    type: 'system',
    title: '客户新增',
  })

  assert.equal(count, 1)
  assert.deepEqual(delivered, [['member-a']])
})

test('配置通知使用范围解析结果并隔离发送异常', async () => {
  const prisma = {
    user: { findMany: async () => [{ id: 'owner-a' }] },
  } as unknown as PrismaService
  const notifications = {
    notifyMany: async () => {
      throw new Error('push failed')
    },
  } as unknown as NotificationsService
  const settings = {
    resolveRecipients: async () => ['owner-a'],
  } as unknown as MessageSettingsService
  const service = new BusinessNotificationsService(prisma, notifications, settings)

  const count = await service.sendConfigured({
    tenantId: 'tenant-a',
    event: 'CONTRACT_EXPIRING',
    ownerId: 'owner-a',
    type: 'system',
    title: '合同即将到期',
  })

  assert.equal(count, 0)
})
