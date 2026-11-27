import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  AggregationItemInput,
  SealedOutputWriter,
} from '../src/modules/notifications/notification-aggregation.store'

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant } = await import('../src/prisma/temporal')
  const { NotificationAggregationStore } =
    await import('../src/modules/notifications/notification-aggregation.store')
  const prisma = new PrismaService()
  const client = prisma.client
  const orm = client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenantId = uid()
  const otherTenantId = uid()
  const recipientId = uid()
  const otherRecipientId = uid()
  const otherTenantRecipientId = uid()
  const now = nowInstant()
  let store = new NotificationAggregationStore(prisma)
  const base = {
    tenantId,
    recipientId,
    channel: 'SYSTEM',
    event: 'CLUE_ADD',
    type: 'assign',
    language: 'zh-CN',
    title: 'fixture notification',
    content: 'fixture content',
    link: '/leads?id=fixture',
    occurredAt: now,
  } as const
  const input = (patch: Partial<typeof base> = {}): AggregationItemInput => ({
    ...base,
    ...patch,
    intentId: uid(),
  })
  const append = (item: AggregationItemInput) => client.transaction((tx) => store.append(tx, item))
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const alignWindow = async () => {
    // Fixtures run on the same machine as PostgreSQL. Allow most of the
    // 5-second window for the concurrent append assertions.
    const phase = Date.now() % 5000
    if (phase > 900) await sleep(5100 - phase)
  }
  const waitDue = async (ids: string[]) => {
    const end = Date.now() + 6500
    while (Date.now() < end) {
      const due = new Set(await store.dueIds(200))
      if (ids.every((id) => due.has(id))) return
      await sleep(50)
    }
    throw new Error('Aggregation batches did not become due')
  }
  let writes = 0
  const writeOutput: SealedOutputWriter = async (tx, batch, items) => {
    writes++
    if (batch.channel === 'SYSTEM') {
      return (
        await tx.orm.public.Notifications.create({
          tenantId: batch.tenantId,
          userId: batch.recipientId,
          _type: 'system',
          title: 'fixture summary',
          content: String(items.length),
          sourceType: 'AGGREGATION_FIXTURE',
          sourceId: batch.id,
        })
      ).id
    }
    return (
      await tx.orm.public.MessageDeliveries.create({
        tenantId: batch.tenantId,
        userId: batch.recipientId,
        integrationId: batch.integrationId,
        channel: 'WECOM',
        externalSubject: batch.externalSubject,
        event: 'AGGREGATION_FIXTURE',
        title: 'fixture summary',
        content: String(items.length),
        updatedAt: nowInstant(),
      })
    ).id
  }
  try {
    await orm.Tenants.createAll(
      [tenantId, otherTenantId].map((id) => ({
        id,
        name: 'Aggregation test',
        slug: id,
        updatedAt: now,
      })),
    )
    await orm.Users.createAll(
      [
        { id: recipientId, tenantId },
        { id: otherRecipientId, tenantId },
        { id: otherTenantRecipientId, tenantId: otherTenantId },
      ].map((row) => ({
        ...row,
        name: 'Fixture recipient',
        passwordHash: 'unused-fixture',
        updatedAt: now,
      })),
    )
    const integration = await orm.EnterpriseIntegrations.create({
      tenantId,
      provider: 'WECOM',
      corpId: 'fixture-corp',
      agentId: 'fixture-app',
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
      externalId: 'fixture-external',
      externalKey: 'fixture-external',
      updatedAt: now,
    })
    const wecom = (item: AggregationItemInput): AggregationItemInput => ({
      ...item,
      channel: 'WECOM',
      integrationId: integration.id,
      credentialVersion: integration.credentialVersion,
      externalSubject: 'fixture-external',
    })

    await alignWindow()
    const sameIntent = input()
    const duplicate = await Promise.all(Array.from({ length: 5 }, () => append(sameIntent)))
    assert.ok(duplicate.every(Boolean))
    const mainBatch = duplicate[0]!.batchId
    assert.equal(duplicate.filter((row) => row!.inserted).length, 1)
    assert.equal(new Set(duplicate.map((row) => row!.itemId)).size, 1)

    const concurrent = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        append({
          ...input(),
          event: i % 2 ? 'CLUE_ADD' : 'CLUE_CONVERT_CUSTOMER',
          type: i % 2 ? 'assign' : 'system',
        }),
      ),
    )
    assert.ok(concurrent.every((row) => row?.batchId === mainBatch && row.inserted))
    const customer = (await append({ ...input(), event: 'CUSTOMER_ADD', type: 'system' }))!
    const otherUser = (await append({ ...input(), recipientId: otherRecipientId }))!
    const otherTenant = (await append({
      ...input(),
      tenantId: otherTenantId,
      recipientId: otherTenantRecipientId,
    }))!
    const english = (await append({ ...input(), language: 'en-US' }))!
    const wecomBatch = (await append(wecom(sameIntent)))!
    assert.equal(
      new Set([
        mainBatch,
        customer.batchId,
        otherUser.batchId,
        otherTenant.batchId,
        english.batchId,
        wecomBatch.batchId,
      ]).size,
      6,
    )
    assert.equal(await append({ ...input(), event: 'PERMISSION_CHANGED', type: 'system' }), null)
    assert.equal(
      await append({ ...input(), event: 'CLUE_FOLLOW_UP_RECORD_COMMENT_MENTIONED' }),
      null,
    )
    assert.equal(await append({ ...input(), type: 'announcement' }), null)
    await assert.rejects(
      append({ ...input(), recipientId: otherTenantRecipientId }),
      /recipient unavailable/,
    )
    await assert.rejects(
      append({ ...wecom(input()), externalSubject: 'wrong-mapping' } as AggregationItemInput),
      /channel unavailable/,
    )
    await assert.rejects(
      append({
        ...wecom(input()),
        credentialVersion: integration.credentialVersion + 1,
      } as AggregationItemInput),
      /channel unavailable/,
    )
    const before = await orm.NotificationBatch.where({ id: mainBatch }).first()
    assert.equal(before?.itemCount, 13)
    assert.equal((await orm.NotificationItem.where({ batchId: mainBatch }).all()).length, 13)
    assert.equal(await store.seal(mainBatch, writeOutput), null)
    assert.equal(writes, 0)

    // Caller-owned transaction rollback must include the appended intent.
    const rolledBack = input()
    await assert.rejects(
      client.transaction(async (tx) => {
        await store.append(tx, rolledBack)
        throw new Error('fixture rollback')
      }),
      /fixture rollback/,
    )
    const afterRollback = (await append(rolledBack))!
    assert.equal(afterRollback.inserted, true)
    // The rollback/retry may straddle a real window; count the committed row.
    assert.equal((await orm.NotificationItem.where({ id: afterRollback.itemId }).all()).length, 1)

    // A fresh service instance sees the database backlog. Competing seal calls
    // must create exactly one output, and failed writers roll back their output.
    store = new NotificationAggregationStore(prisma)
    await waitDue([mainBatch, wecomBatch.batchId])
    await assert.rejects(
      store.seal(mainBatch, async (tx, batch, items) => {
        await writeOutput(tx, batch, items)
        throw new Error('fixture output failure')
      }),
      /fixture output failure/,
    )
    assert.equal((await orm.NotificationBatch.where({ id: mainBatch }).first())?.sealedAt, null)
    assert.equal((await orm.Notifications.where({ tenantId, sourceId: mainBatch }).all()).length, 0)
    const deferred = await orm.NotificationBatch.where({ id: mainBatch }).first()
    assert.equal(deferred?.sealFailures, 1)
    assert.equal(deferred?.sealErrorCode, 'SEAL_TRANSACTION_FAILED')
    assert.ok(
      deferred?.nextSealAttemptAt && deferred.nextSealAttemptAt.epochMilliseconds > Date.now(),
    )
    assert.ok(!(await store.dueIds(200)).includes(mainBatch))
    assert.ok((await store.dueIds(200)).includes(wecomBatch.batchId))
    store = new NotificationAggregationStore(prisma)
    const writesBeforeBackoff = writes
    assert.equal(await store.seal(mainBatch, writeOutput), null)
    assert.equal(writes, writesBeforeBackoff)
    // Accelerate only the fixture's due timestamp; never change retry policy.
    await orm.NotificationBatch.where({ id: mainBatch }).update({ nextSealAttemptAt: now })
    // A callback must not link a batch to another tenant/member's output.
    await assert.rejects(
      store.seal(mainBatch, async (tx, batch) => {
        return (
          await tx.orm.public.Notifications.create({
            tenantId: otherTenantId,
            userId: otherTenantRecipientId,
            _type: 'system',
            title: 'wrong tenant fixture',
            sourceType: 'AGGREGATION_WRONG_SCOPE',
            sourceId: batch.id,
          })
        ).id
      }),
      /output scope mismatch/,
    )
    assert.equal((await orm.NotificationBatch.where({ id: mainBatch }).first())?.sealedAt, null)
    assert.equal(
      (
        await orm.Notifications.where({
          sourceType: 'AGGREGATION_WRONG_SCOPE',
          sourceId: mainBatch,
        }).all()
      ).length,
      0,
    )
    assert.equal((await orm.NotificationBatch.where({ id: mainBatch }).first())?.sealFailures, 2)
    await orm.NotificationBatch.where({ id: mainBatch }).update({ nextSealAttemptAt: now })
    const beforeSealWrites = writes
    const seals = await Promise.all(
      Array.from({ length: 5 }, () => store.seal(mainBatch, writeOutput)),
    )
    assert.equal(seals.filter(Boolean).length, 1)
    assert.equal(writes, beforeSealWrites + 1)
    const sealed = seals.find(Boolean)!
    assert.ok(sealed.itemCount >= 13)
    const saved = await orm.NotificationBatch.where({ id: mainBatch }).first()
    assert.ok(saved?.sealedAt)
    assert.equal(saved?.outputId, sealed.outputId)
    assert.equal((await orm.Notifications.where({ tenantId, sourceId: mainBatch }).all()).length, 1)
    const w = await store.seal(wecomBatch.batchId, writeOutput)
    assert.ok(w && w.channel === 'WECOM')
    assert.equal(
      (await orm.MessageDeliveries.where({ id: w.outputId }).first())?.externalSubject,
      'fixture-external',
    )
    assert.equal(await store.seal(mainBatch, writeOutput), null)
    const replay = await append(sameIntent)
    assert.equal(replay?.inserted, false)
    assert.equal(replay?.batchId, mainBatch)
    const late = (await append(input()))!
    assert.notEqual(late.batchId, mainBatch)
    const sealedAfter = await orm.NotificationBatch.where({ id: mainBatch }).first()
    assert.equal(sealedAfter?.itemCount, saved?.itemCount)
    assert.equal(sealedAfter?.outputId, saved?.outputId)

    assert.equal(saved?.sealFailures, 2)
    assert.equal(saved?.nextSealAttemptAt, null)
    assert.equal(saved?.sealErrorCode, null)
    // Failure quarantine persists across service instances. No output and no
    // item is deleted, even when all retry slots have been consumed.
    await waitDue([customer.batchId])
    const failureWriter: SealedOutputWriter = async () => {
      throw new Error('fixture permanent failure')
    }
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => store.seal(customer.batchId, failureWriter)),
    )
    assert.ok(results.some((result) => result.status === 'rejected'))
    assert.equal(
      (await orm.NotificationBatch.where({ id: customer.batchId }).first())?.sealFailures,
      1,
    )
    for (let i = 2; i <= 5; i++) {
      await orm.NotificationBatch.where({ id: customer.batchId }).update({ nextSealAttemptAt: now })
      await assert.rejects(store.seal(customer.batchId, failureWriter), /fixture permanent failure/)
      const failed = await orm.NotificationBatch.where({ id: customer.batchId }).first()
      assert.equal(failed?.sealFailures, i)
      if (i < 5) assert.ok(failed?.nextSealAttemptAt)
      else {
        assert.ok(failed?.sealDeadAt)
        assert.equal(failed?.nextSealAttemptAt, null)
      }
    }
    store = new NotificationAggregationStore(prisma)
    assert.ok(!(await store.dueIds(200)).includes(customer.batchId))
    assert.equal(await store.seal(customer.batchId, writeOutput), null)
    assert.equal((await orm.NotificationItem.where({ batchId: customer.batchId }).all()).length, 1)
    assert.equal(
      (await orm.NotificationBatch.where({ id: customer.batchId }).first())?.outputId,
      null,
    )
    // Fill a real batch to its documented cap, then append another unique item.
    // Fixture prefill bypasses the append path only to avoid 499 serial round trips.
    await alignWindow()
    const capFirst = (await append({
      ...input(),
      recipientId: otherRecipientId,
      event: 'CUSTOMER_ADD',
      language: 'en-US',
    }))!
    const capBatch = (await orm.NotificationBatch.where({ id: capFirst.batchId }).first())!
    await client.transaction(async (tx) => {
      await tx.orm.public.NotificationItem.createAll(
        Array.from({ length: 497 }, () => ({
          batchId: capBatch.id,
          sourceKey: uid(),
          event: 'CUSTOMER_ADD',
          _type: 'system',
          title: 'fixture',
          occurredAt: now,
        })),
      )
      await tx.orm.public.NotificationBatch.where({ id: capBatch.id }).update({ itemCount: 498 })
    })
    const capInputs = Array.from({ length: 4 }, () => ({
      ...input(),
      recipientId: otherRecipientId,
      event: 'CUSTOMER_ADD',
      language: 'en-US' as const,
    }))
    const split = await client.transaction((tx) =>
      store.appendMany(tx, [...capInputs, capInputs[0]!]),
    )
    assert.ok(split.every(Boolean))
    assert.equal(split[0]!.batchId, capBatch.id)
    assert.equal(split[1]!.batchId, capBatch.id)
    assert.equal(split[2]!.batchId, split[3]!.batchId)
    assert.equal(split[4]!.itemId, split[0]!.itemId)
    assert.equal(split[4]!.inserted, false)
    const splitBatch = (await orm.NotificationBatch.where({ id: split[2]!.batchId }).first())!
    assert.equal(splitBatch.scopeKey, capBatch.scopeKey)
    assert.equal(splitBatch.shard, capBatch.shard + 1)
    assert.equal(splitBatch.itemCount, 2)
    assert.equal((await orm.NotificationBatch.where({ id: capBatch.id }).first())?.itemCount, 500)
    assert.equal((await orm.NotificationItem.where({ batchId: capBatch.id }).all()).length, 500)

    // Two competing groups acquire recipients in the same order regardless
    // of caller order. Preserve per-input result positions and source identity.
    await alignWindow()
    const group = [
      input(),
      input({ recipientId: otherRecipientId }),
      wecom(input()),
      input({ tenantId: otherTenantId, recipientId: otherTenantRecipientId }),
      { ...input(), event: 'CUSTOMER_ADD' },
      { ...input(), type: 'announcement' as const },
    ]
    const [a, b] = await Promise.all([
      client.transaction((tx) => store.appendMany(tx, group)),
      client.transaction((tx) => store.appendMany(tx, [...group].reverse())),
    ])
    b.reverse()
    assert.equal(a[5], null)
    assert.equal(b[5], null)
    for (let i = 0; i < 5; i++) {
      assert.equal(a[i]!.itemId, b[i]!.itemId)
      assert.equal(Number(a[i]!.inserted) + Number(b[i]!.inserted), 1)
    }
    assert.equal(new Set(a.slice(0, 5).map((r) => r!.batchId)).size, 5)
    const invalidGroup = [
      input(),
      { ...wecom(input()), externalSubject: 'invalid-mapping' } as AggregationItemInput,
    ]
    const invalidCount = (await orm.NotificationBatch.where({ tenantId }).all()).reduce(
      (n, r) => n + r.itemCount,
      0,
    )
    await assert.rejects(
      client.transaction((tx) => store.appendMany(tx, invalidGroup)),
      /channel unavailable/,
    )
    assert.equal(
      (await orm.NotificationBatch.where({ tenantId }).all()).reduce((n, r) => n + r.itemCount, 0),
      invalidCount,
    )
    const rollbackGroup = [input(), wecom(input()), input({ recipientId: otherRecipientId })]
    await assert.rejects(
      client.transaction(async (tx) => {
        await store.appendMany(tx, rollbackGroup)
        throw Error('group rollback')
      }),
      /group rollback/,
    )
    const recovered = await client.transaction((tx) => store.appendMany(tx, rollbackGroup))
    assert.ok(recovered.every((r) => r?.inserted))
    // Identity memoization cannot be reused after a committed transaction.
    await orm.EnterpriseIntegrations.where({ id: integration.id }).update({
      credentialVersion: integration.credentialVersion + 1,
    })
    await assert.rejects(
      client.transaction((tx) => store.appendMany(tx, [input(), wecom(input())])),
      /channel unavailable/,
    )
    await orm.EnterpriseIntegrations.where({ id: integration.id }).update({
      credentialVersion: integration.credentialVersion,
    })
    // A tombstone is authoritative even when past its manual cleanup date;
    // bulk and single lookup must return the exact original reference.
    const { createHash } = await import('node:crypto')
    const archived = input()
    const sourceKey = createHash('sha256')
      .update(
        JSON.stringify([
          archived.tenantId,
          archived.recipientId,
          archived.channel,
          archived.event,
          archived.intentId,
        ]),
      )
      .digest('hex')
    const oldBatch = uid(),
      oldItem = uid()
    await orm.NotificationSourceTombstone.create({
      sourceKey,
      tenantId,
      batchId: oldBatch,
      itemId: oldItem,
      expiresAt: now,
    })
    try {
      const replay = await client.transaction((tx) =>
        store.appendMany(tx, [archived, input(), archived]),
      )
      assert.deepEqual(replay[0], { batchId: oldBatch, itemId: oldItem, inserted: false })
      assert.deepEqual(replay[2], replay[0])
      assert.ok(replay[1]?.inserted)
    } finally {
      await orm.NotificationSourceTombstone.where({ sourceKey }).deleteAndCount()
    }

    // A group blocked on a scope lock until the next fixed window must
    // never append to the old window, even when it was open at admission.
    await alignWindow()
    const boundaryInput = {
      ...input(),
      recipientId: otherRecipientId,
      language: 'en-US' as const,
      event: 'CLUE_ADD',
    }
    const oldWindow = (await append(boundaryInput))!
    const oldRow = (await orm.NotificationBatch.where({ id: oldWindow.batchId }).first())!
    let locked!: () => void
    let unlock!: () => void
    const acquired = new Promise<void>((resolve) => {
      locked = resolve
    })
    const release = new Promise<void>((resolve) => {
      unlock = resolve
    })
    const holder = client.transaction(async (tx) => {
      const key = 'notification-scope:' + oldRow.scopeKey
      const q = client.raw
        .sql`SELECT 1::int4 AS locked FROM pg_advisory_xact_lock(hashtextextended(${key},0))`.returnsRow(
        { locked: 'pg/int4@1' },
      )
      for await (const _row of tx.query(q.build())) break
      locked()
      await release
    })
    await acquired
    const boundaryGroup = [
      { ...boundaryInput, intentId: uid() },
      { ...boundaryInput, intentId: uid() },
    ]
    const blocked = client.transaction((tx) => store.appendMany(tx, boundaryGroup))
    // Attach error handler while the intentionally blocked transaction waits.
    void blocked.catch(() => {})
    try {
      await sleep(Math.max(0, oldRow.windowEnd.epochMilliseconds - Date.now() + 150))
    } finally {
      unlock()
      await holder
    }
    const next = await blocked
    assert.ok(next.every((r) => r?.inserted && r.batchId !== oldRow.id))
    assert.equal(next[0]!.batchId, next[1]!.batchId)
    const nextRow = (await orm.NotificationBatch.where({ id: next[0]!.batchId }).first())!
    assert.ok(nextRow.windowStart.epochMilliseconds >= oldRow.windowEnd.epochMilliseconds)
    assert.equal(
      (await orm.NotificationBatch.where({ id: oldRow.id }).first())?.itemCount,
      oldRow.itemCount,
    )

    console.log(
      'Real PostgreSQL aggregation store: concurrent append, source dedupe, category/channel/tenant isolation, rollback, concurrent sealing, restart recovery, durable backoff, quarantine, late arrival and 500-item shard, bulk split, overlapping reversed groups, mixed invalid identity rollback, transaction-local credential freshness and archived dedup and scope-lock window rollover passed. No provider requests.',
    )
  } finally {
    for (const tenant of [tenantId, otherTenantId]) {
      await orm.NotificationBatch.where({ tenantId: tenant }).deleteAll()
      await orm.Notifications.where({ tenantId: tenant }).deleteAll()
      await orm.MessageDeliveries.where({ tenantId: tenant }).deleteAll()
      await orm.ExternalUserMappings.where({ tenantId: tenant }).deleteAll()
      await orm.EnterpriseIntegrations.where({ tenantId: tenant }).deleteAll()
      await orm.Users.where({ tenantId: tenant }).deleteAll()
      await orm.Tenants.where({ id: tenant }).deleteAll()
    }
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
