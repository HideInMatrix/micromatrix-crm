import assert from 'node:assert/strict'
import test from 'node:test'
import type { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import type { RedisService } from '../../redis/redis.service'
import { OrganizationSyncCoordinationService } from './organization-sync-coordination.service'

test('组织同步运行态与 lease token 绑定，lease 消失后残留 status 不再可见', async () => {
  const values = new Map<string, unknown>()
  let leaseToken: string | null = 'lease-a'
  const coordinator = {
    runExclusive: async (_key: string, task: (context: { token: string | null; source: 'REDIS' }) => Promise<unknown>) => ({
      executed: true as const,
      source: 'REDIS' as const,
      value: await task({ token: leaseToken, source: 'REDIS' }),
    }),
    currentLeaseToken: async () => leaseToken,
  } as unknown as DistributedCoordinatorService
  const redis = {
    setJson: async (key: string, value: unknown) => {
      values.set(key, value)
      return true
    },
    getJson: async <T>(key: string) => (values.get(key) as T | undefined) ?? null,
  } as unknown as RedisService
  const service = new OrganizationSyncCoordinationService(coordinator, redis)

  const result = await service.run('tenant-a', 'admin-a', 'FETCHING', null, async ({ setBatchId }) => {
    await setBatchId('batch-a')
    return 'ok'
  })
  assert.equal(result.executed, true)
  assert.deepEqual(await service.runtimeStatus('tenant-a'), {
    phase: 'FETCHING',
    operatorId: 'admin-a',
    batchId: 'batch-a',
    startedAt: (await service.runtimeStatus('tenant-a'))?.startedAt,
  })

  leaseToken = null
  assert.equal(await service.runtimeStatus('tenant-a'), null)
})
