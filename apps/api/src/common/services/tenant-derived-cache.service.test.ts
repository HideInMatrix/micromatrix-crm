import assert from 'node:assert/strict'
import test from 'node:test'
import type { RedisService } from '../../redis/redis.service'
import { TenantDerivedCacheService } from './tenant-derived-cache.service'

function createRedis(ready = true) {
  const values = new Map<string, string>()
  const redis = {
    ready,
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
      const next = Number(values.get(key) ?? 0) + 1
      values.set(key, String(next))
      return next
    },
  } as unknown as RedisService
  return { redis, values }
}

test('相同租户 namespace 与 key 命中后不重复执行 loader', async () => {
  const { redis } = createRedis()
  const cache = new TenantDerivedCacheService(redis)
  let loads = 0
  const load = () =>
    cache.remember({
      tenantId: 'tenant-a',
      namespace: 'module-config',
      key: 'list',
      ttlSeconds: 60,
      loader: async () => ({ value: ++loads }),
    })

  assert.deepEqual(await load(), { value: 1 })
  assert.deepEqual(await load(), { value: 1 })
  assert.equal(loads, 1)
  assert.deepEqual(cache.snapshot()['module-config'], { hit: 1, miss: 1, bypass: 0, write: 1 })
})

test('版本失效后同一业务 key 重新执行 loader', async () => {
  const { redis } = createRedis()
  const cache = new TenantDerivedCacheService(redis)
  let loads = 0
  const load = () =>
    cache.remember({
      tenantId: 'tenant-a',
      namespace: 'metadata:customer',
      key: 'config',
      ttlSeconds: 60,
      loader: async () => ++loads,
    })

  assert.equal(await load(), 1)
  await cache.invalidate('tenant-a', 'metadata:customer')
  assert.equal(await load(), 2)
})

test('Redis 未 ready 时直接 bypass 且不写缓存', async () => {
  const { redis, values } = createRedis(false)
  const cache = new TenantDerivedCacheService(redis)

  const value = await cache.remember({
    tenantId: 'tenant-a',
    namespace: 'directory',
    key: 'members-options',
    ttlSeconds: 60,
    loader: async () => ['member-a'],
  })

  assert.deepEqual(value, ['member-a'])
  assert.equal(values.size, 0)
  assert.deepEqual(cache.snapshot()['directory'], { hit: 0, miss: 0, bypass: 1, write: 0 })
})

test('fingerprint 对对象字段顺序稳定并区分数组顺序', () => {
  const { redis } = createRedis()
  const cache = new TenantDerivedCacheService(redis)

  assert.equal(
    cache.fingerprint({ b: 2, a: { d: 4, c: 3 } }),
    cache.fingerprint({ a: { c: 3, d: 4 }, b: 2 }),
  )
  assert.notEqual(cache.fingerprint({ ids: ['a', 'b'] }), cache.fingerprint({ ids: ['b', 'a'] }))
})
