import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { PrismaService } from '../../prisma.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { LeadPoolSlaService } from './lead-pool-sla.service'

@Injectable()
export class LeadSlaReminderService {
  private readonly logger = new Logger(LeadSlaReminderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly sla: LeadPoolSlaService,
    private readonly notifications: BusinessNotificationsService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  @Cron('0 0 9 * * *')
  async scheduledReminder() {
    if (!this.coordinator) return void (await this.sendAll())
    await this.coordinator.runScheduledOnce('lead-sla-reminder', 'DAILY', () => this.sendAll())
  }

  async sendAll(now = new Date()): Promise<number> {
    const rows = await this.prisma.client.orm.public.CluePool.where({ enable: true })
      .select('organizationId')
      .all()
    const organizationIds = [...new Set(rows.map((row) => String(row.organizationId)))]
    let sent = 0
    for (const organizationId of organizationIds) {
      sent += await this.sendTenant(organizationId, now).catch((error: unknown) => {
        this.logger.error(
          `组织 ${organizationId} 线索 SLA 提醒失败: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
        return 0
      })
    }
    return sent
  }

  async sendTenant(organizationId: string, now = new Date()): Promise<number> {
    const overdue = await this.sla.overdue(organizationId, null, now)
    let sent = 0
    for (const item of overdue) {
      sent += await this.notifications.send({
        tenantId: organizationId,
        event: 'CLUE_FOLLOW_UP_OVERDUE',
        recipientIds: [item.ownerId],
        type: 'system',
        templateContext: { name: item.name },
        link: '/leads',
      })
    }
    return sent
  }
}
