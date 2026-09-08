import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { BusinessNotificationsService } from './business-notifications.service'
import type { MessageDeliveryService } from './message-delivery.service'
import { MessageTemplateService } from './message-template.service'
import type { NotificationsService } from './notifications.service'

test('业务通知去重、排除操作者并过滤非租户有效成员', async () => {
  const delivered: string[][] = []
  const prisma = {
    user: {
      findMany: async () => [{ id: 'member-a' }],
      findFirst: async () => ({ name: '操作者', language: 'zh-CN' }),
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
    user: { findMany: async () => [{ id: 'owner-a' }], findFirst: async () => null },
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

test('模板通知按操作者语言渲染，并保证站内与企微投递使用同一最终文本', async () => {
  const inSite: Array<{ title: string; content?: string }> = []
  const external: Array<{ title: string; content?: string }> = []
  const prisma = {
    user: {
      findMany: async () => [{ id: 'owner-a' }],
      findFirst: async () => ({ name: 'David', language: 'en-US' }),
    },
  } as unknown as PrismaService
  const notifications = {
    notifyMany: async (
      _tenantId: string,
      _userIds: string[],
      input: { title: string; content?: string },
    ) => {
      inSite.push(input)
    },
  } as unknown as NotificationsService
  const deliveries = {
    enqueue: async (input: { title: string; content?: string }) => {
      external.push({ title: input.title, content: input.content })
    },
  } as unknown as MessageDeliveryService
  const templates = new MessageTemplateService(prisma)
  const service = new BusinessNotificationsService(
    prisma,
    notifications,
    {} as MessageSettingsService,
    deliveries,
    templates,
  )

  const count = await service.send({
    tenantId: 'tenant-a',
    event: 'CUSTOMER_ADD',
    operatorId: 'operator-a',
    recipientIds: ['owner-a'],
    excludeSelf: true,
    type: 'system',
    templateContext: { name: 'Acme' },
    link: '/customers/customer-a',
  })

  assert.equal(count, 1)
  assert.equal(inSite.length, 1)
  assert.equal(external.length, 1)
  assert.equal(inSite[0]?.title, 'New AccountNotification')
  assert.equal(
    inSite[0]?.content,
    'Attention! David created a new account Acme for you, please be informed!',
  )
  assert.equal(external[0]?.title, inSite[0]?.title)
  assert.equal(external[0]?.content, inSite[0]?.content)
})
