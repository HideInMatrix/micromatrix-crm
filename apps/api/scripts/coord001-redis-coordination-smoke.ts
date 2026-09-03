import assert from 'node:assert/strict'
import { ConfigService } from '@nestjs/config'
import { RedisService } from '../src/redis/redis.service'

async function waitUntil(check: () => boolean, label: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待超时: ${label}`)
}

async function main() {
  const host = process.env['COORD001_REDIS_HOST'] ?? '127.0.0.1'
  const port = process.env['COORD001_REDIS_PORT'] ?? '16379'
  const password = process.env['COORD001_REDIS_PASSWORD'] ?? 'coord001-test'
  const config = new ConfigService({ REDIS_HOST: host, REDIS_PORT: port, REDIS_PASSWORD: password })
  const first = new RedisService(config)
  const second = new RedisService(config)
  try {
    await waitUntil(() => first.ready && second.ready, 'Redis command clients ready')
    const key = 'coord001:lease:smoke'
    const acquired = await first.acquireLease(key, 1_500)
    assert.equal(acquired.status, 'ACQUIRED')
    if (acquired.status !== 'ACQUIRED') throw new Error('lease acquire failed')
    assert.equal((await second.acquireLease(key, 1_500)).status, 'BUSY')

    assert.equal(await second.releaseLease(key, 'wrong-token'), false)
    assert.equal(await first.get(key), acquired.token)
    assert.equal(await first.renewLease(key, acquired.token, 3_000), true)
    assert.equal(await first.get(key), acquired.token)
    assert.equal(await first.releaseLease(key, acquired.token), true)
    assert.equal(await first.get(key), null)

    const reacquired = await second.acquireLease(key, 1_500)
    assert.equal(reacquired.status, 'ACQUIRED')
    if (reacquired.status === 'ACQUIRED') {
      assert.equal(await second.releaseLease(key, reacquired.token), true)
    }

    const slotKey = 'coord:cron:coord001-smoke:2026-09-03T12:30'
    assert.equal((await first.claimOnce(slotKey, 60_000)).status, 'ACQUIRED')
    assert.equal((await second.claimOnce(slotKey, 60_000)).status, 'BUSY')

    console.log(
      JSON.stringify(
        {
          leaseMutualExclusion: true,
          wrongTokenSafeRelease: true,
          renew: true,
          correctRelease: true,
          reacquire: true,
          slotClaim: true,
          first: first.coordinationSnapshot(),
          second: second.coordinationSnapshot(),
        },
        null,
        2,
      ),
    )
  } finally {
    await Promise.all([first.onApplicationShutdown(), second.onApplicationShutdown()])
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
