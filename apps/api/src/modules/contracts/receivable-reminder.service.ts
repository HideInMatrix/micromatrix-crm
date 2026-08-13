import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

/** 回款计划到期提醒：每天上午 9 点提醒 3 天内到期且未回款完成的计划负责人 */
@Injectable()
export class ReceivableReminderService {
  private readonly logger = new Logger(ReceivableReminderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 0 9 * * *')
  async remindAll() {
    const soon = new Date(Date.now() + 3 * 24 * 3600 * 1000)
    const plans = await this.prisma.receivablePlan.findMany({
      where: { dueDate: { lte: soon, gte: new Date(Date.now() - 24 * 3600 * 1000) } },
      include: {
        records: { select: { amount: true } },
        contract: { select: { name: true, ownerId: true, tenantId: true } },
      },
    })

    for (const plan of plans) {
      const paid = plan.records.reduce((sum, r) => sum + Number(r.amount), 0)
      if (paid >= Number(plan.amount)) continue
      const ownerId = plan.contract.ownerId
      if (!ownerId) continue
      await this.notifications
        .notify(plan.contract.tenantId, ownerId, {
          type: 'receivable',
          title: '回款计划即将到期',
          content: `合同「${plan.contract.name}」第 ${plan.period} 期回款（¥${Number(plan.amount)}）将于 ${plan.dueDate.toISOString().slice(0, 10)} 到期，已回 ¥${paid}`,
          link: '/contracts',
        })
        .catch((e) => this.logger.warn(`回款提醒失败: ${e.message}`))
    }
  }
}
