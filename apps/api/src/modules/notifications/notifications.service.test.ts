import assert from 'node:assert/strict'
import test from 'node:test'
import type { MessageEvent } from '@nestjs/common'
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
    publish: async () => 0,
    subscribe: async () => async () => undefined,
  } as unknown as RedisService
  return { redis, values }
}

function createRealtimeRedisBus() {
  const values = new Map<string, string>()
  const handlers = new Map<string, Set<(message: string) => void | Promise<void>>>()
  const createRedis = () =>
    ({
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
      publish: async (channel: string, payload: string) => {
        const listeners = [...(handlers.get(channel) ?? [])]
        await Promise.all(listeners.map((handler) => handler(payload)))
        return listeners.length
      },
      subscribe: async (channel: string, handler: (message: string) => void | Promise<void>) => {
        const listeners = handlers.get(channel) ?? new Set()
        listeners.add(handler)
        handlers.set(channel, listeners)
        return async () => {
          listeners.delete(handler)
          if (listeners.size === 0) handlers.delete(channel)
        }
      },
    }) as unknown as RedisService

  return {
    createRedis,
    emit: async (channel: string, payload: string) => {
      const listeners = [...(handlers.get(channel) ?? [])]
      await Promise.all(listeners.map((handler) => handler(payload)))
    },
  }
}

