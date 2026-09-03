import assert from 'node:assert/strict'
import { ConfigService } from '@nestjs/config'
import Redis from 'ioredis'
import { RedisService } from '../src/redis/redis.service'

const host = process.env['EVENT001_REDIS_HOST'] ?? '127.0.0.1'
const port = Number(process.env['EVENT001_REDIS_PORT'] ?? '16379')
const password = process.env['EVENT001_REDIS_PASSWORD'] ?? 'event001-test'

async function waitUntil(check: () => boolean, label: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`等待超时：${label}`)
}

async function main() {
  const config = new ConfigService({
    REDIS_HOST: host,
    REDIS_PORT: String(port),
    REDIS_PASSWORD: password,
    REDIS_DB: '0',
  })
  const publisher = new RedisService(config)
  const subscriber = new RedisService(config)
  const admin = new Redis({ host, port, password, maxRetriesPerRequest: 1 })
  const messages: string[] = []

  try {
    const unsubscribe = await subscriber.subscribe('event001-smoke', (message) => {
      messages.push(message)
    })
    await waitUntil(() => publisher.ready && subscriber.pubSubReady, 'Redis command/subscriber ready')

    assert.equal(await publisher.setJson('event001:command', { ok: true }, 60), true)
    assert.deepEqual(await publisher.getJson('event001:command'), { ok: true })
    assert.ok((await publisher.publish('event001-smoke', 'before-reconnect'))! >= 1)
    await waitUntil(() => messages.includes('before-reconnect'), '首次 Pub/Sub 消息')

    const clients = String(await admin.call('CLIENT', 'LIST'))
    const ids = clients
      .split('\n')
      .filter((line) => /(?:^|\s)flags=\S*P\S*(?:\s|$)/.test(line) || /(?:^|\s)cmd=subscribe(?:\s|$)/.test(line))
      .map((line) => /(?:^|\s)id=(\d+)/.exec(line)?.[1])
      .filter((id): id is string => Boolean(id))
    assert.ok(ids.length >= 1, '必须存在独立 Pub/Sub subscriber 连接')
    await Promise.all(ids.map((id) => admin.call('CLIENT', 'KILL', 'ID', id)))

    await waitUntil(() => subscriber.pubSubReady, 'subscriber 自动重连并重新订阅')
    assert.ok((await publisher.publish('event001-smoke', 'after-reconnect'))! >= 1)
    await waitUntil(() => messages.includes('after-reconnect'), '重连后的 Pub/Sub 消息')

    assert.deepEqual(await publisher.getJson('event001:command'), { ok: true })
    assert.equal(messages.filter((message) => message === 'before-reconnect').length, 1)
    assert.equal(messages.filter((message) => message === 'after-reconnect').length, 1)
    const publisherSnapshot = publisher.pubSubSnapshot()
    const subscriberSnapshot = subscriber.pubSubSnapshot()
    await unsubscribe()

    console.log(
      JSON.stringify(
        {
          commandRoundTrip: true,
          pubSubBeforeReconnect: true,
          pubSubAfterReconnect: true,
          publisher: publisherSnapshot,
          subscriber: subscriberSnapshot,
        },
        null,
        2,
      ),
    )
  } finally {
    admin.disconnect(false)
    await subscriber.onApplicationShutdown()
    await publisher.onApplicationShutdown()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
