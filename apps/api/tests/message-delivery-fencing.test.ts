import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

type Claim = {
  id: string
  tenantId: string
  claimToken: string
  attempts: number
  maxAttempts: number
}
type TestAccess = {
  claimDelivery(id: string): Promise<Claim | null>
  completeDelivery(claim: Claim, providerMessageId: string): Promise<boolean>
  fail(claim: Claim, code: string, message: string, transient: boolean): Promise<boolean>
  recoverStaleDeliveries(): Promise<void>
  processOne(id: string): Promise<void>
  sendByChannel(): Promise<{
    success: boolean
    providerCode: number | null
    providerMessageId: string | null
    message: string
    transient: boolean
  }>
}
async function main() {
  const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
  assert.equal(url.pathname, '/crm_round2_outbox_test')
  const { PrismaService } = await import('../src/prisma.service')
  const { nowInstant, instantFromEpochMilliseconds } = await import('../src/prisma/temporal')
  const { MessageDeliveryService } =
    await import('../src/modules/notifications/message-delivery.service')
  const prisma = new PrismaService()
  const orm = prisma.client.orm.public
  const uid = () => randomUUID().replaceAll('-', '')
  const tenantId = uid(),
    userId = uid()
  const now = nowInstant()
  const stale = instantFromEpochMilliseconds(Date.now() - 6 * 60_000)
  const service = new MessageDeliveryService(prisma, {} as never, {} as never, {} as never)
  const worker = service as unknown as TestAccess
  const competitor = new MessageDeliveryService(
    prisma,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as TestAccess
  const create = (channel: 'WECOM' | 'DINGTALK' | 'LARK' = 'WECOM', maxAttempts = 3) =>
    orm.MessageDeliveries.create({
      tenantId,
      userId,
      channel,
      externalSubject: 'fixture-member',
      event: 'CLUE_ADD',
      title: 'Fixture',
      maxAttempts,
      updatedAt: now,
    })
  const get = (id: string) => orm.MessageDeliveries.where({ id, tenantId }).first()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('No provider network allowed in fencing test')
  }
  try {
    await orm.Tenants.create({
      id: tenantId,
      slug: tenantId,
      name: 'Fencing fixture',
      updatedAt: now,
    })
    await orm.Users.create({
      id: userId,
      tenantId,
      name: 'Fixture member',
      passwordHash: 'unused-fixture',
      updatedAt: now,
    })

    const row = await create()
    const claims = await Promise.all(
      Array.from({ length: 5 }, (_, i) => (i % 2 ? worker : competitor).claimDelivery(row.id)),
    )
    assert.equal(claims.filter(Boolean).length, 1)
    const old = claims.find(Boolean)!
    assert.equal(old.attempts, 1)
    await orm.MessageDeliveries.where({ id: row.id }).update({ updatedAt: stale })
    await competitor.recoverStaleDeliveries()
    assert.equal((await get(row.id))?.status, 'FAILED')
    assert.equal((await get(row.id))?.errorCode, 'WORKER_TIMEOUT_UNKNOWN')
    const next = (await competitor.claimDelivery(row.id))!
    assert.notEqual(next.claimToken, old.claimToken)
    assert.equal(next.attempts, 2)
    assert.equal(await worker.completeDelivery(old, 'late-old-success'), false)
    assert.equal(await worker.fail(old, 'OLD_FAILURE', 'old fixture', false), false)
    assert.equal((await get(row.id))?.status, 'SENDING')
    assert.equal((await get(row.id))?.claimToken, next.claimToken)
    assert.equal(await competitor.completeDelivery(next, 'new-success'), true)
    assert.equal(await worker.fail(old, 'OLD_FAILURE', 'old fixture', true), false)
    assert.equal((await get(row.id))?.providerMessageId, 'new-success')
    assert.equal((await get(row.id))?.status, 'SUCCEEDED')

    // Attempts reset by manual retry, but the claim token can never repeat.
    const manual = await create('DINGTALK')
    const first = (await worker.claimDelivery(manual.id))!
    assert.equal(await worker.fail(first, 'FIXTURE_FAILURE', 'fixture', false), true)
    // Do not dispatch real providers when exercising the public retry method.
    service.processIds = async () => 0
    const retries = await Promise.allSettled([
      service.retry(tenantId, manual.id),
      service.retry(tenantId, manual.id),
    ])
    assert.equal(retries.filter((result) => result.status === 'fulfilled').length, 1)
    const again = (await competitor.claimDelivery(manual.id))!
    assert.equal(again.attempts, first.attempts)
    assert.notEqual(again.claimToken, first.claimToken)
    assert.equal(await worker.completeDelivery(first, 'stale-aba'), false)
    assert.equal(await worker.fail(first, 'STALE_ABA', 'fixture', false), false)
    assert.equal(await competitor.completeDelivery(again, 'new-manual-success'), true)
    assert.equal((await get(manual.id))?.providerMessageId, 'new-manual-success')

    const exhausted = await create('LARK', 1)
    const last = (await worker.claimDelivery(exhausted.id))!
    await orm.MessageDeliveries.where({ id: exhausted.id }).update({ updatedAt: stale })
    await competitor.recoverStaleDeliveries()
    assert.equal((await get(exhausted.id))?.status, 'DEAD')
    assert.equal((await get(exhausted.id))?.attempts, 1)
    assert.equal(await competitor.claimDelivery(exhausted.id), null)
    assert.equal(await worker.completeDelivery(last, 'late-last-success'), false)
    const oldExhausted = await create('WECOM', 1)
    await orm.MessageDeliveries.where({ id: oldExhausted.id }).update({
      status: 'FAILED',
      attempts: 1,
    })
    assert.equal(await worker.claimDelivery(oldExhausted.id), null)
    await competitor.recoverStaleDeliveries()
    assert.equal((await get(oldExhausted.id))?.status, 'DEAD')
    assert.equal((await get(oldExhausted.id))?.errorCode, 'ATTEMPTS_EXHAUSTED')

    const due = await create()
    const pending = (await worker.claimDelivery(due.id))!
    assert.equal(await worker.fail(pending, 'TEMPORARY', 'fixture', true), true)
    assert.equal(await competitor.claimDelivery(due.id), null)
    await orm.MessageDeliveries.where({ id: due.id }).update({ nextAttemptAt: now })
    const dueAgain = (await competitor.claimDelivery(due.id))!
    assert.equal(dueAgain.attempts, 2)
    assert.equal(await competitor.completeDelivery(dueAgain, 'retry-success'), true)

    // Provider acceptance followed by a persistence exception leaves SENDING
    // (unknown outcome); never misclassify it as a provider rejection.
    const ambiguous = await create()
    worker.sendByChannel = async () => ({
      success: true,
      providerCode: 0,
      providerMessageId: 'mock-accepted',
      message: 'ok',
      transient: false,
    })
    worker.completeDelivery = async () => {
      throw new Error('fixture persistence unavailable')
    }
    await assert.rejects(worker.processOne(ambiguous.id), /fixture persistence unavailable/)
    const unresolved = await get(ambiguous.id)
    assert.equal(unresolved?.status, 'SENDING')
    assert.equal(unresolved?.errorCode, null)
    assert.equal(unresolved?.attempts, 1)
    console.log(
      'Real PostgreSQL delivery fencing: concurrent claim, stale success/failure, manual retry ABA, exhausted recovery, durable due time and unknown persistence outcome passed. No provider requests.',
    )
  } finally {
    globalThis.fetch = originalFetch
    await orm.MessageDeliveries.where({ tenantId }).deleteAll()
    await orm.Users.where({ tenantId }).deleteAll()
    await orm.Tenants.where({ id: tenantId }).deleteAll()
    await prisma.onModuleDestroy()
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
