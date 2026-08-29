import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { MessageTaskEvent } from '@micromatrix/shared'
import { PrismaService } from '../../prisma/prisma.service'
import { MessageSettingsService } from '../message-settings/message-settings.service'
import { BusinessNotificationsService } from './business-notifications.service'

type ExpiryEvent =
  | 'BUSINESS_QUOTATION_EXPIRING'
  | 'BUSINESS_QUOTATION_EXPIRED'
  | 'CONTRACT_EXPIRING'
  | 'CONTRACT_EXPIRED'
  | 'CONTRACT_PAYMENT_EXPIRING'
  | 'CONTRACT_PAYMENT_EXPIRED'

@Injectable()
export class MessageExpiryService {
  private readonly logger = new Logger(MessageExpiryService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: MessageSettingsService,
    private readonly notifications: BusinessNotificationsService,
  ) {}

  @Cron('0 0 8 * * *')
  async runDaily(): Promise<void> {
    await this.run(new Date())
  }

  async run(now: Date): Promise<number> {
    const tenants = await this.prisma.tenant.findMany({ select: { id: true } })
    let delivered = 0
    for (const tenant of tenants) {
      try {
        delivered += await this.runTenant(tenant.id, now)
      } catch (error) {
        this.logger.error(
          `租户 ${tenant.id} 到期消息处理失败: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    return delivered
  }

  async runTenant(tenantId: string, now: Date): Promise<number> {
    let delivered = 0
    delivered += await this.processExpiring(tenantId, 'BUSINESS_QUOTATION_EXPIRING', now)
    delivered += await this.processExact(tenantId, 'BUSINESS_QUOTATION_EXPIRED', now)
    delivered += await this.processExpiring(tenantId, 'CONTRACT_EXPIRING', now)
    delivered += await this.processExact(tenantId, 'CONTRACT_EXPIRED', now)
    delivered += await this.processExpiring(tenantId, 'CONTRACT_PAYMENT_EXPIRING', now)
    delivered += await this.processExact(tenantId, 'CONTRACT_PAYMENT_EXPIRED', now)
    return delivered
  }

  private async processExpiring(
    tenantId: string,
    event: Extract<ExpiryEvent, `${string}_EXPIRING`>,
    now: Date,
  ): Promise<number> {
    const setting = await this.settings.getEffectiveSetting(tenantId, event)
    if (!setting.systemEnabled || !setting.config?.timeList.length) return 0
    let delivered = 0
    for (const time of setting.config.timeList) {
      if (time.timeUnit !== 'DAY') continue
      delivered += await this.processWindow(tenantId, event, now, time.timeValue)
    }
    return delivered
  }

  private async processExact(
    tenantId: string,
    event: Extract<ExpiryEvent, `${string}_EXPIRED`>,
    now: Date,
  ): Promise<number> {
    const setting = await this.settings.getEffectiveSetting(tenantId, event)
    if (!setting.systemEnabled) return 0
    return this.processWindow(tenantId, event, now, 0)
  }

  private async processWindow(
    tenantId: string,
    event: ExpiryEvent,
    now: Date,
    days: number,
  ): Promise<number> {
    const { start, end } = this.dayWindow(now, days)
    if (event.startsWith('BUSINESS_QUOTATION_')) {
      const quotes = await this.prisma.opportunityQuotation.findMany({
        where: {
          organizationId: tenantId,
          invalid: false,
          untilTime: { gte: BigInt(start.getTime()), lt: BigInt(end.getTime()) },
        },
        select: { id: true, name: true, createUser: true, untilTime: true },
      })
      return this.sendRows(
        tenantId,
        event,
        days,
        quotes.map((quote) => ({
          name: quote.name,
          ownerId: quote.createUser,
          dueDate: new Date(Number(quote.untilTime)),
          link: '/quotes',
          label: '报价',
        })),
      )
    }
    if (event.startsWith('CONTRACT_PAYMENT_')) {
      const plans = await this.prisma.receivablePlan.findMany({
        where: { tenantId, dueDate: { gte: start, lt: end } },
        include: {
          records: { select: { amount: true, approvalStatus: true } },
          contract: { select: { name: true, ownerId: true } },
        },
      })
      const outstanding = plans.filter((plan) => {
        const paid = plan.records
          .filter(
            (record) => record.approvalStatus === 'NONE' || record.approvalStatus === 'APPROVED',
          )
          .reduce((sum, record) => sum + Number(record.amount), 0)
        return paid < Number(plan.amount)
      })
      return this.sendRows(
        tenantId,
        event,
        days,
        outstanding.map((plan) => ({
          name: `${plan.contract.name}第 ${plan.period} 期回款`,
          ownerId: plan.contract.ownerId,
          dueDate: plan.dueDate,
          link: '/contracts',
          label: '回款计划',
        })),
      )
    }

    const contracts = await this.prisma.contract.findMany({
      where: {
        tenantId,
        status: 'EXECUTING',
        endAt: { gte: start, lt: end },
      },
      select: { id: true, name: true, ownerId: true, endAt: true },
    })
    return this.sendRows(
      tenantId,
      event,
      days,
      contracts.map((contract) => ({
        name: contract.name,
        ownerId: contract.ownerId,
        dueDate: contract.endAt!,
        link: '/contracts',
        label: '合同',
      })),
    )
  }

  private async sendRows(
    tenantId: string,
    event: MessageTaskEvent,
    days: number,
    rows: Array<{
      name: string
      ownerId: string | null
      dueDate: Date
      link: string
      label: string
    }>,
  ): Promise<number> {
    let delivered = 0
    const expiring = event.endsWith('_EXPIRING')
    for (const row of rows) {
      delivered += await this.notifications.sendConfigured({
        tenantId,
        event,
        ownerId: row.ownerId,
        type: row.label === '回款计划' ? 'receivable' : 'system',
        title: `${row.label}${expiring ? '即将到期' : '已到期'}`,
        content: `${row.label}「${row.name}」将于 ${this.dateLabel(row.dueDate)}${
          expiring ? `（${days} 天后）` : ''
        }到期`,
        link: row.link,
      })
    }
    return delivered
  }

  private dayWindow(now: Date, days: number): { start: Date; end: Date } {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() + days)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return { start, end }
  }

  private dateLabel(value: Date): string {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
}
