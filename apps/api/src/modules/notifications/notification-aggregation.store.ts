import { createHash } from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { or } from '@prisma/orm-postgres/orm-client'
import {
  notificationAggregationIdentity,
  resolveNotificationAggregationPolicy,
  type MessageLanguage,
  type NotificationBizType,
} from '@micromatrix/shared'
import type { PrismaClient } from '../../prisma/db'
import { instantFromEpochMilliseconds, type nowInstant } from '../../prisma/temporal'
import { PrismaService } from '../../prisma.service'
import { notificationRecipientLock } from './notification-lifecycle-locks'

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

type AppendResult = { batchId: string; itemId: string; inserted: boolean } | null
type PendingAppend = {
  input: AggregationItemInput
  policy: ReturnType<typeof resolveNotificationAggregationPolicy>
  sourceKey: string
  indices: number[]
}

type Batch = NonNullable<Awaited<ReturnType<NotificationAggregationStore['findBatch']>>>
type Item = Awaited<ReturnType<NotificationAggregationStore['findItems']>>[number]
export type SealedOutputWriter = (
  tx: Transaction,
  batch: Batch,
  items: readonly Item[],
) => Promise<string | null>

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
  private readonly logger = new Logger(NotificationAggregationStore.name)
  private static readonly SEAL_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000]

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

  /** Stable lock order across callers. Group reads/writes are transaction-local;
   * never reuse permission or identity checks across transactions. */
  async appendMany(tx: Transaction, inputs: AggregationItemInput[]): Promise<AppendResult[]> {
    const results: AppendResult[] = inputs.map(() => null)
    const unique = new Map<string, PendingAppend>()
    for (const [index, input] of inputs.entries()) {
      const policy = resolveNotificationAggregationPolicy(input)
      if (policy.aggregationMode === 'NONE') continue
      if (!input.intentId) throw new Error('Notification aggregation requires a stable intent id')
      const sourceKey = digest([
        input.tenantId,
        input.recipientId,
        input.channel,
        input.event,
        input.intentId,
      ])
      const previous = unique.get(sourceKey)
      if (previous) previous.indices.push(index)
      else unique.set(sourceKey, { input, policy, sourceKey, indices: [index] })
    }
    if (!unique.size) return results
    const entries = [...unique.values()]
    const recipientKeys = [
      ...new Set(
        entries.map((e) => notificationRecipientLock(e.input.tenantId, e.input.recipientId)),
      ),
    ].sort()
    for (const key of recipientKeys) await this.lock(tx, key)
    // Keep source locking compatible with the existing single-item path and
    // all deployed writers. A recipient lock precedes every source/scope lock.
    for (const key of [...unique.keys()].sort()) await this.lock(tx, 'notification-source:' + key)

    const orm = tx.orm.public
    const known = new Map<string, { batchId: string; itemId: string }>()
    const sources = [...unique.keys()]
    // Bound query parameters independently of caller group size.
    for (let i = 0; i < sources.length; i += 500) {
      const keys = sources.slice(i, i + 500)
      const rows = await orm.NotificationItem.where((row) => row.sourceKey.in(keys))
        .select('sourceKey', 'batchId', 'id')
        .all()
      for (const row of rows) known.set(row.sourceKey, { batchId: row.batchId, itemId: row.id })
      const missing = keys.filter((key) => !known.has(key))
      if (missing.length) {
        // Expiry is only eligibility for user-confirmed cleanup, never a reason
        // to bypass an existing tombstone.
        const tombstones = await orm.NotificationSourceTombstone.where((row) =>
          row.sourceKey.in(missing),
        )
          .select('sourceKey', 'batchId', 'itemId')
          .all()
        for (const row of tombstones)
          known.set(row.sourceKey, { batchId: row.batchId, itemId: row.itemId })
      }
    }
    const complete = (
      entry: PendingAppend,
      ids: { batchId: string; itemId: string },
      inserted: boolean,
    ) => {
      for (const [offset, index] of entry.indices.entries())
        results[index] = { ...ids, inserted: inserted && offset === 0 }
    }
    const pending: PendingAppend[] = []
    for (const entry of entries) {
      const existing = known.get(entry.sourceKey)
      if (existing) complete(entry, existing, false)
      else pending.push(entry)
    }
    if (!pending.length) return results

    // Fresh DB reads once per exact identity in this transaction. Do not
    // collapse across tenant, member, integration, credential or subject.
    const tenants = new Map<string, { enterpriseSyncResource: string | null }>()
    const recipients = new Set<string>()
    const integrations = new Set<string>()
    const mappings = new Set<string>()
    const groups = new Map<string, PendingAppend[]>()
    for (const entry of pending) {
      const { input, policy } = entry
      let tenant = tenants.get(input.tenantId)
      if (!tenant) {
        const row = await orm.Tenants.where({ id: input.tenantId, status: 'ACTIVE' })
          .select('enterpriseSyncResource')
          .first()
        if (!row) throw new Error('Notification aggregation tenant unavailable')
        tenant = row
        tenants.set(input.tenantId, tenant)
      }
      const memberKey = JSON.stringify([input.tenantId, input.recipientId])
      if (!recipients.has(memberKey)) {
        const recipient = await orm.Users.where({
          id: input.recipientId,
          tenantId: input.tenantId,
          status: 'ACTIVE',
        })
          .select('id')
          .first()
        if (!recipient) throw new Error('Notification aggregation recipient unavailable')
        recipients.add(memberKey)
      }
      if (input.channel === 'WECOM') {
        if (tenant.enterpriseSyncResource !== 'WECOM')
          throw new Error('Notification aggregation channel unavailable')
        const integrationKey = JSON.stringify([
          input.tenantId,
          input.integrationId,
          input.credentialVersion,
        ])
        if (!integrations.has(integrationKey)) {
          const integration = await orm.EnterpriseIntegrations.where({
            id: input.integrationId,
            tenantId: input.tenantId,
            provider: 'WECOM',
            credentialVersion: input.credentialVersion,
            syncEnabled: true,
            lastTestSucceeded: true,
          })
            .select('id')
            .first()
          if (!integration) throw new Error('Notification aggregation channel unavailable')
          integrations.add(integrationKey)
        }
        const mappingKey = JSON.stringify([
          input.tenantId,
          input.recipientId,
          input.externalSubject,
        ])
        if (!mappings.has(mappingKey)) {
          const mapping = await orm.ExternalUserMappings.where({
            tenantId: input.tenantId,
            userId: input.recipientId,
            provider: 'WECOM',
            active: true,
            externalId: input.externalSubject,
          })
            .select('id')
            .first()
          if (!mapping) throw new Error('Notification aggregation channel unavailable')
          mappings.add(mappingKey)
        }
      }
      // Zero is a grouping placeholder only, never a persisted receive time.
      const identity = notificationAggregationIdentity({ ...input, receivedAtMs: 0 }, policy)
      if (!identity) throw new Error('Invalid notification aggregation scope')
      const group = groups.get(identity.key) ?? []
      group.push(entry)
      groups.set(identity.key, group)
    }
    for (const group of groups.values()) {
      let offset = 0
      let windowRetries = 0
      const { input, policy } = group[0]!
      while (offset < group.length) {
        const identity = notificationAggregationIdentity(
          { ...input, receivedAtMs: await this.databaseTime(tx) },
          policy,
        )
        if (!identity) throw new Error('Invalid notification aggregation scope')
        const scopeKey = digest(identity.key)
        await this.lock(tx, 'notification-scope:' + scopeKey)
        const latest = await orm.NotificationBatch.where({ scopeKey })
          .orderBy((row) => row.shard.desc())
          .first()
        const receivedAtMs = await this.databaseTime(tx)
        if (receivedAtMs < identity.windowStartMs || receivedAtMs >= identity.windowEndMs) {
          if (++windowRetries >= 3)
            throw new Error('Notification aggregation window advanced; retry durable intent')
          continue
        }
        windowRetries = 0
        const batch =
          latest &&
          !latest.sealedAt &&
          !latest.sealDeadAt &&
          latest.sealFailures === 0 &&
          !latest.detailsArchivedAt &&
          latest.itemCount < policy.maxItems
            ? latest
            : await orm.NotificationBatch.create({
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
        const take = Math.min(group.length - offset, policy.maxItems - batch.itemCount)
        if (take <= 0) throw new Error('Notification aggregation invalid shard capacity')
        const chunk = group.slice(offset, offset + take)
        const rows = await orm.NotificationItem.createAll(
          chunk.map(({ input: item, sourceKey }) => ({
            batchId: batch.id,
            sourceKey,
            event: item.event,
            _type: item.type,
            title: item.title,
            content: item.content ?? null,
            link: item.link ?? null,
            linkLabel: item.linkLabel ?? null,
            sourceType: item.sourceType ?? null,
            sourceId: item.sourceId ?? null,
            occurredAt: item.occurredAt,
            createdAt: instantFromEpochMilliseconds(receivedAtMs),
          })),
        )
        if (rows.length !== chunk.length)
          throw new Error('Notification aggregation item insert mismatch')
        const bySource = new Map(rows.map((row) => [row.sourceKey, row.id]))
        const updated = await orm.NotificationBatch.where({
          id: batch.id,
          itemCount: batch.itemCount,
          sealFailures: 0,
        })
          .where((row) => row.sealedAt.isNull())
          .where((row) => row.sealDeadAt.isNull())
          .updateAndCount({ itemCount: batch.itemCount + take })
        if (updated !== 1) throw new Error('Notification aggregation batch changed')
        for (const entry of chunk) {
          const itemId = bySource.get(entry.sourceKey)
          if (!itemId) throw new Error('Notification aggregation missing inserted source')
          complete(entry, { batchId: batch.id, itemId }, true)
        }
        offset += take
      }
    }
    return results
  }

  async append(tx: Transaction, input: AggregationItemInput): Promise<AppendResult> {
    return (await this.appendMany(tx, [input]))[0]!
  }

  /** Bounded candidates, not claims. Competing scanners must call seal(). */
  async dueIds(limit = 50): Promise<string[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new RangeError('Invalid aggregation scan limit')
    return this.prisma.client.transaction(async (tx) => {
      const now = instantFromEpochMilliseconds(await this.databaseTime(tx))
      const rows = await tx.orm.public.NotificationBatch.where((row) => row.sealedAt.isNull())
        .where((row) => row.sealDeadAt.isNull())
        .where((row) => row.windowEnd.lte(now))
        .where((row) => or(row.nextSealAttemptAt.isNull(), row.nextSealAttemptAt.lte(now)))
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
    outputId: string | null
    channel: string
    itemCount: number
  } | null> {
    let observed: { scopeKey: string; failures: number } | undefined
    try {
      return await this.prisma.client.transaction(async (tx) => {
        const candidate = await this.findBatch(tx, id)
        if (!candidate || candidate.sealedAt || candidate.sealDeadAt) return null
        await this.lock(tx, notificationRecipientLock(candidate.tenantId, candidate.recipientId))
        await this.lock(tx, 'notification-scope:' + candidate.scopeKey)
        const batch = await this.findBatch(tx, id)
        const now = await this.databaseTime(tx)
        if (
          !batch ||
          batch.sealedAt ||
          batch.sealDeadAt ||
          batch.windowEnd.epochMilliseconds > now ||
          (batch.nextSealAttemptAt && batch.nextSealAttemptAt.epochMilliseconds > now)
        )
          return null
        observed = { scopeKey: batch.scopeKey, failures: batch.sealFailures }
        const items = await this.findItems(tx, id)
        if (!items.length || items.length !== batch.itemCount) {
          throw new Error('Notification aggregation item count mismatch')
        }
        const outputId = await writeOutput(tx, batch, items)
        // Validate output association against the original tenant/member/channel.
        const output = !outputId
          ? null
          : batch.channel === 'SYSTEM'
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
        if (outputId && !output) throw new Error('Notification aggregation output scope mismatch')
        if (!outputId) {
          const remaining = await tx.orm.public.NotificationItem.where({ batchId: id })
            .where((row) => row.suppressedAt.isNull())
            .select('id')
            .first()
          if (remaining) throw new Error('Notification aggregation missing output for active items')
        }
        const sealed = await tx.orm.public.NotificationBatch.where({ id })
          .where((row) => row.sealedAt.isNull())
          .updateAndCount({
            outputId,
            sealedAt: instantFromEpochMilliseconds(now),
            nextSealAttemptAt: null,
            sealErrorCode: null,
          })
        if (sealed !== 1) throw new Error('Notification aggregation seal conflict')
        return { batchId: id, outputId, channel: batch.channel, itemCount: items.length }
      })
    } catch (error) {
      // The output transaction has rolled back. A separate transaction records
      // the failure only if no competing worker already sealed/advanced it.
      if (observed) {
        try {
          await this.recordSealFailure(id, observed)
        } catch {
          this.logger.warn('聚合封批失败状态未能持久化，等待数据库恢复')
        }
      }
      throw error
    }
  }

  private async recordSealFailure(
    id: string,
    observed: { scopeKey: string; failures: number },
  ): Promise<void> {
    await this.prisma.client.transaction(async (tx) => {
      await this.lock(tx, 'notification-scope:' + observed.scopeKey)
      const batch = await this.findBatch(tx, id)
      if (
        !batch ||
        batch.sealedAt ||
        batch.sealDeadAt ||
        batch.scopeKey !== observed.scopeKey ||
        batch.sealFailures !== observed.failures
      )
        return
      const now = await this.databaseTime(tx)
      const failures = batch.sealFailures + 1
      const delay = NotificationAggregationStore.SEAL_BACKOFF_MS[failures - 1]
      await tx.orm.public.NotificationBatch.where({ id, sealFailures: observed.failures })
        .where((row) => row.sealedAt.isNull())
        .where((row) => row.sealDeadAt.isNull())
        .updateAndCount({
          sealFailures: failures,
          nextSealAttemptAt: delay === undefined ? null : instantFromEpochMilliseconds(now + delay),
          sealDeadAt: delay === undefined ? instantFromEpochMilliseconds(now) : null,
          sealErrorCode: 'SEAL_TRANSACTION_FAILED',
        })
    })
  }
}
