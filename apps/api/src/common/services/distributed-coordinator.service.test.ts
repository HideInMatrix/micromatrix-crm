import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { createPrismaClient } from '../../prisma/prisma-client'
import type { PrismaService } from '../../prisma/prisma.service'
import type { RedisService } from '../../redis/redis.service'
import { DistributedCoordinatorService } from './distributed-coordinator.service'

const databaseUrl = process.env['DATABASE_URL']

function fakeRedis() {
  const leases = new Map<string, string>()
  const expiresAt = new Map<string, number>()
  let unavailable = false
  let renewCalls = 0

  const activeToken = (key: string) => {
    const token = leases.get(key)
    if (!token) return null
    const expiry = expiresAt.get(key) ?? 0
    if (expiry <= Date.now()) {
      leases.delete(key)
      expiresAt.delete(key)
      return null
    }
    return token
  }

  const redis = {
    coordinationSnapshot: () => ({}),
    acquireLease: async (key: string, ttlMs: number) => {
      if (unavailable) return { status: 'UNAVAILABLE' as const }
      if (activeToken(key)) return { status: 'BUSY' as const }
      const token = `token-${Date.now()}-${leases.size + 1}`
      leases.set(key, token)
      expiresAt.set(key, Date.now() + ttlMs)
      return { status: 'ACQUIRED' as const, token }
    },
    renewLease: async (key: string, token: string, ttlMs: number) => {
      renewCalls += 1
      if (activeToken(key) !== token) return false
      expiresAt.set(key, Date.now() + ttlMs)
      return true
    },
    releaseLease: async (key: string, token: string) => {
      if (activeToken(key) !== token) return false
      leases.delete(key)
      expiresAt.delete(key)
      return true
    },
    claimOnce: async (key: string, ttlMs: number) => {
      if (unavailable) return { status: 'UNAVAILABLE' as const }
      if (activeToken(key)) return { status: 'BUSY' as const }
      const token = `claim-${Date.now()}-${leases.size + 1}`
      leases.set(key, token)
      expiresAt.set(key, Date.now() + ttlMs)
      return { status: 'ACQUIRED' as const, token }
    },
    get: async (key: string) => activeToken(key),
  } as unknown as RedisService
  return {
    redis,
    leases,
    setUnavailable: (value: boolean) => (unavailable = value),
    renewCalls: () => renewCalls,
  }
}

function fakePrisma(lock = true) {
  let fallbackCalls = 0
  const query = { build: () => ({}) }
  const client = {
    raw: {
      sql: () => ({ returnsRow: () => query }),
    },
    transaction: async (
      callback: (tx: { query: () => AsyncIterable<{ locked: boolean }> }) => Promise<unknown>,
    ) => {
      fallbackCalls += 1
      return callback({
        query: async function* () {
          yield { locked: lock }
        },
      })
    },
  }
  const prisma = { client } as unknown as PrismaService
  return { prisma, fallbackCalls: () => fallbackCalls }
}

test('exclusive lease 同 key 只允许一个实例进入并在完成后安全释放', async () => {
  const { redis } = fakeRedis()
  const { prisma } = fakePrisma()
  const first = new DistributedCoordinatorService(redis, prisma)
  const second = new DistributedCoordinatorService(redis, prisma)
  let release!: () => void
  const blocker = new Promise<void>((resolve) => (release = resolve))
  const firstRun = first.runExclusive('organization-sync:tenant-a', async () => {
    await blocker
    return 'done'
  })
  await new Promise((resolve) => setTimeout(resolve, 0))
  const secondRun = await second.runExclusive('organization-sync:tenant-a', async () => 'duplicate')
  assert.deepEqual(secondRun, { executed: false, source: 'REDIS', reason: 'BUSY' })
  release()
  assert.equal((await firstRun).executed, true)
  assert.equal(
    (await second.runExclusive('organization-sync:tenant-a', async () => 'next')).executed,
    true,
  )
})

