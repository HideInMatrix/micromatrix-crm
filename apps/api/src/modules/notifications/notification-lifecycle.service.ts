import { Injectable, Logger } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../prisma.service'
import { instantFromEpochMilliseconds, nowInstant } from '../../prisma/temporal'
import type { PrismaClient } from '../../prisma/db'
import { notificationRecipientLock, tryNotificationLock } from './notification-lifecycle-locks'

type Tx = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
const PAGE_SIZE = 50
const MAX_ITEMS = 500
const CURSOR_ID = 'aggregation-lifecycle-v1'
const DAY = 86_400_000
const DEDUP_DEFAULT_DAYS = 30

export function notificationDedupRetentionDays(): number {
  const raw = process.env.CRM_NOTIFICATION_DEDUP_RETENTION_DAYS ?? String(DEDUP_DEFAULT_DAYS)
  const days = Number(raw)
  return /^\d+$/.test(raw) && Number.isSafeInteger(days) && days >= 1 && days <= 3650
    ? days
    : DEDUP_DEFAULT_DAYS
}

export function notificationRetentionDays(): number | null {
  if (process.env.CRM_NOTIFICATION_RETENTION !== '1') return null
  const raw = process.env.CRM_NOTIFICATION_RETENTION_DAYS ?? '90'
  const days = Number(raw)
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(days) || days < 30 || days > 3650) return null
  return days
}

@Injectable()
export class NotificationLifecycleService {
  private readonly logger = new Logger(NotificationLifecycleService.name)
  constructor(private readonly prisma: PrismaService) {}

  // Short, globally serialized cursor claim. Crash after claiming a page
  // delays it until the next full pass; it cannot permanently lose candidates.
  private async nextPage(): Promise<string[]> {
    const client = this.prisma.client
    return client.transaction(async (tx) => {
      if (!(await tryNotificationLock(client, tx, 'notification-lifecycle-cursor'))) return []
      const orm = tx.orm.public
      const cursor = await orm.NotificationLifecycleCursor.where({ id: CURSOR_ID }).first()
      const query = orm.NotificationBatch.where((row) => row.id.gt(cursor?.lastBatchId ?? ''))
        .select('id')
        .orderBy((row) => row.id.asc())
        .limit(PAGE_SIZE)
      const rows = await query.all()
      const lastBatchId = rows.length === PAGE_SIZE ? rows[rows.length - 1]!.id : ''
      if (cursor)
        await orm.NotificationLifecycleCursor.where({ id: CURSOR_ID }).update({ lastBatchId })
      else await orm.NotificationLifecycleCursor.create({ id: CURSOR_ID, lastBatchId })
      return rows.map((row) => row.id)
    })
  }
  async sweep() {
    const ids = await this.nextPage()
    const metrics = {
      scanned: ids.length,
      archived: 0,
      orphans: 0,
      removedItems: 0,
      skipped: 0,
      failed: 0,
    }
    const days = notificationRetentionDays()
    const rawDedup = process.env.CRM_NOTIFICATION_DEDUP_RETENTION_DAYS
    if (
      rawDedup !== undefined &&
      (!/^\d+$/.test(rawDedup) ||
        !Number.isSafeInteger(Number(rawDedup)) ||
        Number(rawDedup) < 1 ||
        Number(rawDedup) > 3650)
    )
      this.logger.warn('聚合去重保留期限配置无效，使用默认30天')
    if (process.env.CRM_NOTIFICATION_RETENTION === '1' && days === null)
      this.logger.warn('聚合明细保留期限配置无效，跳过到期归档')
    for (const id of ids) {
      try {
        const result = await this.cleanBatch(id, days)
        if (!result) {
          metrics.skipped++
          continue
        }
        if (result.kind === 'orphan') metrics.orphans++
        else metrics.archived++
        metrics.removedItems += result.items
      } catch {
        metrics.failed++
      }
    }
    if (
      metrics.archived ||
      metrics.orphans ||
      metrics.failed ||
      process.env.CRM_EXTERNAL_EVENT_PERF === '1'
    )
      this.logger.log(JSON.stringify({ kind: 'notification_lifecycle', ...metrics }))
    return metrics
  }

  private async dbNow(tx: Tx): Promise<number> {
    const q = this.prisma.client.raw
      .sql`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::text AS ms`.returnsRow({
      ms: 'pg/text@1',
    })
    for await (const row of tx.query(q.build())) {
      const ms = Number(row.ms)
      if (Number.isSafeInteger(ms) && ms > 0) return ms
    }
    throw new Error('Lifecycle database clock unavailable')
  }

