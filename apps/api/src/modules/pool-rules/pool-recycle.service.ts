import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'

/**
 * 公海/线索池自动回收：
 * 超过 recycleDays 未跟进 → 回收进池并通知原负责人；
 * 距回收还剩 notifyDays 内 → 提前提醒负责人。
 */
@Injectable()
export class PoolRecycleService {
  private readonly logger = new Logger(PoolRecycleService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron('0 30 2 * * *')
  async recycleAll() {
    const rules = await this.prisma.poolRule.findMany({ where: { enabled: true } })
    const tenantIds = [...new Set(rules.map((r) => r.tenantId))]
    for (const tenantId of tenantIds) {
      await this.recycleTenant(tenantId).catch((e) =>
        this.logger.error(`租户 ${tenantId} 回收失败: ${e.message}`),
      )
    }
  }

  async recycleTenant(tenantId: string): Promise<{ recycledLeads: number; recycledCustomers: number }> {
    const rules = await this.prisma.poolRule.findMany({ where: { tenantId, enabled: true } })
    let recycledLeads = 0
    let recycledCustomers = 0

    for (const rule of rules) {
      const deadline = new Date(Date.now() - rule.recycleDays * 24 * 3600 * 1000)
      const warnDeadline = new Date(
        Date.now() - (rule.recycleDays - rule.notifyDays) * 24 * 3600 * 1000,
      )

      if (rule.module === 'lead') {
        const stale = await this.prisma.lead.findMany({
          where: {
            tenantId,
            inPool: false,
            status: 'FOLLOWING',
            ownerId: { not: null },
            OR: [
              { lastFollowedAt: { lt: deadline } },
              { lastFollowedAt: null, createdAt: { lt: deadline } },
            ],
          },
        })
        for (const lead of stale) {
          await this.prisma.lead.update({
            where: { id: lead.id },
            data: { inPool: true, ownerId: null, deptId: null },
          })
          await this.notifications.notify(tenantId, lead.ownerId!, {
            type: 'pool',
            title: '线索已被回收进线索池',
            content: `线索「${lead.name}」超过 ${rule.recycleDays} 天未跟进，已自动回收`,
            link: '/leads',
          })
          recycledLeads++
        }
        await this.warnUpcoming(tenantId, 'lead', warnDeadline, deadline, rule.recycleDays)
      }

      if (rule.module === 'customer') {
        const stale = await this.prisma.customer.findMany({
          where: {
            tenantId,
            inSea: false,
            ownerId: { not: null },
            OR: [
              { lastFollowedAt: { lt: deadline } },
              { lastFollowedAt: null, createdAt: { lt: deadline } },
            ],
          },
        })
        for (const customer of stale) {
          await this.prisma.customer.update({
            where: { id: customer.id },
            data: { inSea: true, ownerId: null, deptId: null },
          })
          await this.notifications.notify(tenantId, customer.ownerId!, {
            type: 'pool',
            title: '客户已被回收进公海',
            content: `客户「${customer.name}」超过 ${rule.recycleDays} 天未跟进，已自动回收`,
            link: '/customers',
          })
          recycledCustomers++
        }
        await this.warnUpcoming(tenantId, 'customer', warnDeadline, deadline, rule.recycleDays)
      }
    }
    return { recycledLeads, recycledCustomers }
  }

  /** 即将被回收的提前提醒 */
  private async warnUpcoming(
    tenantId: string,
    module: 'lead' | 'customer',
    warnDeadline: Date,
    deadline: Date,
    recycleDays: number,
  ) {
    if (module === 'lead') {
      const upcoming = await this.prisma.lead.findMany({
        where: {
          tenantId,
          inPool: false,
          status: 'FOLLOWING',
          ownerId: { not: null },
          OR: [
            { lastFollowedAt: { lt: warnDeadline, gte: deadline } },
            { lastFollowedAt: null, createdAt: { lt: warnDeadline, gte: deadline } },
          ],
        },
      })
      for (const lead of upcoming) {
        await this.notifications.notify(tenantId, lead.ownerId!, {
          type: 'pool',
          title: '线索即将被回收',
          content: `线索「${lead.name}」临近 ${recycleDays} 天未跟进回收线，请尽快跟进`,
          link: '/leads',
        })
      }
    } else {
      const upcoming = await this.prisma.customer.findMany({
        where: {
          tenantId,
          inSea: false,
          ownerId: { not: null },
          OR: [
            { lastFollowedAt: { lt: warnDeadline, gte: deadline } },
            { lastFollowedAt: null, createdAt: { lt: warnDeadline, gte: deadline } },
          ],
        },
      })
      for (const customer of upcoming) {
        await this.notifications.notify(tenantId, customer.ownerId!, {
          type: 'pool',
          title: '客户即将被回收',
          content: `客户「${customer.name}」临近 ${recycleDays} 天未跟进回收线，请尽快跟进`,
          link: '/customers',
        })
      }
    }
  }
}
