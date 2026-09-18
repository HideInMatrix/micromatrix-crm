import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { MessageTaskEvent } from '@micromatrix/shared'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
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
    private readonly prisma8: Prisma8Service,
    private readonly settings: MessageSettingsService,
    private readonly notifications: BusinessNotificationsService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  @Cron('0 0 8 * * *')
  async scheduledRunDaily(): Promise<void> {
    const now = new Date()
    if (!this.coordinator) return void (await this.run(now))
    await this.coordinator.runScheduledOnce('message-expiry', 'DAILY', () => this.run(now))
  }

  async runDaily(): Promise<void> {
    await this.run(new Date())
  }

  async run(now: Date): Promise<number> {
    const tenants = await this.prisma8.client.orm.public.Tenants.select('id').all()
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
    const startMs = BigInt(start.getTime())
    const endMs = BigInt(end.getTime())
    const client = this.prisma8.client
    if (event.startsWith('BUSINESS_QUOTATION_')) {
      const query = client.raw.sql`SELECT
          quotation.id,
          quotation.name,
          quotation.create_user AS "createUser",
          quotation.until_time AS "untilTime",
          customer.name AS "customerName"
        FROM opportunity_quotation AS quotation
        JOIN opportunity AS opportunity ON opportunity.id = quotation.opportunity_id
        LEFT JOIN customer AS customer ON customer.id = opportunity.customer_id
        WHERE quotation.organization_id = ${tenantId}
          AND quotation.invalid = false
          AND quotation.until_time >= ${startMs}
          AND quotation.until_time < ${endMs}`.returnsRow({
        id: client.sql.public.opportunity_quotation.columns.id,
        name: client.sql.public.opportunity_quotation.columns.name,
        createUser: client.sql.public.opportunity_quotation.columns.create_user,
        untilTime: client.sql.public.opportunity_quotation.columns.until_time,
        customerName: client.sql.public.customer.columns.name,
      })
      const quotes: Array<{
        id: string
        name: string
        createUser: string
        untilTime: bigint
        customerName: string | null
      }> = []
      for await (const row of client.runtime().query(query.build())) quotes.push(row)
      return this.sendRows(
        tenantId,
        event,
        days,
        quotes.map((quote) => ({
          name: quote.name,
          customerName: quote.customerName ?? quote.name,
          ownerId: quote.createUser,
          createUserId: quote.createUser,
          dueDate: new Date(Number(quote.untilTime)),
          link: '/quotes',
          label: '报价',
        })),
      )
    }
    if (event.startsWith('CONTRACT_PAYMENT_')) {
      const query = client.raw.sql`SELECT
          plan.id,
          plan.name,
          plan.owner,
          plan.create_user AS "createUser",
          plan.plan_end_time AS "planEndTime",
          contract.name AS "contractName",
          customer.name AS "customerName"
        FROM contract_payment_plan AS plan
        JOIN contract AS contract ON contract.id = plan.contract_id
        JOIN customer AS customer ON customer.id = contract.customer_id
        WHERE plan.organization_id = ${tenantId}
          AND plan.plan_status <> 'COMPLETED'
          AND plan.plan_end_time >= ${startMs}
          AND plan.plan_end_time < ${endMs}`.returnsRow({
        id: client.sql.public.contract_payment_plan.columns.id,
        name: client.sql.public.contract_payment_plan.columns.name,
        owner: client.sql.public.contract_payment_plan.columns.owner,
        createUser: client.sql.public.contract_payment_plan.columns.create_user,
        planEndTime: client.sql.public.contract_payment_plan.columns.plan_end_time,
        contractName: client.sql.public.contract.columns.name,
        customerName: client.sql.public.customer.columns.name,
      })
      const plans: Array<{
        id: string
        name: string
        owner: string
        createUser: string
        planEndTime: bigint | null
        contractName: string
        customerName: string
      }> = []
      for await (const row of client.runtime().query(query.build())) plans.push(row)
      return this.sendRows(
        tenantId,
        event,
        days,
        plans.map((plan) => ({
          name: plan.name || `${plan.contractName}回款计划`,
          customerName: plan.customerName,
          ownerId: plan.owner,
          createUserId: plan.createUser,
          dueDate: new Date(Number(plan.planEndTime!)),
          link: '/contracts',
          label: '回款计划',
        })),
      )
    }

    const query = client.raw.sql`SELECT
        contract.id,
        contract.name,
        contract.owner,
        contract.create_user AS "createUser",
        contract.end_time AS "endTime",
        customer.name AS "customerName"
      FROM contract AS contract
      JOIN customer AS customer ON customer.id = contract.customer_id
      WHERE contract.organization_id = ${tenantId}
        AND contract.end_time >= ${startMs}
        AND contract.end_time < ${endMs}
        AND NOT EXISTS (
          SELECT 1
          FROM contract_stage_config AS stage
          WHERE stage.organization_id = ${tenantId}
            AND stage.type = 'END'
            AND stage.id = contract.stage
        )`.returnsRow({
      id: client.sql.public.contract.columns.id,
      name: client.sql.public.contract.columns.name,
      owner: client.sql.public.contract.columns.owner,
      createUser: client.sql.public.contract.columns.create_user,
      endTime: client.sql.public.contract.columns.end_time,
      customerName: client.sql.public.customer.columns.name,
    })
    const contracts: Array<{
      id: string
      name: string
      owner: string
      createUser: string
      endTime: bigint | null
      customerName: string
    }> = []
    for await (const row of client.runtime().query(query.build())) contracts.push(row)
    return this.sendRows(
      tenantId,
      event,
      days,
      contracts.map((contract) => ({
        name: contract.name,
        customerName: contract.customerName,
        ownerId: contract.owner,
        createUserId: contract.createUser,
        dueDate: new Date(Number(contract.endTime!)),
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
      customerName: string
      ownerId: string | null
      createUserId?: string | null
      dueDate: Date
      link: string
      label: string
    }>,
  ): Promise<number> {
    let delivered = 0
    for (const row of rows) {
      delivered += await this.notifications.sendConfigured({
        tenantId,
        event,
        ownerId: row.ownerId,
        createUserId: row.createUserId,
        type: row.label === '回款计划' ? 'receivable' : 'system',
        templateContext: {
          customerName: row.customerName,
          name: row.customerName,
          expireDays: days,
        },
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
}
