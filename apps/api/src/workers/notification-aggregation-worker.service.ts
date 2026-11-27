import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { NotificationAggregationConsumer } from '../modules/notifications/notification-aggregation.consumer'

@Injectable()
export class NotificationAggregationWorkerService {
  private readonly logger = new Logger(NotificationAggregationWorkerService.name)
  private running = false
  constructor(private readonly consumer: NotificationAggregationConsumer) {}

  @Interval(1_000)
  async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    // Always recover persisted batches even if new aggregation is disabled.
    try {
      await this.consumer.drain()
    } catch {
      this.logger.warn('聚合通知批次扫描失败')
    } finally {
      this.running = false
    }
  }
}
