import { Injectable, Logger, Optional } from '@nestjs/common'
import { performance } from 'node:perf_hooks'
import type { PrismaClient } from '../../prisma/db'
import { PrismaService } from '../../prisma.service'
import { instantFromEpochMilliseconds, nowInstant } from '../../prisma/temporal'
import { BusinessNotificationsService } from './business-notifications.service'
import { MessageDeliveryService } from './message-delivery.service'
import { NotificationsService } from './notifications.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import {
  NotificationAggregationStore,
  type AggregationItemInput,
} from './notification-aggregation.store'
import {
  aggregationEnabled,
  deliveryAggregationItem,
  isAggregateEvent,
} from './notification-aggregation-runtime'
import { NotificationPreparationReads } from './notification-preparation-reads'
import {
  externalEventNotificationInput,
  type ExternalEventNotificationIntent,
} from './external-event-notification-intent'

type Transaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
const BATCH_SIZE = 50
const CONCURRENCY = 2
const WRITE_GROUP_SIZE = 8
const MAX_BATCHES_PER_DRAIN = 4

type PreparedIntent = Awaited<ReturnType<ExternalEventNotificationOutboxService['prepareJob']>>
type OutboxJob = Awaited<ReturnType<ExternalEventNotificationOutboxService['loadDue']>>[number]
type DrainMetrics = {
  scanned: number
  fullScans: number
  oldestDueAgeMs: number
  scanMs: number
  claimed: number
  retryUpdates: number
  fallbackGroups: number
  notifications: number
  deliveries: number
  aggregatedItems: number
  prepareMs: number
  persistMs: number
  publishMs: number
}

@Injectable()
export class ExternalEventNotificationOutboxService {
  private readonly logger = new Logger(ExternalEventNotificationOutboxService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly business: BusinessNotificationsService,
    private readonly settings: MessageSettingsService,
    private readonly notifications: NotificationsService,
    private readonly deliveries: MessageDeliveryService,
    @Optional() private readonly aggregation?: NotificationAggregationStore,
  ) {}

  /** The caller owns the business transaction. Failure must roll back the event. */
  async enqueue(tx: Transaction, intents: ExternalEventNotificationIntent[]): Promise<void> {
    const rows = intents.filter(
      (intent) => intent.recipientId && intent.recipientId !== intent.operatorId,
    )
    if (rows.length) await tx.orm.public.ExternalEventNotification.createAll(rows)
  }

