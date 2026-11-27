import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { NotificationAggregationStore } =
    await import('../src/modules/notifications/notification-aggregation.store')
  const { NotificationAggregationConsumer } =
    await import('../src/modules/notifications/notification-aggregation.consumer')
  const { NotificationsService } =
    await import('../src/modules/notifications/notifications.service')
  const { MessageSettingsService } =
    await import('../src/modules/message-settings/message-settings.service')
  const { MessageDeliveryService } =
    await import('../src/modules/notifications/message-delivery.service')
  const { WeComClient } = await import('../src/modules/enterprise-integrations/wecom.client')
  const { WeComRateLimitService, weComQuotaKeys } =
    await import('../src/modules/notifications/wecom-rate-limit.service')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenantId = uid(),
    recipientId = uid(),
    corpId = uid(),
    agentId = '123',
    externalSubject = 'fixture-member'
  const identity = { corpId, agentId, externalSubject }
  const keys = weComQuotaKeys(identity)
  const oldEnv = { ...process.env }
  const originalFetch = globalThis.fetch
  const posts: Record<string, unknown>[] = []
  let onToken: (() => Promise<void>) | undefined
  globalThis.fetch = async (input, init) => {
    const endpoint = new URL(String(input))
    assert.equal(endpoint.origin, 'https://example.invalid')
    if (endpoint.pathname === '/cgi-bin/gettoken') {
      if (onToken) {
        const fn = onToken
        onToken = undefined
        await fn()
      }
      return Response.json({ errcode: 0, access_token: 'mock-token', expires_in: 7200 })
    }
    assert.equal(endpoint.pathname, '/cgi-bin/message/send')
    posts.push(JSON.parse(String(init?.body)))
    return Response.json({ errcode: 0, msgid: 'fixture-accepted' })
  }
  Object.assign(process.env, {
    CRM_NOTIFICATION_AGGREGATION: '1',
    CRM_WECOM_RATE_LIMIT: '0',
    CRM_WECOM_APP_DAILY_LIMIT: '100',
    CRM_WECOM_APP_PER_SECOND: '10',
    CRM_WECOM_MEMBER_PER_MINUTE: '24',
    CRM_WECOM_MEMBER_PER_HOUR: '800',
    CRM_WECOM_MEMBER_PER_DAY: '160',
  })
  try {
    const now = nowInstant()
    await orm.Tenants.create({
      id: tenantId,
      slug: tenantId,
      name: 'Suppression fixture',
      updatedAt: now,
    })
    await orm.Users.create({
      id: recipientId,
      tenantId,
      name: 'Fixture',
      passwordHash: 'unused-fixture',
      updatedAt: now,
    })
    const integration = await orm.EnterpriseIntegrations.create({
      tenantId,
      provider: 'WECOM',
      corpId,
      agentId,
      secretCiphertext: 'fixture',
      secretIv: 'fixture',
      secretAuthTag: 'fixture',
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
      externalId: externalSubject,
      externalKey: externalSubject,
      updatedAt: now,
    })
    const events = ['CLUE_ADD', 'CLUE_CONVERT_CUSTOMER', 'TRANSFER_CLUE'] as const
    await orm.MessageTaskSettings.createAll(
      events.map((event) => ({
        tenantId,
        module: 'CLUE',
        event,
        systemEnabled: true,
        weComEnabled: true,
        updatedAt: now,
      })),
    )
    const settings = new MessageSettingsService(prisma)
    const store = new NotificationAggregationStore(prisma)
    const notifications = new NotificationsService(prisma, settings, undefined, store)
    const quota = new WeComRateLimitService(prisma)
    const runtime = {
      getWeComRuntimeContext: async () => ({
        integration: await orm.EnterpriseIntegrations.where({ id: integration.id }).first(),
        credentials: { corpId, agentId, appSecret: 'fixture-secret' },
      }),
    }
    const config = {
      get: (key: string) =>
        key === 'WECOM_API_BASE_URL'
          ? 'https://example.invalid'
          : key === 'WEB_PUBLIC_URL'
            ? 'https://crm.example.invalid'
            : undefined,
    }
    const makeWorker = () =>
      new MessageDeliveryService(
        prisma,
        settings,
        runtime as never,
        new WeComClient(config as never),
        undefined,
        undefined,
        undefined,
        store,
        quota,
      )
    const worker = makeWorker()
    // Deliberately separate seal and send to test each interleaving.
    const wakeups: string[] = []
    const wakeOnly = makeWorker()
    wakeOnly.processIds = async (ids) => {
      wakeups.push(...ids)
      return ids.length
    }
    const consumer = new NotificationAggregationConsumer(prisma, store, notifications, wakeOnly)
    const sse: string[] = []
    const sub = notifications.subscribe(recipientId).subscribe((e) => {
      if (e.type !== 'heartbeat') sse.push(e.type ?? '')
    })
    const set = (event: string, patch: { systemEnabled?: boolean; weComEnabled?: boolean }) =>
      orm.MessageTaskSettings.where({ tenantId, event }).update(patch)
    const enableAll = () =>
      orm.MessageTaskSettings.where({ tenantId }).updateAll({
        systemEnabled: true,
        weComEnabled: true,
      })
    const batchRow = (id: string) => orm.NotificationBatch.where({ id, tenantId }).first()
    const items = (id: string) => orm.NotificationItem.where({ batchId: id }).all()
    const deliveryRow = (id: string) => orm.MessageDeliveries.where({ id, tenantId }).first()
    const createBatch = async (channel: 'SYSTEM' | 'WECOM', entries: readonly string[]) => {
      // Fixture rows are already admitted and due; consumer still uses real
      // transactional sealing, projection, and output association validation.
      const id = uid(),
        at = instantFromEpochMilliseconds(Date.now() - 6000)
      await orm.NotificationBatch.create({
        id,
        scopeKey: uid(),
        tenantId,
        recipientId,
        channel,
        category: 'LEAD_ACTIVITY',
        aggregationGroup: 'LEAD_ACTIVITY',
        aggregationMode: 'SAME_CATEGORY',
        priority: 'NORMAL',
        language: 'zh-CN',
        windowStart: at,
        windowEnd: instantFromEpochMilliseconds(at.epochMilliseconds + 5000),
        itemCount: entries.length,
        ...(channel === 'WECOM'
          ? {
              integrationId: integration.id,
              credentialVersion: integration.credentialVersion,
              externalSubject,
            }
          : {}),
      })
      await orm.NotificationItem.createAll(
        entries.map((event, i) => ({
          batchId: id,
          sourceKey: uid(),
          event,
          _type: 'system',
          title: 'PRIVATE-TITLE-' + i,
          content: 'PRIVATE-BODY-' + i,
          link: '/leads?id=private-' + i,
          linkLabel: 'PRIVATE-LABEL',
          sourceType: 'fixture',
          sourceId: uid(),
          occurredAt: at,
        })),
      )
      return id
    }
    const assertSuppressed = async (
      id: string,
      disabled: string[],
      reason = 'CHANNEL_EVENT_DISABLED',
    ) => {
      const rows = await items(id)
      assert.equal(rows.length, (await batchRow(id))?.itemCount)
      assert.deepEqual(
        rows
          .filter((row) => row.suppressedAt)
          .map((row) => row.event)
          .sort(),
        [...disabled].sort(),
      )
      assert.ok(
        rows.filter((row) => row.suppressedAt).every((row) => row.suppressionReason === reason),
      )
      assert.ok(
        rows.every(
          (row) =>
            row.title.startsWith('PRIVATE-TITLE') &&
            row.content?.startsWith('PRIVATE-BODY') &&
            row.sourceKey,
        ),
      )
      return rows
    }
    const assertSafe = (row: unknown, count: number) => {
      const encoded = JSON.stringify(row)
      assert.ok(encoded.includes('共 ' + count + ' 条通知'), encoded)
      assert.ok(!encoded.includes('PRIVATE-'))
      assert.ok(!encoded.includes('private-'))
    }
    try {
      // Independent channel gates before sealing, two scanners, one output
      // each. All-disabled batch has sealedAt and no output/wakeup/SSE.
      const system = await createBatch('SYSTEM', events)
      const external = await createBatch('WECOM', events)
      const all = await createBatch('SYSTEM', ['CLUE_CONVERT_CUSTOMER'])
      await set('CLUE_ADD', { weComEnabled: false })
      await set('CLUE_CONVERT_CUSTOMER', { systemEnabled: false })
      await Promise.all([
        consumer.drain(),
        new NotificationAggregationConsumer(prisma, store, notifications, wakeOnly).drain(),
      ])
      const sys = (await batchRow(system))!,
        ext = (await batchRow(external))!,
        empty = (await batchRow(all))!
      assert.ok(sys.sealedAt && sys.outputId && ext.sealedAt && ext.outputId && empty.sealedAt)
      assert.equal(empty.outputId, null)
      assert.equal(sse.length, 1)
      assert.deepEqual(wakeups, [ext.outputId])
      await assertSuppressed(system, ['CLUE_CONVERT_CUSTOMER'])
      await assertSuppressed(external, ['CLUE_ADD'])
      await assertSuppressed(all, ['CLUE_CONVERT_CUSTOMER'])
      assertSafe(await orm.Notifications.where({ id: sys.outputId }).first(), 2)
      assertSafe(await deliveryRow(ext.outputId), 2)
      // Re-enable previous disabled events before sending. Suppressed items
      // cannot return; a new gate change during Token acquisition is observed.
      await enableAll()
      onToken = async () => {
        await set('TRANSFER_CLUE', { weComEnabled: false })
      }
      await worker.processIds([ext.outputId])
      const sent = await deliveryRow(ext.outputId)
      assert.equal(sent?.status, 'SUCCEEDED')
      assert.equal(sent?.attempts, 1)
      assertSafe(sent, 1)
      assert.equal(posts.length, 1)
      assertSafe(posts[0], 1)
      assert.ok(
        (posts[0]!.textcard as { url: string }).url.includes(
          encodeURIComponent('/mobile/mine/message/batch?id=' + external),
        ),
      )
      const filtered = await assertSuppressed(external, ['CLUE_ADD', 'TRANSFER_CLUE'])
      assert.equal(filtered.filter((row) => !row.suppressedAt)[0]?.event, 'CLUE_CONVERT_CUSTOMER')
      await enableAll()
      await worker.processIds([ext.outputId])
      assert.equal(posts.length, 1)
      assert.equal((await orm.MessageDeliveries.where({ tenantId }).all()).length, 1)
      // All disabled after seal: zero POST, no consumed attempt, re-enabling
      // and manual retry cannot resurrect the suppressed source rows.
      const after = await createBatch('WECOM', ['CLUE_ADD'])
      await consumer.drain()
      const afterOut = (await batchRow(after))!.outputId!
      await set('CLUE_ADD', { weComEnabled: false })
      await makeWorker().processIds([afterOut])
      const dead = await deliveryRow(afterOut)
      assert.equal(dead?.status, 'DEAD')
      assert.equal(dead?.attempts, 0)
      assert.equal(dead?.errorCode, 'AGGREGATION_ALL_SUPPRESSED')
      await assertSuppressed(after, ['CLUE_ADD'])
      await enableAll()
      // Test public retry without async dispatch, then explicitly run it.
      const retryWorker = makeWorker()
      const run = retryWorker.processIds.bind(retryWorker)
      retryWorker.processIds = async () => 0
      await retryWorker.retry(tenantId, afterOut)
      await run([afterOut])
      assert.equal((await deliveryRow(afterOut))?.status, 'DEAD')
      assert.equal((await deliveryRow(afterOut))?.attempts, 0)
      assert.equal(posts.length, 1)
      // Frequency waiting then event change; no extra reservation or attempt.
      const waiting = await createBatch('WECOM', events)
      await consumer.drain()
      const waitingOut = (await batchRow(waiting))!.outputId!
      process.env.CRM_WECOM_RATE_LIMIT = '1'
      await quota.block(identity)
      await makeWorker().processIds([waitingOut])
      const pending = await deliveryRow(waitingOut)
      assert.equal(pending?.status, 'PENDING')
      assert.equal(pending?.attempts, 0)
      assert.equal(pending?.errorCode, 'WECOM_RATE_LIMIT_WAIT')
      assert.equal((await orm.WeComSendReservation.where({ appKey: keys.appKey }).all()).length, 0)
      await set('CLUE_CONVERT_CUSTOMER', { weComEnabled: false })
      await orm.WeComRateCooldown.where({ appKey: keys.appKey }).update({
        blockedUntil: instantFromEpochMilliseconds(Date.now() - 1000),
      })
      await orm.MessageDeliveries.where({ id: waitingOut }).update({
        nextAttemptAt: instantFromEpochMilliseconds(Date.now() - 1000),
      })
      await makeWorker().scheduledRateWait()
      assert.equal((await deliveryRow(waitingOut))?.status, 'SUCCEEDED')
      assert.equal((await deliveryRow(waitingOut))?.attempts, 1)
      assert.equal(posts.length, 2)
      assertSafe(posts[1], 2)
      await assertSuppressed(waiting, ['CLUE_CONVERT_CUSTOMER'])
      assert.equal((await orm.WeComSendReservation.where({ appKey: keys.appKey }).all()).length, 1)
      // Legacy singleton's stored business payload is replaced before POST.
      await enableAll()
      const legacy = await createBatch('WECOM', ['CLUE_ADD'])
      await consumer.drain()
      const legacyOut = (await batchRow(legacy))!.outputId!
      await orm.MessageDeliveries.where({ id: legacyOut }).update({
        event: 'CLUE_ADD',
        title: 'PRIVATE-TITLE-legacy',
        content: 'PRIVATE-BODY-legacy',
        link: '/leads?id=private-legacy',
      })
      process.env.CRM_WECOM_RATE_LIMIT = '0'
      await makeWorker().processIds([legacyOut])
      assert.equal((await deliveryRow(legacyOut))?.status, 'SUCCEEDED')
      assert.equal(posts.length, 3)
      assertSafe(posts[2], 1)
      // Recipient disabled after seal: no content, no POST.
      const disabled = await createBatch('WECOM', ['CLUE_ADD'])
      await consumer.drain()
      const disabledOut = (await batchRow(disabled))!.outputId!
      await orm.Users.where({ id: recipientId, tenantId }).update({ status: 'DISABLED' })
      await makeWorker().processIds([disabledOut])
      assert.equal((await deliveryRow(disabledOut))?.status, 'DEAD')
      assert.equal((await deliveryRow(disabledOut))?.attempts, 0)
      await assertSuppressed(disabled, ['CLUE_ADD'], 'RECIPIENT_UNAVAILABLE')
      assert.equal(posts.length, 3)
      // A dangling aggregate marker must not fall through to an immediate send.
      const orphan = await orm.MessageDeliveries.create({
        tenantId,
        userId: recipientId,
        channel: 'WECOM',
        event: 'AGGREGATED:LEAD_ACTIVITY',
        title: 'PRIVATE-ORPHAN',
        externalSubject,
        updatedAt: nowInstant(),
      })
      await makeWorker().processIds([orphan.id])
      assert.equal((await deliveryRow(orphan.id))?.errorCode, 'AGGREGATION_BATCH_MISSING')
      assert.equal((await deliveryRow(orphan.id))?.attempts, 0)
      assert.equal(posts.length, 3)
      console.log(
        'Real PostgreSQL suppression: independent gates, all-disabled seal, competing sealers, post-token recheck, irreversible suppression, retry/no-POST, quota wait/resume, legacy singleton, disabled recipient and orphan guard passed. No real provider requests.',
      )
    } finally {
      sub.unsubscribe()
    }
  } finally {
    globalThis.fetch = originalFetch
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    await orm.WeComSendReservation.where({ appKey: keys.appKey }).deleteAll()
    await orm.WeComRateCooldown.where({ appKey: keys.appKey }).deleteAll()
    await orm.NotificationBatch.where({ tenantId }).deleteAll()
    await orm.Notifications.where({ tenantId }).deleteAll()
    await orm.MessageDeliveries.where({ tenantId }).deleteAll()
    await orm.ExternalUserMappings.where({ tenantId }).deleteAll()
    await orm.EnterpriseIntegrations.where({ tenantId }).deleteAll()
    await orm.Users.where({ tenantId }).deleteAll()
    await orm.Tenants.where({ id: tenantId }).deleteAll()
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
