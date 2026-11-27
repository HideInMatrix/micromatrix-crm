import assert from 'node:assert/strict'
import { randomUUID, randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
import type { PrismaService } from '../src/prisma.service'
import { nowInstant } from '../src/prisma/temporal'
import { CredentialCipherService } from '../src/common/services/credential-cipher.service'

const uid = () => randomUUID().replaceAll('-', '')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)))
type Inputs = {
  prisma: PrismaService
  base: string
  env: Record<string, string | undefined>
  apiPid: number
  workerPid: number
  pg: string
  redis: string
  profile?: 'baseline' | 'steady50' | 'burst200'
  providerCount: () => number
  tokenCount: () => number
}
function stats(values: number[]) {
  const ordered = [...values].sort((a, b) => a - b)
  const round = (n: number) => Math.round(n * 100) / 100
  const percentile = (p: number) => ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)] ?? 0
  return {
    count: ordered.length,
    avg: round(ordered.reduce((a, b) => a + b, 0) / Math.max(ordered.length, 1)),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(ordered.at(-1) ?? 0),
  }
}
export async function runExternalEventBaseline(input: Inputs) {
  assert.equal(new URL(input.env.DATABASE_URL!).pathname, '/crm_r89_isolated')
  assert.equal(new URL(input.base).hostname, '127.0.0.1')
  const profile = input.profile ?? 'baseline'
  const burst = profile === 'burst200'
  const chainCount = profile === 'steady50' ? 1500 : 200
  const intervalMs = profile === 'steady50' ? 40 : 100
  const requestCount = chainCount * (burst ? 1 : 2)
  const itemCount = chainCount * (burst ? 2 : 6)
  const orm = input.prisma.client.orm.public
  const now = nowInstant()
  const password = randomBytes(18).toString('hex')
  async function api(
    path: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) {
    const res = await fetch(input.base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    })
    const data = await res.json()
    if (!res.ok)
      throw Error(path + ' HTTP ' + res.status + ' ' + JSON.stringify(data).slice(0, 400))
    return data
  }
  const login = await api('/auth/register', 'POST', {
    tenantName: 'R89 external HTTP fixture',
    name: 'Fixture admin',
    email: uid() + '@example.invalid',
    password,
  })
  const auth = { Authorization: 'Bearer ' + login.accessToken }
  const tenantId = login.user.tenantId as string,
    operatorId = login.user.id as string
  const operator = (await orm.Users.where({ id: operatorId, tenantId }).first())!
  const ownerRole = await orm.Roles.create({
    tenantId,
    name: 'Fixture owner',
    permissions: ['menu:lead', 'menu:customer', 'customer:read'],
    dataScope: 'SELF',
    updatedAt: now,
  })
  const recipients = await Promise.all(
    [0, 1].map(async (i) => {
      const id = uid(),
        email = uid() + '@example.invalid',
        subject = 'r89-owner-' + i
      await orm.Users.create({
        id,
        tenantId,
        name: 'Fixture owner ' + i,
        email,
        passwordHash: operator.passwordHash,
        updatedAt: now,
      })
      await orm.UserRoles.create({ tenantId, userId: id, roleId: ownerRole.id, updatedAt: now })
      await orm.ExternalUserMappings.create({
        tenantId,
        userId: id,
        provider: 'WECOM',
        externalId: subject,
        externalKey: subject,
        updatedAt: now,
      })
      const login = await api('/auth/login', 'POST', { email, password })
      return { id, subject, accessToken: login.accessToken as string }
    }),
  )
  const cipher = new CredentialCipherService({
    get: (key: string) => input.env[key],
    getOrThrow: (key: string) => input.env[key],
  } as never)
  const encrypted = cipher.encrypt('synthetic-credential-only')
  await orm.EnterpriseIntegrations.create({
    tenantId,
    provider: 'WECOM',
    corpId: uid(),
    agentId: '234',
    secretCiphertext: encrypted.ciphertext,
    secretIv: encrypted.iv,
    secretAuthTag: encrypted.authTag,
    secretKeyVersion: encrypted.keyVersion,
    syncEnabled: true,
    lastTestSucceeded: true,
    createdById: operatorId,
    updatedById: operatorId,
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
  const key = { accessKey: uid(), secretKey: uid() + uid() }
  await orm.UserKey.create({ createUser: operatorId, ...key, enable: true, forever: true })
  const eventHeaders = { 'x-access-key': key.accessKey, 'x-secret-key': key.secretKey }
  const poolId = uid()
  const time = BigInt(Date.now())
  await orm.CluePool.create({
    id: poolId,
    name: 'R89 fallback fixture pool',
    organizationId: tenantId,
    ownerId: '["*"]',
    scopeId: '["*"]',
    enable: true,
    auto: false,
    createTime: time,
    updateTime: time,
    createUser: operatorId,
    updateUser: operatorId,
  })
  const baseConfig = {
    actions: { convertLead: false, updateCustomer: false },
    matches: [],
    fields: [],
    owner: null,
  }
  const createTemplate = await api(
    '/external-event-templates',
    'POST',
    {
      name: 'R89 create fixture',
      enabled: true,
      apiKeyUserId: operatorId,
      config: {
        ...baseConfig,
        flow: {
          target: 'lead',
          action: 'create',
          nameExternalKey: 'studentName',
          owner: { externalKey: 'ownerId', provider: 'WECOM' },
          fields: [
            { source: 'event', externalKey: 'phone', fieldKey: 'phone' },
            {
              source: 'event',
              externalKey: 'pool',
              fieldKey: '__leadPool',
              valueMap: [{ externalValue: 'fallback', crmValue: poolId }],
            },
          ],
        },
      },
    },
    auth,
  )
  const convertTemplate = await api(
    '/external-event-templates',
    'POST',
    {
      name: 'R89 convert fixture',
      enabled: true,
      apiKeyUserId: operatorId,
      config: {
        ...baseConfig,
        matches: [{ externalKey: 'phone', crmFieldKey: 'phone' }],
        flow: {
          target: 'lead',
          action: 'convert',
          owner: { externalKey: 'ownerId', provider: 'WECOM' },
          fields: [],
        },
      },
    },
    auth,
  )
  const aborter = new AbortController()
  const sse = new Set<string>()
  const sseDuplicate: string[] = []
  const streamTasks = recipients.map(async (recipient) => {
    try {
      const res = await fetch(
        input.base + '/notifications/stream?token=' + encodeURIComponent(recipient.accessToken),
        { signal: aborter.signal },
      )
      assert.equal(res.status, 200)
      let buffer = ''
      const decoder = new TextDecoder()
      for await (const chunk of res.body!) {
        buffer += decoder.decode(chunk, { stream: true }).replaceAll('\r', '')
        let i: number
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, i)
          buffer = buffer.slice(i + 2)
          const kind = frame.match(/^event:\s*(.+)$/m)?.[1]
          if (kind && kind !== 'message') continue
          const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
          if (!data) continue
          const payload = JSON.parse(data)
          if (typeof payload.id === 'string') {
            if (sse.has(payload.id)) sseDuplicate.push(payload.id)
            sse.add(payload.id)
          }
        }
      }
    } catch (e) {
      if (!aborter.signal.aborted) throw e
    }
  })
  // Attach rejection handlers immediately so a failed stream cannot crash a
  // load run before the final reconciliation.
  for (const task of streamTasks) void task.catch(() => {})
  let interval: ReturnType<typeof setInterval> | undefined
  let sampling: Promise<void> | undefined
  try {
    const deadline = Date.now() + 8000
    let subscribers = false
    while (Date.now() < deadline) {
      const health = await api('/health')
      if (health.notificationRealtime.localConnections >= 3) {
        subscribers = true
        break
      }
      await sleep(100)
    }
    assert.ok(subscribers, 'Both additional recipient SSE streams connected')
    const postBefore = input.providerCount(),
      tokensBefore = input.tokenCount()
    const tag = 'R89-' + uid()
    const responses: number[] = [],
      chains: number[] = [],
      failures: string[] = [],
      starts: number[] = []
    const requestTimes: number[] = []
    const execute = async (eventType: string, externalEventId: string, data: unknown) => {
      const start = performance.now()
      const result = await api(
        '/external-events/execute',
        'POST',
        { eventType, externalEventId, data },
        eventHeaders,
      )
      const end = performance.now()
      responses.push(end - start)
      requestTimes.push(start)
      assert.equal(result.status, 'SUCCESS')
      assert.equal(result.replayed, false)
      assert.equal(result.attempts, 1)
      return result
    }
    // Fixed open-loop arrival schedule; burst submits 200 independent create
    // requests together, not 200 sequential chains. All timings are local.
    const resources: Array<{ atMs: number; process: string; cpuPercent: number; rssKiB: number }> =
      []
    const dockerResources: Array<{ atMs: number; name: string; cpu: string; memory: string }> = []
    const backlog: Array<{
      atMs: number
      outbox: number
      unsealed: number
      pending: number
      failed: number
      oldestOutboxMs: number
    }> = []
    let busy = 0,
      maxBusy = 0
    let loadStart = performance.now()
    const sample = async () => {
      const atMs = Math.round(performance.now() - loadStart)
      const [ps, containers, queue] = await Promise.allSettled([
        execFileAsync('ps', ['-p', input.apiPid + ',' + input.workerPid, '-o', 'pid=,%cpu=,rss='], {
          timeout: 2000,
        }),
        execFileAsync(
          'docker',
          [
            'stats',
            '--no-stream',
            '--format',
            '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}',
            input.pg,
            input.redis,
          ],
          { timeout: 5000 },
        ),
        Promise.all([
          orm.ExternalEventNotification.where({ tenantId }).aggregate((agg) => ({
            count: agg.count(),
          })),
          orm.ExternalEventNotification.where({ tenantId })
            .orderBy((row) => row.createdAt.asc())
            .select('createdAt')
            .first(),
          orm.NotificationBatch.where({ tenantId, sealedAt: null }).aggregate((agg) => ({
            count: agg.count(),
          })),
          orm.MessageDeliveries.where({ tenantId })
            .where((row) => row.status.in(['PENDING', 'SENDING']))
            .aggregate((agg) => ({ count: agg.count() })),
          orm.MessageDeliveries.where({ tenantId, status: 'FAILED' }).aggregate((agg) => ({
            count: agg.count(),
          })),
        ]),
      ])
      if (ps.status === 'fulfilled')
        for (const line of ps.value.stdout.trim().split('\n')) {
          const [pid, cpu, rss] = line.trim().split(/\s+/).map(Number)
          if (pid === input.apiPid || pid === input.workerPid)
            resources.push({
              atMs,
              process: pid === input.apiPid ? 'api' : 'worker',
              cpuPercent: cpu!,
              rssKiB: rss!,
            })
        }
      if (containers.status === 'fulfilled')
        for (const line of containers.value.stdout.trim().split('\n')) {
          const [name, cpu, memory] = line.split('|')
          if (name && cpu && memory) dockerResources.push({ atMs, name, cpu, memory })
        }
      if (queue.status === 'fulfilled') {
        const [out, oldest, unsealed, pending, failed] = queue.value
        backlog.push({
          atMs,
          outbox: out.count,
          unsealed: unsealed.count,
          pending: pending.count,
          failed: failed.count,
          oldestOutboxMs: oldest ? Math.max(0, Date.now() - oldest.createdAt.epochMilliseconds) : 0,
        })
      }
    }
    const scheduleSample = () => {
      if (!sampling)
        sampling = sample().finally(() => {
          sampling = undefined
        })
    }
    await sample()
    loadStart = performance.now()
    // Keep monitoring through final drainage; async sampling never blocks arrivals.
    interval = setInterval(scheduleSample, 1000)
    scheduleSample()
    const tasks: Promise<void>[] = []
    for (let i = 0; i < chainCount; i++) {
      if (!burst) await sleep(loadStart + i * intervalMs - performance.now())
      if (!burst && busy >= 128) {
        failures.push('128 in-flight chain safety bound exceeded')
        break
      }
      if (failures.length) break
      const owner = recipients[i % 2]!
      const phone = '000' + String(i + 1).padStart(8, '0')
      const start = performance.now()
      starts.push(start - loadStart)
      busy++
      maxBusy = Math.max(maxBusy, busy)
      tasks.push(
        (async () => {
          try {
            const created = await execute(createTemplate.eventType, tag + '-' + i + '-create', {
              studentName: 'R89 synthetic ' + i,
              pool: 'fallback',
              phone,
              ownerId: owner.subject,
            })
            if (!burst) {
              const converted = await execute(
                convertTemplate.eventType,
                tag + '-' + i + '-convert',
                {
                  phone,
                  ownerId: owner.subject,
                },
              )
              assert.equal(created.resolvedId, converted.resolvedId)
              assert.ok(converted.customerId)
            }
            chains.push(performance.now() - start)
          } catch (error) {
            failures.push(error instanceof Error ? error.message : String(error))
          } finally {
            busy--
          }
        })(),
      )
    }
    await Promise.all(tasks)
    const loadMs = performance.now() - loadStart
    scheduleSample()
    if (failures.length)
      throw Error('HTTP load stopped after ' + starts.length + ' chains: ' + failures[0])
    assert.equal(chains.length, chainCount)
    assert.equal(responses.length, requestCount)
    const endOfRequests = Date.now()
    let batches: Awaited<ReturnType<typeof orm.NotificationBatch.all>> = []
    let deliveries: Awaited<ReturnType<typeof orm.MessageDeliveries.all>> = []
    let peakOutbox = 0
    let drained = false
    for (let i = 0; i < 480; i++) {
      const [out, b, d] = await Promise.all([
        orm.ExternalEventNotification.where({ tenantId }).aggregate((agg) => ({
          count: agg.count(),
        })),
        orm.NotificationBatch.where({ tenantId }).all(),
        orm.MessageDeliveries.where({ tenantId }).all(),
      ])
      peakOutbox = Math.max(peakOutbox, out.count)
      batches = b
      deliveries = d
      if (
        !out.count &&
        b.length &&
        b.every((row) => !!row.sealedAt) &&
        b.reduce((n, row) => n + row.itemCount, 0) === itemCount &&
        d.length &&
        d.every((row) => row.status === 'SUCCEEDED')
      ) {
        drained = true
        break
      }
      await sleep(250)
    }
    assert.ok(
      drained,
      'Notification backlog drained: ' +
        JSON.stringify({
          items: batches.reduce((n, b) => n + b.itemCount, 0),
          unsealed: batches.filter((b) => !b.sealedAt).length,
          deliveryStatus: deliveries.reduce(
            (a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a),
            {} as Record<string, number>,
          ),
        }),
    )
    const [inbox, leads, customers, station, items] = await Promise.all([
      orm.ExternalEventInbox.where({ organizationId: tenantId, status: 'SUCCESS' }).all(),
      orm.Clue.where({ organizationId: tenantId }).all(),
      orm.Customer.where({ organizationId: tenantId }).all(),
      orm.Notifications.where({ tenantId }).all(),
      orm.NotificationItem.where((row) => row.batchId.in(batches.map((b) => b.id))).all(),
    ])
    assert.equal(inbox.length, requestCount)
    assert.equal(leads.length, chainCount)
    assert.equal(customers.length, burst ? 0 : chainCount)
    assert.equal(items.length, itemCount)
    assert.equal(new Set(items.map((row) => row.sourceKey)).size, itemCount)
    assert.ok(items.every((row) => !row.suppressedAt))
    assert.equal(station.length, batches.filter((b) => b.channel === 'SYSTEM').length)
    assert.equal(deliveries.length, batches.filter((b) => b.channel === 'WECOM').length)
    assert.equal(input.providerCount() - postBefore, deliveries.length)
    // Both API and independent Worker may recover due deliveries. Token
    // cache is process-local (not shared Redis). With one app and no expiry
    // or fault, each of the two processes may fetch once.
    const tokenCalls = input.tokenCount() - tokensBefore
    assert.ok(tokenCalls >= 1 && tokenCalls <= 2, 'at most one token fetch per process')
    assert.ok(
      deliveries.every((d) => d.attempts === 1),
      'quota waiting must not consume attempts',
    )
    const sseDeadline = Date.now() + 5000
    while (sse.size < station.length && Date.now() < sseDeadline) await sleep(100)
    assert.deepEqual([...sse].sort(), station.map((row) => row.id).sort())
    assert.equal(sseDuplicate.length, 0)
    const details = burst
      ? []
      : await Promise.all(
          recipients.map(async (r) => {
            const batch = batches.find(
              (b) =>
                b.channel === 'WECOM' &&
                b.recipientId === r.id &&
                b.category === 'CUSTOMER_ACTIVITY',
            )!
            const detail = await api(
              '/notifications/batches/' + batch.id + '/items?page=1&pageSize=20',
              'GET',
              undefined,
              { Authorization: 'Bearer ' + r.accessToken },
            )
            assert.ok(
              detail.items.length &&
                detail.items.every(
                  (row: { accessible: boolean; content: unknown; link: string }) =>
                    row.accessible &&
                    typeof row.content === 'string' &&
                    row.link.startsWith('/customers?id='),
                ),
            )
            return detail.items.length
          }),
        )
    clearInterval(interval)
    interval = undefined
    await sampling
    await sample()
    const reservations = await orm.WeComSendReservation.all()
    const { weComQuotaKeys } = await import('../src/modules/notifications/wecom-rate-limit.service')
    const integration = (await orm.EnterpriseIntegrations.where({
      tenantId,
      provider: 'WECOM',
    }).first())!
    const keys = recipients.map((r) =>
      weComQuotaKeys({
        corpId: integration.corpId,
        agentId: integration.agentId,
        externalSubject: r.subject,
      }),
    )
    const ledger = reservations.filter((r) => r.appKey === keys[0]!.appKey)
    assert.equal(ledger.length, deliveries.length)
    function rollingPeak(times: number[], window: number) {
      times.sort((a, b) => a - b)
      let left = 0,
        peak = 0
      for (let right = 0; right < times.length; right++) {
        while (times[right]! - times[left]! >= window) left++
        peak = Math.max(peak, right - left + 1)
      }
      return peak
    }
    const quota = {
      appSecondPeak: rollingPeak(
        ledger.map((r) => r.reservedAt.epochMilliseconds),
        1000,
      ),
      memberMinutePeaks: keys.map((k) =>
        rollingPeak(
          ledger
            .filter((r) => r.memberKey === k.memberKey)
            .map((r) => r.reservedAt.epochMilliseconds),
          60000,
        ),
      ),
    }
    assert.ok(quota.appSecondPeak <= 10 && quota.memberMinutePeaks.every((n) => n <= 24))
    const delay = deliveries.map((d) => d.sentAt!.epochMilliseconds - d.createdAt.epochMilliseconds)
    return {
      profile,
      targetRps: burst ? null : profile === 'steady50' ? 50 : 20,
      requestedChains: chainCount,
      successfulChains: chains.length,
      httpRequests: responses.length,
      actualRps: Number((responses.length / (loadMs / 1000)).toFixed(3)),
      loadMs: Math.round(loadMs),
      latencyMs: stats(responses),
      chainMs: stats(chains),
      maxConcurrentChains: maxBusy,
      maxArrivalDelayMs: Math.round(
        Math.max(...starts.map((v, i) => v - (burst ? 0 : i * intervalMs))),
      ),
      inboxSuccess: inbox.length,
      leads: leads.length,
      customers: customers.length,
      items: items.length,
      batches: batches.length,
      station: station.length,
      providerPosts: deliveries.length,
      sse: sse.size,
      tokenCalls,
      postLoadDrainMs: Date.now() - endOfRequests,
      peakObservedOutboxAfterLoad: peakOutbox,
      authorizedDetailItems: details,
      summaryReductionPercent: Number(((1 - batches.length / items.length) * 100).toFixed(2)),
      resourceSamples: resources,
      dockerResourceSamples: dockerResources,
      backlogSamples: backlog,
      quota,
      peakOutboxDuringAndAfter: Math.max(peakOutbox, ...backlog.map((x) => x.outbox)),
      peakOldestObservedOutboxMs: Math.max(0, ...backlog.map((x) => x.oldestOutboxMs)),
      deliveryLatencyMs: stats(delay),
      resourceScope:
        'API/Worker ps sampled process CPU and RSS; not whole-host or production benchmark',
    }
  } finally {
    if (interval) clearInterval(interval)
    await sampling
    aborter.abort()
    await Promise.allSettled(streamTasks)
  }
}