  async drain(): Promise<void> {
    const diagnostic = process.env.CRM_EXTERNAL_EVENT_PERF === '1'
    const start = performance.now()
    const cpuStart = diagnostic ? process.cpuUsage() : undefined
    const loopStart = diagnostic ? performance.eventLoopUtilization() : undefined
    const metrics: DrainMetrics = {
      scanned: 0,
      fullScans: 0,
      oldestDueAgeMs: 0,
      scanMs: 0,
      claimed: 0,
      retryUpdates: 0,
      fallbackGroups: 0,
      notifications: 0,
      deliveries: 0,
      aggregatedItems: 0,
      prepareMs: 0,
      persistMs: 0,
      publishMs: 0,
    }
    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_DRAIN; batch++) {
        if ((await this.drainBatch(metrics)) < BATCH_SIZE) break
      }
    } finally {
      if (diagnostic && metrics.scanned) {
        const cpu = process.cpuUsage(cpuStart)
        this.logger.log(
          JSON.stringify({
            kind: 'external_event_outbox_perf',
            ...metrics,
            processCpuMs: (cpu.user + cpu.system) / 1_000,
            eventLoopUtilization: loopStart
              ? performance.eventLoopUtilization(loopStart).utilization
              : 0,
            deliveryExecutor: this.deliveries.executorSnapshot(),
            totalMs: Math.round((performance.now() - start) * 100) / 100,
          }),
        )
      }
    }
  }

  private loadDue() {
    return this.prisma.client.orm.public.ExternalEventNotification.where((row) =>
      row.nextAttemptAt.lte(nowInstant()),
    )
      .orderBy((row) => row.nextAttemptAt.asc())
      .orderBy((row) => row.createdAt.asc())
      .limit(BATCH_SIZE)
      .all()
  }

  private async prepareJob(job: OutboxJob, reads: NotificationPreparationReads) {
    const input = externalEventNotificationInput(job)
    const [prepared, setting] = await Promise.all([
      this.business.prepare(input, reads),
      reads.read(['setting', input.tenantId, input.event], () =>
        this.settings.getEffectiveSetting(input.tenantId, input.event),
      ),
    ])
    const deliveryRows = prepared
      ? await this.deliveries.prepareOutboxRecords(
          {
            tenantId: input.tenantId,
            event: input.event,
            recipientIds: prepared.userIds,
            title: prepared.title,
            content: prepared.content,
            link: input.link,
          },
          setting,
          reads,
        )
      : []
    const notificationRows =
      prepared && setting.systemEnabled
        ? prepared.userIds.map((userId) => ({
            tenantId: input.tenantId,
            userId,
            _type: input.type,
            title: prepared.title,
            content: prepared.content ?? null,
            link: input.link ?? null,
            sourceType: `EXTERNAL_EVENT:${input.event}`,
            sourceId: job.inboxId,
          }))
        : []
    return {
      job,
      input,
      language: prepared?.language ?? ('zh-CN' as const),
      prepared,
      notificationRows,
      deliveryRows,
    }
  }

  private async persistGroup(group: PreparedIntent[]) {
    return this.prisma.client.transaction(async (tx) => {
      // Stable claim order avoids conflicting lock orders across workers.
      const claimedIds = new Set<string>()
      for (const item of [...group].sort((a, b) => a.job.id.localeCompare(b.job.id))) {
        const count = await tx.orm.public.ExternalEventNotification.where({
          id: item.job.id,
          attempts: item.job.attempts,
        }).deleteAndCount()
        if (count === 1) claimedIds.add(item.job.id)
      }
      const claimed = group.filter((item) => claimedIds.has(item.job.id))
      const notificationRows = []
      const deliveryRows = []
      const aggregated: AggregationItemInput[] = []
      for (const item of claimed) {
        const { job, input, language } = item
        const enabled =
          this.aggregation && aggregationEnabled() && isAggregateEvent(input.event, input.type)
        const meta = {
          intentId: job.inboxId,
          event: input.event,
          type: input.type,
          language,
          occurredAt: job.createdAt,
          sourceType: 'EXTERNAL_EVENT:' + input.event,
          sourceId: job.inboxId,
        }
        for (const row of item.notificationRows) {
          if (enabled)
            aggregated.push({
              ...meta,
              channel: 'SYSTEM',
              tenantId: row.tenantId,
              recipientId: row.userId,
              title: row.title,
              content: row.content,
              link: row.link,
            })
          else notificationRows.push(row)
        }
        for (const { aggregationCredentialVersion, ...row } of item.deliveryRows) {
          const candidate = enabled
            ? deliveryAggregationItem(row, aggregationCredentialVersion, meta)
            : null
          if (candidate)
            aggregated.push({
              ...candidate,
              title: item.prepared!.title,
              content: item.prepared!.content,
              link: input.link,
            })
          else deliveryRows.push(row)
        }
      }
      if (aggregated.length) await this.aggregation!.appendMany(tx, aggregated)
      const notifications = notificationRows.length
        ? await tx.orm.public.Notifications.createAll(notificationRows)
        : []
      const deliveries = deliveryRows.length
        ? await tx.orm.public.MessageDeliveries.createAll(deliveryRows)
        : []
      return {
        claimed: claimed.length,
        notifications,
        deliveries,
        aggregatedItems: aggregated.length,
      }
    })
  }

  private async publishCommitted(
    result: Awaited<ReturnType<ExternalEventNotificationOutboxService['persistGroup']>>,
    metrics: DrainMetrics,
  ): Promise<void> {
    metrics.claimed += result.claimed
    metrics.notifications += result.notifications.length
    metrics.deliveries += result.deliveries.length
    metrics.aggregatedItems += result.aggregatedItems
    const start = performance.now()
    // Realtime and provider processing never run inside the durable transaction.
    // Even if a post-commit signal fails, a committed intent must not be retried.
    const postCommit = await Promise.allSettled(
      result.notifications.map(async (row) =>
        this.notifications.publishCreated(row.tenantId, row.userId, row),
      ),
    )
    if (postCommit.some((outcome) => outcome.status === 'rejected')) {
      this.logger.warn('外部事件通知已落库，实时刷新失败')
    }
    const ids = result.deliveries.filter((row) => row.status === 'PENDING').map((row) => row.id)
    if (ids.length)
      void this.deliveries.processIds(ids).catch(() => {
        this.logger.warn('外部事件投递即时处理失败，等待定时恢复')
      })
    metrics.publishMs += performance.now() - start
  }

  private async retry(job: OutboxJob, metrics: DrainMetrics): Promise<void> {
    const delay = Math.min(300_000, 1_000 * 2 ** Math.min(job.attempts, 9))
    try {
      const updated = await this.prisma.client.orm.public.ExternalEventNotification.where({
        id: job.id,
        attempts: job.attempts,
      }).updateAndCount({
        attempts: job.attempts + 1,
        nextAttemptAt: instantFromEpochMilliseconds(Date.now() + delay),
      })
      metrics.retryUpdates += updated
      if (updated)
        this.logger.warn(`外部事件通知任务失败 event=${job.event} attempt=${job.attempts + 1}`)
    } catch {
      this.logger.warn('外部事件通知重试状态更新失败，任务仍可重新扫描')
    }
  }

  private async persistAndPublish(group: PreparedIntent[], metrics: DrainMetrics): Promise<void> {
    if (!group.length) return
    const start = performance.now()
    let result: Awaited<ReturnType<ExternalEventNotificationOutboxService['persistGroup']>>
    try {
      result = await this.persistGroup(group)
    } catch {
      metrics.persistMs += performance.now() - start
      if (group.length > 1) {
        // A malformed intent must not poison the rest of the group. The rolled
        // back claims are safe to retry separately, with the same attempt fence.
        metrics.fallbackGroups++
        for (const item of group) await this.persistAndPublish([item], metrics)
      } else {
        await this.retry(group[0]!.job, metrics)
      }
      return
    }
    metrics.persistMs += performance.now() - start
    await this.publishCommitted(result, metrics)
  }

  private async drainBatch(metrics: DrainMetrics): Promise<number> {
    const scanStart = performance.now()
    const due = await this.loadDue()
    metrics.scanMs += performance.now() - scanStart
    metrics.scanned += due.length
    if (due.length === BATCH_SIZE) metrics.fullScans++
    if (due.length)
      metrics.oldestDueAgeMs = Math.max(
        metrics.oldestDueAgeMs,
        Date.now() - due[0]!.nextAttemptAt.epochMilliseconds,
      )
    for (let i = 0; i < due.length; i += WRITE_GROUP_SIZE) {
      const group = due.slice(i, i + WRITE_GROUP_SIZE)
      const reads = new NotificationPreparationReads()
      const prepared: PreparedIntent[] = []
      const start = performance.now()
      for (let j = 0; j < group.length; j += CONCURRENCY) {
        const wave = await Promise.all(
          group.slice(j, j + CONCURRENCY).map(async (job) => {
            try {
              return await this.prepareJob(job, reads)
            } catch {
              await this.retry(job, metrics)
              return null
            }
          }),
        )
        for (const item of wave) if (item) prepared.push(item)
      }
      metrics.prepareMs += performance.now() - start
      await this.persistAndPublish(prepared, metrics)
    }
    return due.length
  }
}
