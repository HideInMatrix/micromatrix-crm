import { Injectable, Logger } from '@nestjs/common'
import { performance } from 'node:perf_hooks'
import { PrismaService } from '../../prisma.service'
import { nowInstant } from '../../prisma/temporal'
import { MessageDeliveryService } from './message-delivery.service'
import { NotificationsService } from './notifications.service'
import {
  NotificationAggregationStore,
  type SealedOutputWriter,
} from './notification-aggregation.store'
import { projectAggregationItems } from './notification-aggregation-projection'
import { AGGREGATED_SOURCE, buildAggregationSummary } from './notification-aggregation-runtime'

@Injectable()
export class NotificationAggregationConsumer {
  private readonly logger = new Logger(NotificationAggregationConsumer.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly store: NotificationAggregationStore,
    private readonly notifications: NotificationsService,
    private readonly deliveries: MessageDeliveryService,
  ) {}

  private readonly writeOutput: SealedOutputWriter = async (tx, batch, items) => {
    const active = await projectAggregationItems(tx, batch, items)
    if (!active.length) return null
    const summary = buildAggregationSummary(batch, active)
    if (batch.channel === 'SYSTEM') {
      return (
        await tx.orm.public.Notifications.create({
          tenantId: batch.tenantId,
          userId: batch.recipientId,
          _type: summary.type,
          title: summary.title,
          content: summary.content,
          link: summary.link,
          linkLabel: summary.linkLabel,
          sourceType: AGGREGATED_SOURCE,
          sourceId: batch.id,
        })
      ).id
    }
    if (batch.channel !== 'WECOM') throw new Error('Unknown aggregation channel')
    // Provider identity and per-event gates are checked again in processOne;
    // this transaction never executes a provider request.
    return (
      await tx.orm.public.MessageDeliveries.create({
        tenantId: batch.tenantId,
        userId: batch.recipientId,
        integrationId: batch.integrationId,
        channel: 'WECOM',
        externalSubject: batch.externalSubject,
        event: summary.event,
        title: summary.title.slice(0, 500),
        content: summary.content?.slice(0, 4000) ?? null,
        link: summary.link?.slice(0, 1000) ?? null,
        updatedAt: nowInstant(),
      })
    ).id
  }

  async drain() {
    const start = performance.now()
    // Deferred and quarantined batches do not occupy the normal candidate page.
    const ids = await this.store.dueIds(50)
    const metrics = {
      scanned: ids.length,
      sealed: 0,
      system: 0,
      wecom: 0,
      items: 0,
      failed: 0,
      publishFailures: 0,
      suppressedBatches: 0,
    }
    for (let i = 0; i < ids.length; i += 4) {
      await Promise.all(
        ids.slice(i, i + 4).map(async (id) => {
          let result
          try {
            result = await this.store.seal(id, this.writeOutput)
          } catch {
            metrics.failed++
            return
          }
          if (!result) return
          metrics.sealed++
          metrics.items += result.itemCount
          if (!result.outputId) {
            metrics.suppressedBatches++
            return
          }
          try {
            if (result.channel === 'SYSTEM') {
              metrics.system++
              const row = await this.prisma.client.orm.public.Notifications.where({
                id: result.outputId,
              }).first()
              if (row) await this.notifications.publishCreated(row.tenantId, row.userId, row)
            } else {
              metrics.wecom++
              // Committed delivery survives wakeup failure via existing DB scan.
              void this.deliveries.processIds([result.outputId]).catch(() => {
                this.logger.warn('聚合投递唤醒失败，等待定时恢复')
              })
            }
          } catch {
            metrics.publishFailures++
          }
        }),
      )
    }
    if (metrics.failed)
      this.logger.warn(`通知聚合封批失败 ${metrics.failed} 批，已尝试记录持久化退避或隔离状态`)
    if (process.env.CRM_EXTERNAL_EVENT_PERF === '1' && metrics.scanned)
      this.logger.log(
        JSON.stringify({
          kind: 'notification_aggregation_perf',
          ...metrics,
          totalMs: Math.round((performance.now() - start) * 100) / 100,
        }),
      )
    return metrics
  }
}
