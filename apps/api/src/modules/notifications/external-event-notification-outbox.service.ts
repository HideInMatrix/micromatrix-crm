import { Injectable, Logger } from '@nestjs/common'
import type { PrismaClient } from '../../prisma/db'
import { PrismaService } from '../../prisma.service'
import { instantFromEpochMilliseconds, nowInstant } from '../../prisma/temporal'
import { BusinessNotificationsService } from './business-notifications.service'
import { MessageDeliveryService } from './message-delivery.service'
import { NotificationsService } from './notifications.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import {
  externalEventNotificationInput,
  type ExternalEventNotificationIntent,
} from './external-event-notification-intent'

type Transaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
const BATCH_SIZE = 50
const CONCURRENCY = 2
const MAX_BATCHES_PER_DRAIN = 4

@Injectable()
export class ExternalEventNotificationOutboxService {
  private readonly logger = new Logger(ExternalEventNotificationOutboxService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly business: BusinessNotificationsService,
    private readonly settings: MessageSettingsService,
    private readonly notifications: NotificationsService,
    private readonly deliveries: MessageDeliveryService,
  ) {}

  /** The caller owns the business transaction. Failure must roll back the event. */
  async enqueue(tx: Transaction, intents: ExternalEventNotificationIntent[]): Promise<void> {
    const rows = intents.filter(
      (intent) => intent.recipientId && intent.recipientId !== intent.operatorId,
    )
    if (rows.length) await tx.orm.public.ExternalEventNotification.createAll(rows)
  }

  async drain(): Promise<void> {
    for (let batch = 0; batch < MAX_BATCHES_PER_DRAIN; batch++) {
      if ((await this.drainBatch()) < BATCH_SIZE) break
    }
  }

  private async drainBatch(): Promise<number> {
    const due = await this.prisma.client.orm.public.ExternalEventNotification.where((row) =>
      row.nextAttemptAt.lte(nowInstant()),
    )
      .orderBy((row) => row.nextAttemptAt.asc())
      .orderBy((row) => row.createdAt.asc())
      .limit(BATCH_SIZE)
      .all()
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      const results = await Promise.allSettled(
        due.slice(i, i + CONCURRENCY).map(async (job) => {
          try {
            const input = externalEventNotificationInput(job)
            const [prepared, setting] = await Promise.all([
              this.business.prepare(input),
              this.settings.getEffectiveSetting(input.tenantId, input.event),
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
                )
              : []
            // Delete is the transactional claim: concurrent workers cannot both win.
            // A failure or process crash before commit restores the task and all writes.
            const result = await this.prisma.client.transaction(async (tx) => {
              const claimed = await tx.orm.public.ExternalEventNotification.where({
                id: job.id,
                attempts: job.attempts,
              }).deleteAndCount()
              if (!claimed) return null
              const notifications =
                prepared && setting.systemEnabled
                  ? await tx.orm.public.Notifications.createAll(
                      prepared.userIds.map((userId) => ({
                        tenantId: input.tenantId,
                        userId,
                        _type: input.type,
                        title: prepared.title,
                        content: prepared.content ?? null,
                        link: input.link ?? null,
                        sourceType: `EXTERNAL_EVENT:${input.event}`,
                        sourceId: job.inboxId,
                      })),
                    )
                  : []
              const deliveries = deliveryRows.length
                ? await tx.orm.public.MessageDeliveries.createAll(deliveryRows)
                : []
              return { notifications, deliveries }
            })
            if (!result) return
            // Only best-effort realtime signals and the delivery kick happen after commit.
            // The durable records already exist, and scheduled delivery recovery still applies.
            const postCommit = await Promise.allSettled([
              ...result.notifications.map((row) =>
                this.notifications.publishCreated(row.tenantId, row.userId, row),
              ),
            ])
            if (postCommit.some((outcome) => outcome.status === 'rejected')) {
              this.logger.warn('外部事件通知已落库，实时刷新失败')
            }
            const ids = result.deliveries
              .filter((row) => row.status === 'PENDING')
              .map((row) => row.id)
            if (ids.length)
              void this.deliveries.processIds(ids).catch(() => {
                this.logger.warn('外部事件投递即时处理失败，等待定时恢复')
              })
          } catch {
            // Retry indefinitely with a capped delay; do not discard a committed intent.
            const delay = Math.min(300_000, 1_000 * 2 ** Math.min(job.attempts, 9))
            await this.prisma.client.orm.public.ExternalEventNotification.where({
              id: job.id,
              attempts: job.attempts,
            }).update({
              attempts: job.attempts + 1,
              nextAttemptAt: instantFromEpochMilliseconds(Date.now() + delay),
            })
            this.logger.warn(`外部事件通知任务失败 event=${job.event} attempt=${job.attempts + 1}`)
          }
        }),
      )
      if (results.some((result) => result.status === 'rejected')) {
        this.logger.warn('外部事件通知重试状态更新失败，任务仍可重新扫描')
      }
    }
    return due.length
  }
}
