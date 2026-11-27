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
        Array.from({ length: 499 }, () => ({
          batchId: capBatch.id,
          sourceKey: uid(),
          event: 'CUSTOMER_ADD',
          _type: 'system',
          title: 'fixture',
          occurredAt: now,
        })),
      )
      await tx.orm.public.NotificationBatch.where({ id: capBatch.id }).update({ itemCount: 500 })
    })
    const split = (await append({
      ...input(),
      recipientId: otherRecipientId,
      event: 'CUSTOMER_ADD',
      language: 'en-US',
    }))!
    const splitBatch = (await orm.NotificationBatch.where({ id: split.batchId }).first())!
    assert.equal(splitBatch.scopeKey, capBatch.scopeKey)
    assert.equal(splitBatch.shard, capBatch.shard + 1)
    assert.equal(splitBatch.itemCount, 1)
    assert.equal((await orm.NotificationBatch.where({ id: capBatch.id }).first())?.itemCount, 500)
    assert.equal((await orm.NotificationItem.where({ batchId: capBatch.id }).all()).length, 500)

    console.log(
      'Real PostgreSQL aggregation store: concurrent append, source dedupe, category/channel/tenant isolation, rollback, concurrent sealing, restart recovery, late arrival and 500-item shard passed. No provider requests.',
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
