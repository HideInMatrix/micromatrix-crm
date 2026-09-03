import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrismaService } from '../../prisma/prisma.service'
import type { RedisService } from '../../redis/redis.service'
import type { MessageSettingsService } from '../message-settings/message-settings.service'
import { NotificationsService } from './notifications.service'

function createRedisCache() {
  const values = new Map<string, string>()
  const redis = {
    get: async (key: string) => values.get(key) ?? null,
    getJson: async <T>(key: string) => {
      const value = values.get(key)
      return value === undefined ? null : (JSON.parse(value) as T)
    },
    setJson: async (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value))
      return true
    },
    increment: async (key: string) => {
      const next = Number(values.get(key) ?? '0') + 1
      values.set(key, String(next))
      return next
    },
  } as unknown as RedisService
  return { redis, values }
}

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

test('通知列表与未读数命中 Redis，写操作通过版本号使旧缓存失效', async () => {
  let listQueries = 0
  let countQueries = 0
  let readUpdates = 0
  const notification = {
    id: 'notification-a',
    tenantId: 'tenant-a',
    userId: 'user-a',
    type: 'system',
    title: '测试通知',
    content: null,
    link: null,
    readAt: null,
    createdAt: new Date('2026-09-03T00:00:00.000Z'),
  }
  const prisma = {
    notification: {
      findMany: async () => {
        listQueries += 1
        return [notification]
      },
      count: async ({ where }: { where: { readAt?: null } }) => {
        countQueries += 1
        return where.readAt === null ? 1 : 1
      },
      updateMany: async () => {
        readUpdates += 1
        return { count: 1 }
      },
    },
    $transaction: async (operations: Array<Promise<unknown>>) => Promise.all(operations),
  } as unknown as PrismaService
  const messageSettings = {} as MessageSettingsService
  const { redis } = createRedisCache()
  const service = new NotificationsService(prisma, messageSettings, redis)

  const firstList = await service.list('tenant-a', 'user-a', 1, 5, true)
  const secondList = await service.list('tenant-a', 'user-a', 1, 5, true)
  assert.deepEqual(secondList, firstList)
  assert.equal(listQueries, 1)
  assert.equal(countQueries, 1)

  assert.deepEqual(await service.unreadCount('tenant-a', 'user-a'), { count: 1 })
  assert.deepEqual(await service.unreadCount('tenant-a', 'user-a'), { count: 1 })
  assert.equal(countQueries, 2)

  await service.markRead('tenant-a', 'user-a', 'notification-a')
  assert.equal(readUpdates, 1)
  await service.unreadCount('tenant-a', 'user-a')
  assert.equal(countQueries, 3)
})
