import assert from 'node:assert/strict'
import { WeComClient } from '../src/modules/enterprise-integrations/wecom.client'
import { DeliveryPerformance } from '../src/modules/notifications/delivery-performance'
import { DeliveryExecutor } from '../src/modules/notifications/delivery-executor'

async function main() {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  let tokenCalls = 0
  let posts = 0
  let tokenError = false
  let tokenExpiry: number | undefined = 7200
  let sendCode = 0
  const seen: Array<{ token: string | null; body: Record<string, unknown> }> = []
  const config = {
    get: (key: string) =>
      key === 'WECOM_API_BASE_URL'
        ? 'https://example.invalid'
        : key === 'WEB_PUBLIC_URL'
          ? 'https://crm.example.invalid'
          : undefined,
  }
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'https://example.invalid')
    if (url.pathname === '/cgi-bin/gettoken') {
      const serial = ++tokenCalls
      await Promise.resolve()
      return Response.json(
        tokenError
          ? { errcode: -1 }
          : { errcode: 0, access_token: 'mock-token-' + serial, expires_in: tokenExpiry },
      )
    }
    assert.equal(url.pathname, '/cgi-bin/message/send')
    assert.equal(init?.method, 'POST')
    posts++
    seen.push({ token: url.searchParams.get('access_token'), body: JSON.parse(String(init?.body)) })
    return Response.json({ errcode: sendCode, msgid: 'mock-message' })
  }
  try {
    const client = new WeComClient(config as never)
    const base = {
      corpId: 'corp-a',
      agentId: '123',
      appSecret: 'fixture-a',
      toUser: 'fixture-user',
      title: 'test',
      content: 'sample',
    }
    const input = (i: number) => ({
      ...base,
      content: 'sample-' + i,
      link: '/leads?id=fixture-' + i,
      tenantSlug: 'fixture-tenant',
    })
    const perf = new DeliveryPerformance()
    const perfShared = new DeliveryPerformance()
    const group = await Promise.all([
      client.sendTextMessage(input(0), perf),
      client.sendTextMessage(input(1), perfShared),
      ...Array.from({ length: 3 }, (_, i) => client.sendTextMessage(input(i + 2))),
    ])
    assert.ok(group.every((r) => r.success))
    assert.equal(tokenCalls, 1)
    assert.equal(posts, 5)
    assert.equal(perf.tokenSource, 'fetch')
    assert.equal(perfShared.tokenSource, 'shared')
    const cached = new DeliveryPerformance()
    await client.sendTextMessage(input(5), cached)
    assert.equal(cached.tokenSource, 'cache')
    assert.equal(tokenCalls, 1)
    assert.equal(posts, 6)
    assert.equal(new Set(seen.map((x) => x.token)).size, 1)
    assert.equal(new Set(seen.map((x) => JSON.stringify(x.body))).size, 6)
    assert.ok(seen.every((x) => x.body.msgtype === 'textcard' && x.body.touser === base.toUser))
    let diagnostic = ''
    cached.finish((line) => {
      diagnostic = line
    })
    const parsed = JSON.parse(diagnostic)
    assert.equal(parsed.kind, 'message_delivery_perf')
    assert.ok(parsed.stagesMs.token >= 0 && parsed.stagesMs.provider >= 0)
    assert.ok(
      !diagnostic.includes(base.appSecret) &&
        !diagnostic.includes(base.toUser) &&
        !diagnostic.includes('mock-token'),
    )

    // Distinct app, corporation and secret must not share tokens.
    await client.sendTextMessage({ ...base, agentId: '124' })
    await client.sendTextMessage({ ...base, corpId: 'corp-b' })
    await client.sendTextMessage({ ...base, appSecret: 'fixture-rotated' })
    assert.equal(tokenCalls, 4)
    assert.equal(new Set(seen.slice(-3).map((x) => x.token)).size, 3)
    now += 7_200_000
    await client.sendTextMessage(base)
    assert.equal(tokenCalls, 5)
    for (const code of [40014, 42001]) {
      sendCode = code
      const before = posts
      const result = await client.sendTextMessage(base)
      assert.equal(result.success, false)
      assert.equal(result.transient, true)
      assert.equal(posts, before + 1) // no hidden POST replay
      sendCode = 0
      const beforeToken = tokenCalls
      assert.ok((await client.sendTextMessage(base)).success)
      assert.equal(tokenCalls, beforeToken + 1)
    }

    // A failed acquisition may be shared for the concurrent wave, never cached.
    tokenError = true
    const fresh = { ...base, corpId: 'corp-failure' }
    const before = tokenCalls
    const beforePosts = posts
    const failures = await Promise.all([
      client.sendTextMessage(fresh),
      client.sendTextMessage(fresh),
    ])
    assert.ok(failures.every((r) => !r.success && r.transient))
    assert.equal(tokenCalls, before + 1)
    assert.equal(posts, beforePosts)
    tokenError = false
    assert.ok((await client.sendTextMessage(fresh)).success)
    assert.equal(tokenCalls, before + 2)
    // Missing validity is never cached.
    tokenExpiry = undefined
    const noTtl = { ...base, corpId: 'corp-no-ttl' }
    const beforeNoTtl = tokenCalls
    await client.sendTextMessage(noTtl)
    await client.sendTextMessage(noTtl)
    assert.equal(tokenCalls, beforeNoTtl + 2)
    // Simulated network/HTTP failures retain existing retry semantics.
    sendCode = 45009
    const limited = await client.sendTextMessage(base)
    assert.equal(limited.transient, true)
    assert.equal(limited.success, false)
    sendCode = 40003
    assert.equal((await client.sendTextMessage(base)).transient, false)
    // Same 600-message workload as the short online test, without network calls.
    sendCode = 0
    tokenExpiry = 7200
    const batchClient = new WeComClient(config as never)
    const beforeBatchTokens = tokenCalls
    const beforeBatchPosts = posts
    const executor = new DeliveryExecutor(
      async (id) => {
        const result = await batchClient.sendTextMessage(input(Number(id)))
        assert.equal(result.success, true)
      },
      5,
      1000,
    )
    const batch = await executor.run(Array.from({ length: 600 }, (_, i) => String(i)))
    assert.deepEqual(batch, { accepted: 600, deferred: 0 })
    assert.equal(tokenCalls - beforeBatchTokens, 1)
    assert.equal(posts - beforeBatchPosts, 600)
    assert.equal(new Set(seen.slice(-600).map((x) => JSON.stringify(x.body))).size, 600)
    assert.deepEqual(executor.snapshot(), { active: 0, pending: 0, outstanding: 0 })
    console.log('600-message simulation: 1 gettoken, 600 distinct sends, no deferred work.')
    console.log(
      'WeCom message token reuse, single-flight, credential isolation, expiry, rejected-token retry, payload integrity and diagnostic redaction passed. No real provider requests.',
    )
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