test('exclusive lease 长任务自动续租，第二实例在初始 TTL 后仍保持 busy', async () => {
  const { redis, renewCalls } = fakeRedis()
  const { prisma } = fakePrisma()
  const first = new DistributedCoordinatorService(redis, prisma)
  const second = new DistributedCoordinatorService(redis, prisma)
  let release!: () => void
  const blocker = new Promise<void>((resolve) => (release = resolve))
  const firstRun = first.runExclusive(
    'organization-sync:tenant-b',
    async () => {
      await blocker
      return true
    },
    { ttlMs: 1_000, renewEveryMs: 20 },
  )
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  assert.ok(renewCalls() >= 2)
  const secondRun = await second.runExclusive('organization-sync:tenant-b', async () => false)
  assert.equal(secondRun.executed, false)
  release()
  await firstRun
  assert.equal(first.snapshot().renewWarnings, 0)
})

test('Cron 同一时间槽只执行一次，不同分钟槽可再次执行', async () => {
  const { redis } = fakeRedis()
  const { prisma } = fakePrisma()
  const a = new DistributedCoordinatorService(redis, prisma)
  const b = new DistributedCoordinatorService(redis, prisma)
  let executions = 0
  const now = new Date('2026-09-03T08:15:10.000Z')
  assert.equal(
    (await a.runScheduledOnce('message-delivery', 'MINUTE', async () => ++executions, now))
      .executed,
    true,
  )
  assert.equal(
    (await b.runScheduledOnce('message-delivery', 'MINUTE', async () => ++executions, now))
      .executed,
    false,
  )
  assert.equal(
    (
      await b.runScheduledOnce(
        'message-delivery',
        'MINUTE',
        async () => ++executions,
        new Date('2026-09-03T08:16:00.000Z'),
      )
    ).executed,
    true,
  )
  assert.equal(executions, 2)
})

test('Redis unavailable 时 Cron 使用 PostgreSQL advisory fallback', async () => {
  const { redis, setUnavailable } = fakeRedis()
  setUnavailable(true)
  const acquired = fakePrisma(true)
  const skipped = fakePrisma(false)
  let executions = 0
  const now = new Date('2026-09-03T08:00:00.000Z')
  const run = await new DistributedCoordinatorService(redis, acquired.prisma).runScheduledOnce(
    'message-expiry',
    'DAILY',
    async () => ++executions,
    now,
  )
  const skip = await new DistributedCoordinatorService(redis, skipped.prisma).runScheduledOnce(
    'message-expiry',
    'DAILY',
    async () => ++executions,
    now,
  )
  assert.equal(run.executed, true)
  assert.deepEqual(skip, { executed: false, source: 'POSTGRES', reason: 'BUSY' })
  assert.equal(executions, 1)
  assert.equal(acquired.fallbackCalls(), 1)
  assert.equal(skipped.fallbackCalls(), 1)
})

test(
  'Redis unavailable 时 Prisma PostgreSQL fallback 在独立连接间保持 advisory xact lock 互斥',
  { skip: !databaseUrl },
  async () => {
    assert.ok(databaseUrl)
    const firstRedis = fakeRedis()
    const secondRedis = fakeRedis()
    firstRedis.setUnavailable(true)
    secondRedis.setUnavailable(true)
    const firstClient = await createPrismaClient(databaseUrl)
    const secondClient = await createPrismaClient(databaseUrl)
    await firstClient.connect()
    await secondClient.connect()
    const first = new DistributedCoordinatorService(firstRedis.redis, {
      client: firstClient,
    } as PrismaService)
    const second = new DistributedCoordinatorService(secondRedis.redis, {
      client: secondClient,
    } as PrismaService)
    const job = `prisma-coordinator-${randomUUID()}`
    const now = new Date('2026-09-15T08:00:00.000Z')
    let release!: () => void
    let entered!: () => void
    const blocker = new Promise<void>((resolve) => (release = resolve))
    const enteredLock = new Promise<void>((resolve) => (entered = resolve))

    try {
      const firstRun = first.runScheduledOnce(
        job,
        'MINUTE',
        async () => {
          entered()
          await blocker
          return 'first'
        },
        now,
      )
      await enteredLock

      assert.deepEqual(await second.runScheduledOnce(job, 'MINUTE', async () => 'duplicate', now), {
        executed: false,
        source: 'POSTGRES',
        reason: 'BUSY',
      })

      release()
      assert.deepEqual(await firstRun, { executed: true, source: 'POSTGRES', value: 'first' })
      assert.deepEqual(await second.runScheduledOnce(job, 'MINUTE', async () => 'next', now), {
        executed: true,
        source: 'POSTGRES',
        value: 'next',
      })
    } finally {
      release?.()
      await firstClient.close()
      await secondClient.close()
    }
  },
)
