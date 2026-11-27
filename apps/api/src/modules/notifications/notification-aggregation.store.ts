import { createHash } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import {
  notificationAggregationIdentity,
  resolveNotificationAggregationPolicy,
  type MessageLanguage,
  type NotificationBizType,
} from '@micromatrix/shared'
import type { PrismaClient } from '../../prisma/db'
import { instantFromEpochMilliseconds, type nowInstant } from '../../prisma/temporal'
import { PrismaService } from '../../prisma.service'

type Transaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
type Instant = ReturnType<typeof nowInstant>

type Channel =
  | { channel: 'SYSTEM' }
  | {
      channel: 'WECOM'
      integrationId: string
      credentialVersion: number
      externalSubject: string
    }

export type AggregationItemInput = Channel & {
  tenantId: string
  recipientId: string
  /** Caller supplies stable durable intent id, not a content hash. */
  intentId: string
  event: string
  type: NotificationBizType
  language: MessageLanguage
  title: string
  content?: string | null
  link?: string | null
  linkLabel?: string | null
  sourceType?: string | null
  sourceId?: string | null
  occurredAt: Instant
}

type Batch = NonNullable<Awaited<ReturnType<NotificationAggregationStore['findBatch']>>>
type Item = Awaited<ReturnType<NotificationAggregationStore['findItems']>>[number]
export type SealedOutputWriter = (
  tx: Transaction,
  batch: Batch,
  items: readonly Item[],
) => Promise<string>

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/**
 * Durable persistence primitive. Caller owns notification gate/recipient selection
 * and invokes one append per transaction (or retries a rolled back group).
 * No provider I/O, SSE, timers or network retries inside these transactions.
 */
@Injectable()
export class NotificationAggregationStore {
  constructor(private readonly prisma: PrismaService) {}

  private async databaseTime(tx: Transaction): Promise<number> {
    const query = this.prisma.client.raw.sql`
      SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::text AS ms
    `.returnsRow({ ms: 'pg/text@1' })
    for await (const row of tx.query(query.build())) {
      const ms = Number(row.ms)
      if (Number.isSafeInteger(ms) && ms >= 0) return ms
    }
    throw new Error('Unable to read aggregation database clock')
  }

  private async lock(tx: Transaction, key: string): Promise<void> {
    const query = this.prisma.client.raw.sql`
      SELECT 1::int4 AS locked
      FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))
    `.returnsRow({ locked: 'pg/int4@1' })
    for await (const _row of tx.query(query.build())) break
  }

  private findBatch(tx: Transaction, id: string) {
    return tx.orm.public.NotificationBatch.where({ id }).first()
  }

  private findItems(tx: Transaction, batchId: string) {
    return tx.orm.public.NotificationItem.where({ batchId })
      .orderBy((row) => row.createdAt.asc())
      .orderBy((row) => row.id.asc())
      .all()
  }

  /** Stable recipient lock order for grouped caller transactions. Seal only takes
   * a scope lock; it never waits for a recipient lock. */
  async appendMany(tx: Transaction, inputs: AggregationItemInput[]) {
    const keys = [...new Set(inputs.map((input) => this.recipientLock(input)))].sort()
    for (const key of keys) await this.lock(tx, key)
    const results = []
    for (const input of inputs) results.push(await this.append(tx, input))
    return results
  }

  private recipientLock(input: AggregationItemInput): string {
    return 'notification-recipient:' + digest([input.tenantId, input.recipientId])
  }

