import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { RateClaim } from '../src/modules/notifications/wecom-rate-limit.service'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { WeComClient } = await import('../src/modules/enterprise-integrations/wecom.client')
  const { MessageDeliveryService } =
    await import('../src/modules/notifications/message-delivery.service')
  const { WeComRateLimitService, weComQuotaKeys } =
    await import('../src/modules/notifications/wecom-rate-limit.service')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenants = [uid(), uid(), uid()]
  const corp = uid()
  const contexts = new Map(
    tenants.map((id, i) => [
      id,
      { corpId: corp, agentId: i === 2 ? '124' : '123', appSecret: 'fixture-secret' },
    ]),
  )
  const appKeys = new Set<string>()
  const identity = (tenantId: string, externalSubject: string) => {
    const input = { ...contexts.get(tenantId)!, externalSubject }
    appKeys.add(weComQuotaKeys(input).appKey)
    return input
  }
  const useApp = (tenantId: string, agentId: string) => {
    contexts.set(tenantId, { corpId: corp, agentId, appSecret: 'fixture-secret' })
    identity(tenantId, 'seed')
  }
  tenants.forEach((t) => identity(t, 'seed'))
  const config = {
    get: (key: string) => (key === 'WECOM_API_BASE_URL' ? 'https://example.invalid' : undefined),
  }
  const integration = {
    getWeComRuntimeContext: async (tenantId: string) => ({
      integration: { id: 'fixture', credentialVersion: 1 },
      credentials: contexts.get(tenantId)!,
    }),
  }
  const quota = new WeComRateLimitService(prisma)
  const quota2 = new WeComRateLimitService(prisma)
  const makeWorker = (q = quota) =>
    new MessageDeliveryService(
      prisma,
      {} as never,
      integration as never,
      new WeComClient(config as never),
      undefined,
      undefined,
      undefined,
      undefined,
      q,
    )
  const worker = makeWorker(),
    other = makeWorker(quota2)
  const create = (tenantId: string, externalSubject: string) =>
    orm.MessageDeliveries.create({
      tenantId,
      channel: 'WECOM',
      event: 'CLUE_ADD',
      externalSubject,
      title: 'Fixture',
      updatedAt: nowInstant(),
    })
  const get = (id: string) => orm.MessageDeliveries.where({ id }).first()
  const postRows: Array<{ to: string; agent: number }> = []
  let sendCode = 0,
    httpStatus = 200
  const originalFetch = globalThis.fetch
  const previousEnv = { ...process.env }
  Object.assign(process.env, {
    CRM_WECOM_RATE_LIMIT: '1',
    CRM_WECOM_APP_DAILY_LIMIT: '100',
    CRM_WECOM_APP_PER_SECOND: '10',
    CRM_WECOM_MEMBER_PER_MINUTE: '2',
    CRM_WECOM_MEMBER_PER_HOUR: '5',
    CRM_WECOM_MEMBER_PER_DAY: '8',
  })
  globalThis.fetch = async (input, init) => {
    const target = new URL(String(input))
    assert.equal(target.origin, 'https://example.invalid')
    if (target.pathname === '/cgi-bin/gettoken')
      return Response.json({ errcode: 0, access_token: 'fixture-token', expires_in: 7200 })
    assert.equal(target.pathname, '/cgi-bin/message/send')
    assert.equal(init?.method, 'POST')
    const data = JSON.parse(String(init?.body))
    postRows.push({ to: data.touser, agent: data.agentid })
    return Response.json({ errcode: sendCode, msgid: 'fixture-msg' }, { status: httpStatus })
  }
  const expectWait = async (id: string, code = 'WECOM_RATE_LIMIT_WAIT', attempts = 0) => {
    const row = await get(id)
    assert.equal(row?.status, 'PENDING')
    assert.equal(row?.attempts, attempts)
    assert.equal(row?.errorCode, code)
    assert.ok(row?.nextAttemptAt && row.nextAttemptAt.epochMilliseconds > Date.now())
    return row!
  }
  const seed = async (tenantId: string, subject: string, age: number, count: number) => {
    const keys = weComQuotaKeys(identity(tenantId, subject))
    await orm.WeComSendReservation.createAll(
      Array.from({ length: count }, () => ({
        id: uid(),
        ...keys,
        reservedAt: instantFromEpochMilliseconds(Date.now() - age),
      })),
    )
    return keys
  }
  type PrivateWorker = {
    claimDelivery(id: string): Promise<RateClaim | null>
    completeDelivery(claim: RateClaim, providerId: string): Promise<boolean>
  }
  const claims = worker as unknown as PrivateWorker
  try {
    await orm.Tenants.createAll(
      tenants.map((id) => ({ id, slug: id, name: 'Quota fixture', updatedAt: nowInstant() })),
    )
    // One real application shared by two CRM tenants; two service instances.
    const group = await Promise.all(
      Array.from({ length: 5 }, (_, i) => create(tenants[i % 2]!, i % 2 ? 'MEMBER' : 'member')),
    )
    await Promise.all([
      worker.processIds(group.slice(0, 3).map((r) => r.id)),
      other.processIds(group.slice(3).map((r) => r.id)),
    ])
    const rows = await Promise.all(group.map((r) => get(r.id)))
    assert.equal(rows.filter((r) => r?.status === 'SUCCEEDED').length, 2)
    assert.equal(postRows.length, 2)
    const waiting = rows.filter((r) => r?.status === 'PENDING')
    assert.equal(waiting.length, 3)
    for (const r of waiting) await expectWait(r!.id)
    const shared = weComQuotaKeys(identity(tenants[0]!, 'member'))
    assert.equal((await orm.WeComSendReservation.where({ appKey: shared.appKey }).all()).length, 2)
    assert.equal(
      (await orm.WeComSendReservation.where({ memberKey: shared.memberKey }).all()).length,
      2,
    )

    const another = await create(tenants[0]!, 'other-member')
    const separate = await create(tenants[2]!, 'member')
    await worker.processIds([another.id, separate.id])
    assert.equal((await get(another.id))?.status, 'SUCCEEDED')
    assert.equal((await get(separate.id))?.status, 'SUCCEEDED')
    contexts.set(tenants[1]!, { corpId: corp, agentId: '0123', appSecret: 'rotated-fixture' })
    assert.deepEqual(weComQuotaKeys(identity(tenants[1]!, 'MEMBER')), shared)
    const afterRotation = await create(tenants[1]!, 'member')
    await makeWorker().processIds([afterRotation.id])
    await expectWait(afterRotation.id)
    assert.equal(postRows.length, 4)

    // Expiry is based on the DB reservation clock; only fixture timestamps are
    // advanced to simulate an expired rolling window. Scheduler resumes one row.
    await orm.WeComSendReservation.where({ memberKey: shared.memberKey }).updateAll({
      reservedAt: instantFromEpochMilliseconds(Date.now() - 61_000),
    })
    await orm.MessageDeliveries.where({ id: waiting[0]!.id }).update({
      nextAttemptAt: instantFromEpochMilliseconds(Date.now() - 1000),
    })
    await other.scheduledRateWait()
    assert.equal((await get(waiting[0]!.id))?.status, 'SUCCEEDED')
    assert.equal((await get(waiting[0]!.id))?.attempts, 1)
    assert.equal(postRows.length, 5)

    // Isolate windows by using a fresh application each time. Seed history
    // older than the smaller windows to prove hour/day bounds independently.
    const t = tenants[2]!
    useApp(t, '125')
    process.env.CRM_WECOM_APP_PER_SECOND = '1'
    const second = await Promise.all(Array.from({ length: 4 }, (_, i) => create(t, 'second-' + i)))
    await Promise.all([
      worker.processIds(second.slice(0, 2).map((r) => r.id)),
      other.processIds(second.slice(2).map((r) => r.id)),
    ])
    const secondKeys = weComQuotaKeys(identity(t, 'unused'))
    const reservations = await orm.WeComSendReservation.where({ appKey: secondKeys.appKey })
      .orderBy((r) => r.reservedAt.asc())
      .all()
    assert.ok(reservations.length >= 1)
    for (let i = 1; i < reservations.length; i++)
      assert.ok(
        reservations[i]!.reservedAt.epochMilliseconds -
          reservations[i - 1]!.reservedAt.epochMilliseconds >=
          1000,
      )
    for (const r of second) {
      const row = await get(r.id)
      if (row?.status === 'PENDING') await expectWait(r.id)
      else assert.equal(row?.status, 'SUCCEEDED')
    }
    process.env.CRM_WECOM_APP_PER_SECOND = '10'
    useApp(t, '126')
    process.env.CRM_WECOM_APP_DAILY_LIMIT = '2'
    await seed(t, 'old-app-member', 3 * 3600_000, 2)
    const day = await create(t, 'new-app-member')
    await worker.processIds([day.id])
    assert.ok(
      (await expectWait(day.id)).nextAttemptAt!.epochMilliseconds - Date.now() > 20 * 3600_000,
    )
    process.env.CRM_WECOM_APP_DAILY_LIMIT = '100'
    useApp(t, '127')
    process.env.CRM_WECOM_MEMBER_PER_HOUR = '2'
    await seed(t, 'hour-member', 120_000, 2)
    const hour = await create(t, 'hour-member')
    await worker.processIds([hour.id])
    assert.ok((await expectWait(hour.id)).nextAttemptAt!.epochMilliseconds - Date.now() > 3300_000)
    process.env.CRM_WECOM_MEMBER_PER_HOUR = '5'
    useApp(t, '128')
    process.env.CRM_WECOM_MEMBER_PER_DAY = '2'
    await seed(t, 'day-member', 2 * 3600_000, 2)
    const memberDay = await create(t, 'day-member')
    await worker.processIds([memberDay.id])
    assert.ok(
      (await expectWait(memberDay.id)).nextAttemptAt!.epochMilliseconds - Date.now() >
        21 * 3600_000,
    )
    process.env.CRM_WECOM_MEMBER_PER_DAY = '8'

    // A quota wait on a genuine second attempt preserves the already-consumed
    // attempt; disabling the staged flag keeps the original delivery path.
    useApp(t, '135')
    await seed(t, 'retry-member', 1000, 2)
    const retry = await create(t, 'retry-member')
    await orm.MessageDeliveries.where({ id: retry.id }).update({ status: 'FAILED', attempts: 1 })
    await worker.processIds([retry.id])
    await expectWait(retry.id, 'WECOM_RATE_LIMIT_WAIT', 1)
    const disabled = await create(t, 'retry-member')
    const beforeDisabled = postRows.length
    const disabledKeys = weComQuotaKeys(identity(t, 'retry-member'))
    process.env.CRM_WECOM_RATE_LIMIT = '0'
    await worker.processIds([disabled.id])
    assert.equal((await get(disabled.id))?.status, 'SUCCEEDED')
    assert.equal(postRows.length, beforeDisabled + 1)
    assert.equal(
      (await orm.WeComSendReservation.where({ appKey: disabledKeys.appKey }).all()).length,
      2,
    )
    process.env.CRM_WECOM_RATE_LIMIT = '1'

    // Missing app budget is fail-closed, without consuming an attempt.
    useApp(t, '129')
    delete process.env.CRM_WECOM_APP_DAILY_LIMIT
    const invalid = await create(t, 'config-member')
    let before = postRows.length
    await worker.processIds([invalid.id])
    await expectWait(invalid.id, 'WECOM_RATE_LIMIT_UNAVAILABLE')
    assert.equal(postRows.length, before)
    process.env.CRM_WECOM_APP_DAILY_LIMIT = '100'
    const broadcast = await create(t, '@all')
    await worker.processIds([broadcast.id])
    assert.equal((await get(broadcast.id))?.status, 'DEAD')
    assert.equal(postRows.length, before)

    // Actual simulated provider rejections count as attempts and install shared
    // cooldown, even for other members and a new worker instance.
    for (const mode of ['45009', '429']) {
      useApp(t, mode === '45009' ? '130' : '131')
      sendCode = mode === '45009' ? 45009 : 0
      httpStatus = mode === '429' ? 429 : 200
      before = postRows.length
      const limited = await create(t, 'limited-member')
      await worker.processIds([limited.id])
      assert.equal((await get(limited.id))?.status, 'FAILED')
      assert.equal((await get(limited.id))?.attempts, 1)
      assert.equal(
        (await get(limited.id))?.errorCode,
        mode === '429' ? 'WECOM_HTTP_429' : 'WECOM_45009',
      )
      assert.equal(postRows.length, before + 1)
      sendCode = 0
      httpStatus = 200
      const blocked = await create(t, 'different-member')
      await makeWorker(quota2).processIds([blocked.id])
      await expectWait(blocked.id)
      assert.equal(postRows.length, before + 1)
      const key = weComQuotaKeys(identity(t, 'unused')).appKey
      assert.ok(
        (await orm.WeComRateCooldown.where({ appKey: key }).first())!.blockedUntil
          .epochMilliseconds -
          Date.now() >
          55_000,
      )
    }

    // Same claim cannot reserve twice; stale claim cannot reserve after recovery.
    useApp(t, '132')
    const once = await create(t, 'claim-member')
    const claim = (await claims.claimDelivery(once.id))!
    assert.equal(await quota.reserve(claim, identity(t, 'claim-member')), 'granted')
    assert.equal(await quota2.reserve(claim, identity(t, 'claim-member')), 'stale_claim')
    assert.equal(await claims.completeDelivery(claim, 'mock-only'), true)
    assert.equal(await quota2.reserve(claim, identity(t, 'claim-member')), 'stale_claim')
    assert.equal((await orm.WeComSendReservation.where({ id: claim.claimToken }).all()).length, 1)

    // Store failure cannot send without admission; deferral failure leaves
    // SENDING for unknown recovery rather than misclassifying provider failure.
    useApp(t, '133')
    const broken = new WeComRateLimitService(prisma)
    broken.reserve = async () => {
      throw Error('fixture quota unavailable')
    }
    const brokenWorker = makeWorker(broken)
    const postponed = await create(t, 'broken-member')
    before = postRows.length
    await brokenWorker.processIds([postponed.id])
    await expectWait(postponed.id, 'WECOM_RATE_LIMIT_UNAVAILABLE')
    assert.equal(postRows.length, before)
    broken.deferUnavailable = async () => {
      throw Error('fixture persistence unavailable')
    }
    const unknown = await create(t, 'unknown-member')
    await assert.rejects(
      brokenWorker.processIds([unknown.id]),
      /Message delivery processing failed/,
    )
    assert.equal((await get(unknown.id))?.status, 'SENDING')
    assert.equal(postRows.length, before)

    // Expired quota ledger cleanup must not delete active reservations/cooldown.
    useApp(t, '134')
    const old = await seed(t, 'expired-member', 26 * 3600_000, 1)
    await orm.WeComRateCooldown.create({
      appKey: old.appKey,
      blockedUntil: instantFromEpochMilliseconds(Date.now() - 2 * 3600_000),
    })
    await quota.cleanupExpired()
    assert.equal((await orm.WeComSendReservation.where({ appKey: old.appKey }).all()).length, 0)
    assert.equal(await orm.WeComRateCooldown.where({ appKey: old.appKey }).first(), null)
    assert.ok(await orm.WeComSendReservation.where({ id: claim.claimToken }).first())
    const active = weComQuotaKeys({ ...identity(t, 'unused'), agentId: '131' }).appKey
    assert.ok(await orm.WeComRateCooldown.where({ appKey: active }).first())
    console.log(
      'Real PostgreSQL WeCom quota: concurrent app/member limits, cross-tenant app scope, rotation, rolling windows, restart, due scanner, 45009/429 cooldown, fencing, fail-closed, cleanup. No real network.',
    )
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    for (const appKey of appKeys) {
      await orm.WeComSendReservation.where({ appKey }).deleteAll()
      await orm.WeComRateCooldown.where({ appKey }).deleteAll()
    }
    for (const tenantId of tenants) {
      await orm.MessageDeliveries.where({ tenantId }).deleteAll()
      await orm.Tenants.where({ id: tenantId }).deleteAll()
    }
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
