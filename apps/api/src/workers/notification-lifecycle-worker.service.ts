import { Injectable, Logger } from '@nestjs/common'
import { Interval } from '@nestjs/schedule'
import { NotificationLifecycleService } from '../modules/notifications/notification-lifecycle.service'

@Injectable()
export class NotificationLifecycleWorkerService {
  private readonly logger = new Logger(NotificationLifecycleWorkerService.name)
  private running = false
  constructor(private readonly lifecycle: NotificationLifecycleService) {}
  @Interval(60_000)
  async sweep(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      await this.lifecycle.sweep()
    } catch {
      this.logger.warn('聚合通知生命周期扫描失败，下轮继续')
    } finally {
      this.running = false
    }
  }
}