test('事件关闭时不落库，未绑定事件的兼容通知仍发送', async () => {
  let created = 0
  const prisma = {
    notification: {
      create: async () => {
        created += 1
        return {
          id: `notification-${created}`,
          tenantId: 'tenant-a',
          userId: 'user-a',
          type: 'system',
          title: '兼容通知',
          content: null,
          link: null,
          readAt: null,
          createdAt: new Date('2026-09-03T00:00:00.000Z'),
        }
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

test('Redis Pub/Sub 将新通知跨 API 实例送达且来源实例不重复', async () => {
  const bus = createRealtimeRedisBus()
  let sequence = 0
  const createPrisma = () =>
    ({
      notification: {
        create: async ({ data }: { data: { tenantId: string; userId: string; title: string } }) => ({
          id: `notification-${++sequence}`,
          tenantId: data.tenantId,
          userId: data.userId,
          type: 'system',
          title: data.title,
          content: null,
          link: null,
          readAt: null,
          createdAt: new Date('2026-09-03T01:00:00.000Z'),
        }),
        updateMany: async () => ({ count: 1 }),
      },
    }) as unknown as PrismaService
  const messageSettings = { isSystemEnabled: async () => true } as unknown as MessageSettingsService
  const serviceA = new NotificationsService(createPrisma(), messageSettings, bus.createRedis())
  const serviceB = new NotificationsService(createPrisma(), messageSettings, bus.createRedis())
  await serviceA.onModuleInit()
  await serviceB.onModuleInit()

  const eventsA: MessageEvent[] = []
  const eventsB: MessageEvent[] = []
  const subscriptionA = serviceA.subscribe('user-a').subscribe((event) => eventsA.push(event))
  const subscriptionB = serviceB.subscribe('user-a').subscribe((event) => eventsB.push(event))

  await serviceA.notify('tenant-a', 'user-a', { type: 'system', title: '跨实例通知' })

  assert.equal(eventsA.length, 1)
  assert.equal(eventsB.length, 1)
  assert.equal((eventsA[0]!.data as { title: string }).title, '跨实例通知')
  assert.deepEqual(eventsB[0]!.data, eventsA[0]!.data)
  assert.equal(serviceA.realtimeSnapshot().sourceIgnored, 1)
  assert.equal(serviceB.realtimeSnapshot().received, 1)

  subscriptionA.unsubscribe()
  subscriptionB.unsubscribe()
  await serviceA.onModuleDestroy()
  await serviceB.onModuleDestroy()
})

test('通知已读状态通过 Pub/Sub 跨实例发送 refresh event', async () => {
  const bus = createRealtimeRedisBus()
  const prisma = {
    notification: { updateMany: async () => ({ count: 1 }) },
  } as unknown as PrismaService
  const messageSettings = {} as MessageSettingsService
  const serviceA = new NotificationsService(prisma, messageSettings, bus.createRedis())
  const serviceB = new NotificationsService(prisma, messageSettings, bus.createRedis())
  await serviceA.onModuleInit()
  await serviceB.onModuleInit()

  const typesA: Array<string | undefined> = []
  const typesB: Array<string | undefined> = []
  const subscriptionA = serviceA.subscribe('user-a').subscribe((event) => typesA.push(event.type))
  const subscriptionB = serviceB.subscribe('user-a').subscribe((event) => typesB.push(event.type))

  await serviceA.markRead('tenant-a', 'user-a', 'notification-a')

  assert.deepEqual(typesA, ['refresh'])
  assert.deepEqual(typesB, ['refresh'])
  await serviceA.markAllRead('tenant-a', 'user-a')
  assert.deepEqual(typesA, ['refresh', 'refresh'])
  assert.deepEqual(typesB, ['refresh', 'refresh'])
  subscriptionA.unsubscribe()
  subscriptionB.unsubscribe()
  await serviceA.onModuleDestroy()
  await serviceB.onModuleDestroy()
})

test('Redis 发布不可用时仍保持本实例 SSE，非法事件不影响后续合法消费', async () => {
  const handlers = new Set<(message: string) => void | Promise<void>>()
  const redis = {
    get: async () => null,
    increment: async () => null,
    publish: async () => null,
    subscribe: async (_channel: string, handler: (message: string) => void | Promise<void>) => {
      handlers.add(handler)
      return async () => handlers.delete(handler)
    },
  } as unknown as RedisService
  const prisma = {
    notification: {
      create: async () => ({
        id: 'notification-local',
        tenantId: 'tenant-a',
        userId: 'user-a',
        type: 'system',
        title: '本地降级',
        content: null,
        link: null,
        readAt: null,
        createdAt: new Date('2026-09-03T02:00:00.000Z'),
      }),
    },
  } as unknown as PrismaService
  const service = new NotificationsService(prisma, {} as MessageSettingsService, redis)
  await service.onModuleInit()
  const events: MessageEvent[] = []
  const subscription = service.subscribe('user-a').subscribe((event) => events.push(event))

  await service.notify('tenant-a', 'user-a', { type: 'system', title: '本地降级' })
  assert.equal(events.length, 1)
  assert.equal(service.realtimeSnapshot().publishFailures, 1)

  await Promise.all([...handlers].map((handler) => handler('{invalid-json')))
  await Promise.all(
    [...handlers].map((handler) =>
      handler(
        JSON.stringify({
          version: 2,
          eventId: 'unknown-version',
          sourceInstanceId: 'remote',
          type: 'STATE_CHANGED',
          tenantId: 'tenant-a',
          userId: 'user-a',
          occurredAt: new Date().toISOString(),
        }),
      ),
    ),
  )
  assert.equal(service.realtimeSnapshot().invalidDropped, 2)
  assert.equal(events.length, 1)

  const remoteCreated = JSON.stringify({
    version: 1,
    eventId: 'remote-created',
    sourceInstanceId: 'remote-instance',
    type: 'CREATED',
    tenantId: 'tenant-a',
    userId: 'user-a',
    occurredAt: new Date().toISOString(),
    notification: {
      id: 'notification-remote',
      type: 'system',
      title: '远端通知',
      content: null,
      link: null,
      readAt: null,
      createdAt: new Date().toISOString(),
    },
  })
  await Promise.all([...handlers].map((handler) => handler(remoteCreated)))
  await Promise.all([...handlers].map((handler) => handler(remoteCreated)))
  assert.equal(events.length, 2)
  assert.equal((events[1]!.data as { id: string }).id, 'notification-remote')
  assert.equal(service.realtimeSnapshot().duplicateDropped, 1)

  subscription.unsubscribe()
  await service.onModuleDestroy()
})
