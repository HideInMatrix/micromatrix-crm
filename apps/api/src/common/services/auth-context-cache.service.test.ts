import assert from 'node:assert/strict'
import test from 'node:test'
import type { RedisService } from '../../redis/redis.service'
import type { AuthUser } from '../auth-user'
import { AuthContextCacheService } from './auth-context-cache.service'

test('认证上下文缓存按用户精确读写并支持批量失效', async () => {
  const values = new Map<string, string>()
  const redis = {
    getJson: async <T>(key: string) => {
      const value = values.get(key)
      return value === undefined ? null : (JSON.parse(value) as T)
    },
    setJson: async (key: string, value: unknown) => {
      values.set(key, JSON.stringify(value))
      return true
    },
    delete: async (...keys: string[]) => {
      keys.forEach((key) => values.delete(key))
      return true
    },
  } as unknown as RedisService
  const cache = new AuthContextCacheService(redis)
  const user: AuthUser = {
    id: 'user-a',
    tenantId: 'tenant-a',
    email: 'a@example.com',
    name: '成员A',
    deptId: 'dept-a',
    leaderId: null,
    roles: [],
    permissions: ['customer:view'],
  }

  await cache.set(user.id, 3, user)
  assert.deepEqual(await cache.get(user.id), { authVersion: 3, user })

  await cache.invalidateMany(['user-a', 'user-a', 'user-b'])
  assert.equal(await cache.get(user.id), null)
})
