import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { ExternalEventNotificationOutboxService } from '../modules/notifications/external-event-notification-outbox.service'

@Injectable()
export class ExternalEventNotificationWorkerService {
  private readonly logger = new Logger(ExternalEventNotificationWorkerService.name)
  private running = false

  constructor(private readonly outbox: ExternalEventNotificationOutboxService) {}

  @Interval(1_000)
  async drain(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.outbox.drain()
    } catch {
      this.logger.warn('外部事件通知任务扫描失败')
    } finally {
      this.running = false
    }
  }
}
