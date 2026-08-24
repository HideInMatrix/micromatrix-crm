import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { NotificationsService } from './notifications.service'

test('事件关闭时不落库，未绑定事件的兼容通知仍发送', async () => {
  let created = 0
  const prisma = {
    notification: {
      create: async () => {
        created += 1
        return { id: `notification-${created}` }
      },
    },
  } as unknown as PrismaService
  const messageSettings = {
    isSystemEnabled: async () => false,
  } as unknown as MessageSettingsService
  const service = new NotificationsService(prisma, messageSettings)

  await service.notify('tenant-a', 'user-a', {
    type: 'follow_plan',
    title: '到期提醒',
    event: 'CUSTOMER_FOLLOW_UP_PLAN_DUE',
  })
  assert.equal(created, 0)

  await service.notify('tenant-a', 'user-a', { type: 'system', title: '兼容通知' })
  assert.equal(created, 1)
})