  async append(
    tx: Transaction,
    input: AggregationItemInput,
  ): Promise<{
    batchId: string
    itemId: string
    inserted: boolean
  } | null> {
    const policy = resolveNotificationAggregationPolicy(input)
    if (policy.aggregationMode === 'NONE') return null
    if (!input.intentId) throw new Error('Notification aggregation requires a stable intent id')
    const sourceKey = digest([
      input.tenantId,
      input.recipientId,
      input.channel,
      input.event,
      input.intentId,
    ])
    await this.lock(tx, this.recipientLock(input))
    // Source lock is independent of the window so retries across windows are idempotent.
    await this.lock(tx, 'notification-source:' + sourceKey)
    const existing = await tx.orm.public.NotificationItem.where({ sourceKey }).first()
    if (existing) {
      return { batchId: existing.batchId, itemId: existing.id, inserted: false }
    }

    const recipient = await tx.orm.public.Users.where({
      id: input.recipientId,
      tenantId: input.tenantId,
      status: 'ACTIVE',
    })
      .select('id')
      .first()
    if (!recipient) throw new Error('Notification aggregation recipient unavailable')

    if (input.channel === 'WECOM') {
      const [integration, mapping, tenant] = await Promise.all([
        tx.orm.public.EnterpriseIntegrations.where({
          id: input.integrationId,
          tenantId: input.tenantId,
          provider: 'WECOM',
          credentialVersion: input.credentialVersion,
          syncEnabled: true,
          lastTestSucceeded: true,
        })
          .select('id')
          .first(),
        tx.orm.public.ExternalUserMappings.where({
          tenantId: input.tenantId,
          userId: input.recipientId,
          provider: 'WECOM',
          active: true,
          externalId: input.externalSubject,
        })
          .select('id')
          .first(),
        tx.orm.public.Tenants.where({
          id: input.tenantId,
          enterpriseSyncResource: 'WECOM',
        })
          .select('id')
          .first(),
      ])
      if (!integration || !mapping || !tenant)
        throw new Error('Notification aggregation channel unavailable')
    }

    // If waiting for a contended window lock crossed its deadline, move to the
    // current database window. Never append to a sealed or already expired batch.
    for (let attempt = 0; attempt < 3; attempt++) {
      const identity = notificationAggregationIdentity(
        {
          ...input,
          receivedAtMs: await this.databaseTime(tx),
        },
        policy,
      )
      if (!identity) throw new Error('Invalid notification aggregation scope')
      const scopeKey = digest(identity.key)
      await this.lock(tx, 'notification-scope:' + scopeKey)
      const receivedAtMs = await this.databaseTime(tx)
      if (receivedAtMs < identity.windowStartMs || receivedAtMs >= identity.windowEndMs) continue
      const latest = await tx.orm.public.NotificationBatch.where({ scopeKey })
        .orderBy((row) => row.shard.desc())
        .first()
      const batch =
        latest && !latest.sealedAt && latest.itemCount < policy.maxItems
          ? latest
          : await tx.orm.public.NotificationBatch.create({
              scopeKey,
              shard: latest ? latest.shard + 1 : 0,
              tenantId: input.tenantId,
              recipientId: input.recipientId,
              channel: input.channel,
              category: policy.category,
              aggregationGroup: policy.aggregationGroup,
              aggregationMode: policy.aggregationMode,
              priority: policy.priority,
              language: input.language,
              integrationId: input.channel === 'WECOM' ? input.integrationId : null,
              credentialVersion: input.channel === 'WECOM' ? input.credentialVersion : null,
              externalSubject: input.channel === 'WECOM' ? input.externalSubject : null,
              windowStart: instantFromEpochMilliseconds(identity.windowStartMs),
              windowEnd: instantFromEpochMilliseconds(identity.windowEndMs),
              createdAt: instantFromEpochMilliseconds(receivedAtMs),
            })
      const item = await tx.orm.public.NotificationItem.create({
        batchId: batch.id,
        sourceKey,
        event: input.event,
        _type: input.type,
        title: input.title,
        content: input.content ?? null,
        link: input.link ?? null,
        linkLabel: input.linkLabel ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        occurredAt: input.occurredAt,
        createdAt: instantFromEpochMilliseconds(receivedAtMs),
      })
      const updated = await tx.orm.public.NotificationBatch.where({ id: batch.id })
        .where((row) => row.sealedAt.isNull())
        .updateAndCount({ itemCount: batch.itemCount + 1 })
      if (updated !== 1) throw new Error('Notification aggregation batch changed')
      return { batchId: batch.id, itemId: item.id, inserted: true }
    }
    throw new Error('Notification aggregation window advanced; retry durable intent')
  }

  /** Bounded candidates, not claims. Competing scanners must call seal(). */
  async dueIds(limit = 50): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new RangeError('Invalid aggregation scan limit')
    return this.prisma.client.transaction(async (tx) => {
      const now = instantFromEpochMilliseconds(await this.databaseTime(tx))
      const rows = await tx.orm.public.NotificationBatch.where((row) => row.sealedAt.isNull())
        .where((row) => row.windowEnd.lte(now))
        .select('id')
        .orderBy((row) => row.windowEnd.asc())
        .orderBy((row) => row.id.asc())
        .limit(limit)
        .all()
      return rows.map((row) => row.id)
    })
  }

  /**
   * One transaction freezes the items, materializes the single durable output,
   * and seals the batch. A failed writer rolls everything back; no external I/O.
   * Returned output is suitable for a post-commit wake-up only.
   */
  async seal(
    id: string,
    writeOutput: SealedOutputWriter,
  ): Promise<{
    batchId: string
    outputId: string
    channel: string
    itemCount: number
  } | null> {
    return this.prisma.client.transaction(async (tx) => {
      const candidate = await this.findBatch(tx, id)
      if (!candidate || candidate.sealedAt) return null
      await this.lock(tx, 'notification-scope:' + candidate.scopeKey)
      const batch = await this.findBatch(tx, id)
      const now = await this.databaseTime(tx)
      if (!batch || batch.sealedAt || batch.windowEnd.epochMilliseconds > now) return null
      const items = await this.findItems(tx, id)
      if (!items.length || items.length !== batch.itemCount) {
        throw new Error('Notification aggregation item count mismatch')
      }
      const outputId = await writeOutput(tx, batch, items)
      // Validate output association against the original tenant/member/channel.
      const output =
        batch.channel === 'SYSTEM'
          ? await tx.orm.public.Notifications.where({
              id: outputId,
              tenantId: batch.tenantId,
              userId: batch.recipientId,
            })
              .select('id')
              .first()
          : batch.channel === 'WECOM'
            ? await tx.orm.public.MessageDeliveries.where({
                id: outputId,
                tenantId: batch.tenantId,
                userId: batch.recipientId,
                channel: 'WECOM',
                integrationId: batch.integrationId,
                externalSubject: batch.externalSubject,
              })
                .select('id')
                .first()
            : null
      if (!output) throw new Error('Notification aggregation output scope mismatch')
      const sealed = await tx.orm.public.NotificationBatch.where({ id })
        .where((row) => row.sealedAt.isNull())
        .updateAndCount({ outputId, sealedAt: instantFromEpochMilliseconds(now) })
      if (sealed !== 1) throw new Error('Notification aggregation seal conflict')
      return { batchId: id, outputId, channel: batch.channel, itemCount: items.length }
    })
  }
}
