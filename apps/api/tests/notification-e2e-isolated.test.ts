import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { mkdirSync, openSync, closeSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runId = 'r89-' + randomUUID().slice(0, 8)
const dir = join(tmpdir(), runId)
mkdirSync(dir, { mode: 0o700 })
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const docker = (...args: string[]) => {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 25000 })
  if (r.status !== 0) throw Error('Docker ' + args[0] + ' failed')
  return r.stdout.trim()
}
const children: ChildProcess[] = []
const containers: string[] = []
const report: Record<string, unknown> = {
  runId,
  startedAt: new Date().toISOString(),
  scope: 'real Nest API + Worker, isolated PG/Redis and loopback mock; synthetic Outbox ingress',
}
const uid = () => randomUUID().replaceAll('-', '')
const ports = async () => {
  const s = createNetServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const port = (s.address() as { port: number }).port
  await new Promise<void>((r) => s.close(() => r()))
  return port
}
const until = async <T>(name: string, fn: () => Promise<T | false>, ms = 30000): Promise<T> => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const value = await fn()
      if (value !== false) return value
    } catch {}
    await sleep(200)
  }
  throw Error('Timed out: ' + name)
}
let tokens = 0
const posts: Array<{ at: number; user: string; body: Record<string, unknown>; code: number }> = []
const injectedCodes: number[] = []
const mock = createServer(async (req, res) => {
  const url = new URL(req.url!, 'http://127.0.0.1')
  res.setHeader('Content-Type', 'application/json')
  if (url.pathname === '/cgi-bin/gettoken') {
    tokens++
    res.end(JSON.stringify({ errcode: 0, access_token: 'fixture-token', expires_in: 7200 }))
    return
  }
  if (url.pathname === '/cgi-bin/message/send' && req.method === 'POST') {
    let body = ''
    for await (const chunk of req) body += chunk
    const payload = JSON.parse(body)
    const code = injectedCodes.shift() ?? 0
    posts.push({ at: Date.now(), user: payload.touser, body: payload, code })
    res.end(
      JSON.stringify({
        errcode: code,
        ...(code === 0 ? { msgid: 'fixture-' + posts.length } : { errmsg: 'synthetic rejection' }),
      }),
    )
    return
  }
  res.statusCode = 404
  res.end('{}')
})
const aborters: AbortController[] = []
let dbClose: (() => Promise<void>) | undefined
async function main() {
  assert.ok(
    !(process.env.R89_FAULTS === '1' && process.env.R89_HTTP_LOAD === '1'),
    'Run fault recovery and HTTP load separately to avoid mixing provider counters and restart timings',
  )
  await new Promise<void>((r) => mock.listen(0, '127.0.0.1', r))
  const mockPort = (mock.address() as { port: number }).port
  const pg = runId + '-pg',
    redis = runId + '-redis'
  const password = randomBytes(18).toString('hex')
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    pg,
    '-p',
    '127.0.0.1::5432',
    '-e',
    'POSTGRES_PASSWORD=' + password,
    '-e',
    'POSTGRES_DB=crm_r89_isolated',
    'postgres:18-alpine',
  )
  containers.push(pg)
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    redis,
    '-p',
    '127.0.0.1::6379',
    'redis:7-alpine',
    'redis-server',
    '--save',
    '',
    '--appendonly',
    'no',
  )
  containers.push(redis)
  const pgPort = docker('port', pg, '5432/tcp').split(':').at(-1)
  const redisPort = docker('port', redis, '6379/tcp').split(':').at(-1)
  await until(
    'postgres',
    async () =>
      docker('exec', pg, 'pg_isready', '-U', 'postgres', '-d', 'crm_r89_isolated') && true,
  )
  await until('redis', async () => docker('exec', redis, 'redis-cli', 'ping') === 'PONG')
  const apiPort = await ports()
  // Explicit overrides: fresh DB, dedicated Redis, random test credentials,
  // loopback providers. No access to existing business DB or provider secrets.
  const env = {
    ...process.env,
    DATABASE_URL:
      'postgresql://postgres:' + password + '@127.0.0.1:' + pgPort + '/crm_r89_isolated',
    REDIS_URL: 'redis://127.0.0.1:' + redisPort,
    PORT: String(apiPort),
    NODE_ENV: 'test',
    JWT_ACCESS_SECRET: randomBytes(32).toString('hex'),
    JWT_REFRESH_SECRET: randomBytes(32).toString('hex'),
    INTEGRATION_CREDENTIALS_KEY: randomBytes(32).toString('hex'),
    WECOM_API_BASE_URL: 'http://127.0.0.1:' + mockPort,
    DINGTALK_API_BASE_URL: 'http://127.0.0.1:' + mockPort,
    LARK_API_BASE_URL: 'http://127.0.0.1:' + mockPort,
    WEB_PUBLIC_URL: 'http://127.0.0.1:' + apiPort,
    CRM_NOTIFICATION_AGGREGATION: '1',
    CRM_WECOM_RATE_LIMIT: '1',
    CRM_WECOM_APP_DAILY_LIMIT: '0',
    CRM_WECOM_APP_PER_SECOND: '10',
    CRM_WECOM_MEMBER_PER_MINUTE: '24',
    CRM_WECOM_MEMBER_PER_HOUR: '800',
    CRM_WECOM_MEMBER_PER_DAY: '0',
    CRM_NOTIFICATION_RETENTION: '0',
    CRM_NOTIFICATION_DEDUP_RETENTION_DAYS: '30',
    CRM_EXTERNAL_EVENT_PERF: '1',
    SWAGGER_ENABLED: 'false',
  }
  assert.equal(new URL(env.DATABASE_URL).pathname, '/crm_r89_isolated')
  Object.assign(process.env, env)
  const migration = spawnSync('./node_modules/.bin/prisma', ['db', 'migrate', '--yes'], {
    env,
    encoding: 'utf8',
    timeout: 90000,
  })
  writeFileSync(join(dir, 'migration.log'), migration.stdout + '\n' + migration.stderr, {
    mode: 0o600,
  })
  assert.equal(migration.status, 0, 'fresh database migration')
  const verify = spawnSync('./node_modules/.bin/prisma', ['db', 'verify'], {
    env,
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(verify.status, 0, 'fresh database schema verification')
  report.migration = 'fresh apply and verify passed'
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { CredentialCipherService } =
    await import('../src/common/services/credential-cipher.service')
  const prisma = new PrismaService()
  dbClose = () => prisma.onModuleDestroy()
  const orm = prisma.client.orm.public
  const start = (name: string, path: string) => {
    const fd = openSync(join(dir, name + '.log'), 'w', 0o600)
    const p = spawn(process.execPath, [path], { env, stdio: ['ignore', fd, fd] })
    closeSync(fd)
    children.push(p)
    return p
  }
  const api = start('api', 'dist/main.js')
  let worker = start('worker', 'dist/worker.js')
  const base = 'http://127.0.0.1:' + apiPort + '/api'
  const request = async (path: string, method = 'GET', body?: unknown, token?: string) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(8000),
    })
    const data = await res.json()
    return { status: res.status, data, headers: res.headers }
  }
  const health = await until('real API + Redis', async () => {
    if (api.exitCode !== null || worker.exitCode !== null) throw Error('service exited')
    const r = await request('/health')
    return r.status === 200 && r.data.redis?.ready ? r.data : false
  })
  report.healthBefore = health
  const reg = await request('/auth/register', 'POST', {
    tenantName: 'R89 isolated fixture',
    name: 'R89 administrator',
    email: uid() + '@example.invalid',
    password: randomBytes(18).toString('hex'),
  })
  assert.ok(reg.status === 201 || reg.status === 200, 'register ' + reg.status)
  const { accessToken, user } = reg.data
  const tenantId = user.tenantId,
    recipientId = user.id,
    operatorId = uid()
  const now = nowInstant()
  await orm.Users.create({
    id: operatorId,
    tenantId,
    name: 'Fixture producer',
    passwordHash: 'unused-fixture',
    updatedAt: now,
  })
  const cipher = new CredentialCipherService({
    get: (key: string) => env[key as keyof typeof env],
    getOrThrow: (key: string) => env[key as keyof typeof env],
  } as never)
  const encrypted = cipher.encrypt('fixture-only')
  await orm.EnterpriseIntegrations.create({
    tenantId,
    provider: 'WECOM',
    corpId: uid(),
    agentId: '123',
    secretCiphertext: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    secretKeyVersion: encrypted.keyVersion,
    syncEnabled: true,
    lastTestSucceeded: true,
    createdById: recipientId,
    updatedById: recipientId,
    updatedAt: now,
  })
  await orm.ExternalUserMappings.create({
    tenantId,
    userId: recipientId,
    provider: 'WECOM',
    externalId: 'fixture-member',
    externalKey: 'fixture-member',
    updatedAt: now,
  })
  const events = [
    { event: 'CLUE_ADD', module: 'CLUE' },
    { event: 'CLUE_CONVERT_CUSTOMER', module: 'CLUE' },
    { event: 'CUSTOMER_ADD', module: 'CUSTOMER' },
  ]
  await orm.MessageTaskSettings.createAll(
    events.map((e) => ({
      ...e,
      tenantId,
      systemEnabled: true,
      weComEnabled: true,
      updatedAt: now,
    })),
  )
  // Real HTTP SSE listener, Redis crosses the actual API/Worker processes.
  const controller = new AbortController()
  aborters.push(controller)
  const sseEvents: string[] = []
  let sseError = ''
  const streamTask = (async () => {
    try {
      const res = await fetch(
        base + '/notifications/stream?token=' + encodeURIComponent(accessToken),
        { signal: controller.signal },
      )
      assert.equal(res.status, 200)
      const decoder = new TextDecoder()
      let buffer = ''
      for await (const chunk of res.body!) {
        buffer += decoder.decode(chunk, { stream: true }).replaceAll('\r', '')
        let i: number
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          const event = frame.match(/^event:\s*(.+)$/m)?.[1]
          if (!event || event === 'message') {
            const data = frame
              .split('\n')
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n')
            if (data) {
              const message = JSON.parse(data)
              if (typeof message.id === 'string') sseEvents.push(message.id)
            }
          }
        }
      }
    } catch (e) {
      if (!controller.signal.aborted) sseError = String(e)
    }
  })()
  await until('SSE subscriber', async () => {
    const r = await request('/health')
    return r.data.notificationRealtime.localConnections === 1
  })
  const phase = Date.now() % 5000
  if (phase > 500) await sleep(5100 - phase)
  const started = Date.now()
  const intentCount = 30
  await orm.ExternalEventNotification.createAll(
    Array.from({ length: intentCount }, (_, i) => ({
      tenantId,
      recipientId,
      operatorId,
      inboxId: uid(),
      event: events[i % 3]!.event,
      resourceName: 'PRIVATE-FIXTURE-' + i,
      link: '/leads?id=' + uid(),
    })),
  )
  const done = await until(
    'worker sealed and delivered',
    async () => {
      const [outbox, batches, deliveries] = await Promise.all([
        orm.ExternalEventNotification.where({ tenantId }).all(),
        orm.NotificationBatch.where({ tenantId }).all(),
        orm.MessageDeliveries.where({ tenantId }).all(),
      ])
      if (
        outbox.length ||
        !batches.length ||
        batches.some((b) => !b.sealedAt) ||
        !deliveries.length ||
        deliveries.some((d) => d.status !== 'SUCCEEDED')
      )
        return false
      if (batches.reduce((sum, b) => sum + b.itemCount, 0) !== intentCount * 2) return false
      return { batches, deliveries }
    },
    45000,
  )
  const station = await orm.Notifications.where({ tenantId, userId: recipientId }).all()
  report.deliveryBeforeSse = {
    station: station.length,
    posts: posts.length,
    batches: done.batches.length,
    items: done.batches.reduce((sum, b) => sum + b.itemCount, 0),
  }
  try {
    await until('SSE reconciliation', async () => sseEvents.length === station.length, 10000)
  } finally {
    report.sseObserved = {
      count: sseEvents.length,
      error: sseError,
      health: (await request('/health')).data.notificationRealtime,
    }
  }
  assert.deepEqual([...sseEvents].sort(), station.map((row) => row.id).sort())
  const items = await orm.NotificationItem.where((row) =>
    row.batchId.in(done.batches.map((b) => b.id)),
  ).all()
  assert.equal(items.length, intentCount * 2)
  assert.equal(posts.length, done.deliveries.length)
  assert.ok(
    posts.every(
      (p) => p.user === 'fixture-member' && !JSON.stringify(p.body).includes('PRIVATE-FIXTURE'),
    ),
  )
  assert.ok(tokens >= 1 && tokens <= 2, 'process-local token caches for API and Worker')
  assert.ok(!sseError)
  const batch = done.batches.find((b) => b.channel === 'SYSTEM')!
  const detail = await request(
    '/notifications/batches/' + batch.id + '/items?page=1&pageSize=20',
    'GET',
    undefined,
    accessToken,
  )
  assert.equal(detail.status, 200)
  assert.equal(detail.headers.get('cache-control'), 'private, no-store')
  assert.equal(detail.data.total, batch.itemCount)
  assert.ok(
    detail.data.items.every(
      (i: { accessible: boolean; content: string | null }) => !i.accessible && i.content === null,
    ),
  )
  assert.equal((await request('/notifications/batches/' + batch.id + '/items')).status, 401)
  const other = await request('/auth/register', 'POST', {
    tenantName: 'R89 foreign fixture',
    name: 'Other',
    email: uid() + '@example.invalid',
    password: randomBytes(18).toString('hex'),
  })
  assert.equal(
    (
      await request(
        '/notifications/batches/' + batch.id + '/items',
        'GET',
        undefined,
        other.data.accessToken,
      )
    ).status,
    404,
  )
  // Manual cleanup HTTP guard, read-only preview, explicit confirmation. No
  // existing user data is touched: synthetic candidates in dedicated DB only.
  const past = instantFromEpochMilliseconds(Date.now() - 1000)
  const key = uid() + uid()
  await orm.NotificationSourceTombstone.create({
    sourceKey: key,
    tenantId,
    batchId: uid(),
    itemId: uid(),
    expiresAt: past,
  })
  const preview = await request(
    '/notification-dedup/cleanup-preview',
    'GET',
    undefined,
    accessToken,
  )
  assert.equal(preview.status, 200)
  assert.equal(preview.data.count, 1)
  for (const confirm of [false, 'false', 'true', 1, 0, null, undefined]) {
    const denied = await request(
      '/notification-dedup/cleanup',
      'POST',
      { count: preview.data.count, fingerprint: preview.data.fingerprint, confirm },
      accessToken,
    )
    assert.equal(denied.status, 400, 'Only literal true may authorize deletion')
    assert.ok(await orm.NotificationSourceTombstone.where({ sourceKey: key }).first())
  }
  assert.ok(await orm.NotificationSourceTombstone.where({ sourceKey: key }).first())
  assert.equal(
    (
      await request(
        '/notification-dedup/cleanup',
        'POST',
        { count: preview.data.count, fingerprint: preview.data.fingerprint, confirm: true },
        accessToken,
      )
    ).data.deleted,
    1,
  )
  assert.equal(await orm.NotificationSourceTombstone.where({ sourceKey: key }).first(), null)
  const reservations = await orm.WeComSendReservation.all()
  assert.equal(reservations.length, posts.length)
  report.smoke = {
    intents: intentCount,
    items: items.length,
    batches: done.batches.length,
    station: station.length,
    providerPosts: posts.length,
    tokenCalls: tokens,
    sse: sseEvents.length,
    quotaReservations: reservations.length,
    elapsedMs: Date.now() - started,
    detailHttp: 200,
    unauthenticated: 401,
    foreign: 404,
    manualCleanup: 'confirmed HTTP deletion; false rejected',
  }
  if (process.env.R89_BROWSER === '1') {
    const { runNotificationBrowser } = await import('./notification-e2e-browser')
    const browserKey = uid() + uid()
    await orm.NotificationSourceTombstone.create({
      sourceKey: browserKey,
      tenantId,
      batchId: uid(),
      itemId: uid(),
      expiresAt: past,
    })
    report.browser = await runNotificationBrowser({
      apiPort,
      dir,
      accessToken,
      refreshToken: reg.data.refreshToken,
      batchId: batch.id,
      wecomBatchId: done.batches.find((b) => b.channel === 'WECOM')!.id,
      checkRetained: async () => {
        assert.ok(await orm.NotificationSourceTombstone.where({ sourceKey: browserKey }).first())
      },
      checkDeleted: async () => {
        assert.equal(
          await orm.NotificationSourceTombstone.where({ sourceKey: browserKey }).first(),
          null,
        )
      },
    })
  }
  if (process.env.R89_FAULTS === '1') {
    // Only this fresh database and loopback provider participate. Inject
    // explicit provider rejections, not ambiguous success/timeouts.
    const beforeIds = new Set(
      (await orm.MessageDeliveries.where({ tenantId }).all()).map((d) => d.id),
    )
    const beforePosts = posts.length,
      beforeTokens = tokens
    const faultStart = Date.now()
    const align = async () => {
      const remaining = 5000 - (Date.now() % 5000)
      await sleep(remaining + 150)
    }
    await align()
    injectedCodes.push(40014, 45009)
    await orm.ExternalEventNotification.createAll(
      Array.from({ length: 20 }, (_, i) => ({
        tenantId,
        recipientId,
        operatorId,
        inboxId: uid(),
        event: i < 10 ? 'CLUE_ADD' : 'CUSTOMER_ADD',
        resourceName: 'FAULT-FIXTURE-' + i,
        link: '/leads?id=' + uid(),
      })),
    )
    const newRows = async () =>
      (await orm.MessageDeliveries.where({ tenantId }).all()).filter((d) => !beforeIds.has(d.id))
    const rejected = await until(
      'two durable provider failures',
      async () => {
        const rows = await newRows()
        return rows.length === 2 &&
          rows.every((d) => d.status === 'FAILED' && d.attempts === 1 && d.nextAttemptAt)
          ? rows
          : false
      },
      20000,
    )
    assert.deepEqual(rejected.map((d) => d.errorCode).sort(), ['WECOM_40014', 'WECOM_45009'])
    assert.equal(posts.length - beforePosts, 2, 'no inline replay')
    const cooldown = (await orm.WeComRateCooldown.all())[0]!
    assert.ok(cooldown && cooldown.blockedUntil.epochMilliseconds > Date.now())
    // Restart only our task-owned worker; persisted failures must survive.
    worker.kill('SIGTERM')
    await until(
      'worker exit',
      async () => worker.exitCode !== null || worker.signalCode !== null,
      10000,
    )
    const restarted = start('worker-restarted', 'dist/worker.js')
    worker = restarted
    await align()
    await orm.ExternalEventNotification.createAll(
      Array.from({ length: 10 }, () => ({
        tenantId,
        recipientId,
        operatorId,
        inboxId: uid(),
        event: 'CUSTOMER_ADD',
        resourceName: 'COOLDOWN-FIXTURE',
        link: '/customers?id=' + uid(),
      })),
    )
    const waiting = await until(
      'persisted quota wait after restart',
      async () => {
        const rows = await newRows()
        return (
          (rows.length === 3 &&
            rows.find(
              (d) =>
                d.status === 'PENDING' &&
                d.errorCode === 'WECOM_RATE_LIMIT_WAIT' &&
                d.attempts === 0,
            )) ||
          false
        )
      },
      20000,
    )
    assert.ok(waiting.nextAttemptAt!.epochMilliseconds >= cooldown.blockedUntil.epochMilliseconds)
    assert.equal(posts.length - beforePosts, 2, 'cooldown must stop new HTTP POST')
    const completed = await until(
      'real scheduled retry after provider cooldown',
      async () => {
        if (restarted.exitCode !== null) throw Error('restart failed')
        const rows = await newRows()
        return rows.length === 3 && rows.every((d) => d.status === 'SUCCEEDED') ? rows : false
      },
      135000,
    )
    assert.deepEqual(completed.map((d) => d.attempts).sort(), [1, 2, 2])
    const faultPosts = posts.slice(beforePosts)
    assert.equal(faultPosts.length, 5)
    assert.deepEqual(
      faultPosts.map((p) => p.code),
      [40014, 45009, 0, 0, 0],
    )
    assert.ok(faultPosts.slice(2).every((p) => p.at >= cooldown.blockedUntil.epochMilliseconds))
    const faultReservations = await orm.WeComSendReservation.all()
    assert.equal(faultReservations.length, posts.length, 'every attempted POST accounted for')
    const afterBatches = await orm.NotificationBatch.where({ tenantId }).all()
    assert.equal(
      afterBatches.reduce((n, b) => n + b.itemCount, 0),
      120,
    )
    assert.equal((await orm.ExternalEventNotification.where({ tenantId }).all()).length, 0)
    report.faults = {
      rejectedCodes: [40014, 45009],
      durableFailed: 2,
      restartedWorker: true,
      quotaWaitAttempts: 0,
      successfulDeliveries: 3,
      actualPosts: faultPosts.length,
      tokenFetches: tokens - beforeTokens,
      attempts: completed.map((d) => d.attempts).sort(),
      cooldownMs: 60000,
      elapsedMs: Date.now() - faultStart,
    }
    console.log(JSON.stringify(report.faults))
  }
  if (process.env.R89_LIFECYCLE === '1') {
    // 5,001 synthetic due rows and protected rows: confirm each bounded
    // batch separately, measure real authenticated HTTP maintenance cost.
    const keys = Array.from({ length: 5001 }, () => uid() + uid())
    const protectedKey = uid() + uid()
    const expired = instantFromEpochMilliseconds(Date.now() - 10000)
    const future = instantFromEpochMilliseconds(Date.now() + 86400000)
    for (let i = 0; i < keys.length; i += 500)
      await orm.NotificationSourceTombstone.createAll(
        keys.slice(i, i + 500).map((sourceKey) => ({
          sourceKey,
          tenantId,
          batchId: uid(),
          itemId: uid(),
          expiresAt: expired,
        })),
      )
    await orm.NotificationSourceTombstone.create({
      sourceKey: protectedKey,
      tenantId,
      batchId: uid(),
      itemId: uid(),
      expiresAt: future,
    })
    const before = await orm.NotificationSourceTombstone.where({ tenantId }).aggregate((agg) => ({
      count: agg.count(),
    }))
    assert.equal(before.count, 5002)
    const { NotificationLifecycleService } =
      await import('../src/modules/notifications/notification-lifecycle.service')
    const lifecycle = new NotificationLifecycleService(prisma)
    const sweepStart = performance.now()
    const sweep = await lifecycle.sweep()
    const sweepMs = performance.now() - sweepStart
    assert.equal(
      (
        await orm.NotificationSourceTombstone.where({ tenantId }).aggregate((a) => ({
          count: a.count(),
        }))
      ).count,
      5002,
    )
    const t1 = performance.now()
    const preview = await request(
      '/notification-dedup/cleanup-preview',
      'GET',
      undefined,
      accessToken,
    )
    const previewMs = performance.now() - t1
    assert.equal(preview.status, 200)
    assert.equal(preview.data.count, 5000)
    assert.equal(preview.data.hasMore, true)
    const t2 = performance.now()
    const clean = await request(
      '/notification-dedup/cleanup',
      'POST',
      { count: preview.data.count, fingerprint: preview.data.fingerprint, confirm: true },
      accessToken,
    )
    const cleanupMs = performance.now() - t2
    assert.ok(clean.status === 200 || clean.status === 201)
    assert.equal(clean.data.deleted, 5000)
    const remaining = await orm.NotificationSourceTombstone.where({ tenantId }).all()
    assert.equal(remaining.length, 2)
    assert.ok(remaining.some((r) => r.sourceKey === protectedKey))
    const second = await request(
      '/notification-dedup/cleanup-preview',
      'GET',
      undefined,
      accessToken,
    )
    assert.equal(second.data.count, 1)
    // No implicit cleanup of the remaining expired row.
    assert.equal((await orm.NotificationSourceTombstone.where({ tenantId }).all()).length, 2)
    const next = await request(
      '/notification-dedup/cleanup',
      'POST',
      { count: second.data.count, fingerprint: second.data.fingerprint, confirm: true },
      accessToken,
    )
    assert.equal(next.data.deleted, 1)
    assert.deepEqual(
      (await orm.NotificationSourceTombstone.where({ tenantId }).all()).map((r) => r.sourceKey),
      [protectedKey],
    )
    report.lifecycle = {
      syntheticExpired: 5001,
      protected: 1,
      scheduledSweep: sweep,
      sweepMs: Math.round(sweepMs * 100) / 100,
      previewMs: Math.round(previewMs * 100) / 100,
      cleanup5000Ms: Math.round(cleanupMs * 100) / 100,
      manualConfirmedBatches: 2,
      remainingExpired: 0,
      remainingProtected: 1,
    }
    console.log(JSON.stringify(report.lifecycle))
  }
  if (process.env.R89_HTTP_LOAD === '1') {
    const { runExternalEventBaseline } = await import('./notification-e2e-http-load')
    report.httpLoad = await runExternalEventBaseline({
      prisma,
      base,
      env,
      profile:
        process.env.R89_LOAD_PROFILE === 'steady50'
          ? 'steady50'
          : process.env.R89_LOAD_PROFILE === 'burst200'
            ? 'burst200'
            : 'baseline',
      apiPid: api.pid!,
      workerPid: worker.pid!,
      pg,
      redis,
      providerCount: () => posts.length,
      tokenCount: () => tokens,
    })
    console.log(
      JSON.stringify({
        ...(report.httpLoad as Record<string, unknown>),
        resourceSamples: undefined,
        dockerResourceSamples: undefined,
        backlogSamples: undefined,
      }),
    )
  }
  report.healthAfter = (await request('/health')).data
  controller.abort()
  await streamTask
  console.log(JSON.stringify(report.smoke))
}
async function run() {
  try {
    await main()
    report.result = 'PASS'
  } catch (e) {
    report.result = 'FAIL'
    report.error = e instanceof Error ? e.message : String(e)
    if (e instanceof Error) report.stack = e.stack
    console.error(report.error)
    process.exitCode = 1
  } finally {
    aborters.forEach((c) => c.abort())
    for (const child of children) child.kill('SIGTERM')
    await sleep(1000)
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
    if (dbClose) await dbClose().catch(() => {})
    mock.closeAllConnections()
    mock.close()
    for (const name of containers.reverse()) {
      try {
        docker('rm', '-f', name)
      } catch {}
    }
    report.finishedAt = new Date().toISOString()
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log('R8.9 report directory: ' + dir)
  }
}
void run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