  private async cleanBatch(
    id: string,
    days: number | null,
  ): Promise<{ kind: 'orphan' | 'archive'; items: number } | null> {
    const client = this.prisma.client
    return client.transaction(async (tx) => {
      const orm = tx.orm.public
      const candidate = await orm.NotificationBatch.where({ id }).first()
      if (!candidate) return null
      if (
        !(await tryNotificationLock(
          client,
          tx,
          notificationRecipientLock(candidate.tenantId, candidate.recipientId),
        ))
      )
        return null
      if (!(await tryNotificationLock(client, tx, 'notification-scope:' + candidate.scopeKey)))
        return null
      const batch = await orm.NotificationBatch.where({ id }).first()
      if (
        !batch ||
        batch.scopeKey !== candidate.scopeKey ||
        batch.tenantId !== candidate.tenantId ||
        batch.recipientId !== candidate.recipientId
      )
        return null
      const [tenant, recipient] = await Promise.all([
        orm.Tenants.where({ id: batch.tenantId }).select('id').first(),
        orm.Users.where({ id: batch.recipientId, tenantId: batch.tenantId }).select('id').first(),
      ])
      const orphan = !tenant || !recipient
      if (
        !orphan &&
        (days === null || batch.detailsArchivedAt || !batch.sealedAt || batch.sealDeadAt)
      )
        return null
      if (batch.channel !== 'SYSTEM' && batch.channel !== 'WECOM')
        throw Error('Unknown aggregation channel')
      const now = await this.dbNow(tx)
      const cutoff = now - (days ?? 90) * DAY
      if (!orphan && batch.sealedAt!.epochMilliseconds > cutoff) return null
      if (batch.itemCount < 0 || batch.itemCount > MAX_ITEMS)
        throw Error('Lifecycle item cap exceeded')

      // Lock actual output before changing its association, contents or items.
      // NOWAIT failures skip this round rather than blocking a live sender.
      if (batch.outputId) {
        const q =
          batch.channel === 'WECOM'
            ? client.raw
                .sql`SELECT id FROM message_deliveries WHERE id=${batch.outputId} FOR UPDATE NOWAIT`.returnsRow(
                { id: 'pg/text@1' },
              )
            : client.raw
                .sql`SELECT id FROM notifications WHERE id=${batch.outputId} FOR UPDATE NOWAIT`.returnsRow(
                { id: 'pg/text@1' },
              )
        for await (const _row of tx.query(q.build())) {
          /* acquire row lock */
        }
      }
      const system =
        batch.channel === 'SYSTEM' && batch.outputId
          ? await orm.Notifications.where({ id: batch.outputId }).first()
          : null
      const external =
        batch.channel === 'WECOM' && batch.outputId
          ? await orm.MessageDeliveries.where({ id: batch.outputId }).first()
          : null
      if (system && (system.tenantId !== batch.tenantId || system.userId !== batch.recipientId))
        throw Error('Lifecycle system output scope mismatch')
      if (
        external &&
        (external.tenantId !== batch.tenantId ||
          external.channel !== 'WECOM' ||
          external.externalSubject !== batch.externalSubject ||
          (external.integrationId !== batch.integrationId && external.integrationId !== null) ||
          (external.userId !== batch.recipientId && !(orphan && external.userId === null)))
      )
        throw Error('Lifecycle delivery output scope mismatch')
      if (!orphan) {
        if (system && (!system.readAt || system.readAt.epochMilliseconds > cutoff)) return null
        if (
          external &&
          (external.status !== 'SUCCEEDED' ||
            !external.sentAt ||
            external.sentAt.epochMilliseconds > cutoff ||
            external.updatedAt.epochMilliseconds > cutoff)
        )
          return null
      }
      const items = await orm.NotificationItem.where({ batchId: id })
        .limit(MAX_ITEMS + 1)
        .all()
      if (items.length !== (batch.detailsArchivedAt ? 0 : batch.itemCount))
        throw Error('Lifecycle item count mismatch')
      if (!orphan && !batch.outputId && items.some((row) => !row.suppressedAt))
        throw Error('Missing output for active items')
      if (items.length) {
        const expiresAt = instantFromEpochMilliseconds(now + notificationDedupRetentionDays() * DAY)
        await orm.NotificationSourceTombstone.createAll(
          items.map((row) => ({
            tenantId: batch.tenantId,
            sourceKey: row.sourceKey,
            batchId: row.batchId,
            itemId: row.id,
            expiresAt,
          })),
        )
        const count = await orm.NotificationItem.where({ batchId: id }).deleteAndCount()
        if (count !== items.length) throw Error('Lifecycle item delete conflict')
      }
      if (orphan) {
        if (system)
          await orm.Notifications.where({
            id: system.id,
            tenantId: batch.tenantId,
            userId: batch.recipientId,
          }).deleteAndCount()
        if (external) {
          const success = external.status === 'SUCCEEDED'
          await orm.MessageDeliveries.where({ id: external.id, tenantId: batch.tenantId }).update({
            event: 'AGGREGATED:' + batch.category,
            userId: null,
            externalSubject: null,
            title: '聚合通知接收人已删除',
            content: null,
            link: null,
            providerMessageId: null,
            claimToken: randomUUID(),
            nextAttemptAt: null,
            status: success ? 'SUCCEEDED' : 'DEAD',
            errorCode: success ? null : 'AGGREGATION_RECIPIENT_REMOVED',
            errorMessage: success ? null : '接收人已删除，停止后续投递；已出网请求结果可能未知',
            updatedAt: nowInstant(),
          })
        }
        if ((await orm.NotificationBatch.where({ id }).deleteAndCount()) !== 1)
          throw Error('Lifecycle batch delete conflict')
        return { kind: 'orphan', items: items.length }
      }
      if (
        (await orm.NotificationBatch.where({ id })
          .where((row) => row.detailsArchivedAt.isNull())
          .updateAndCount({ detailsArchivedAt: instantFromEpochMilliseconds(now) })) !== 1
      )
        throw Error('Lifecycle archive conflict')
      return { kind: 'archive', items: items.length }
    })
  }
}
