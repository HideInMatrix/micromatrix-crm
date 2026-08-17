import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { Customer, Lead } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { NotificationsService } from '../notifications/notifications.service'
import { ResourcePoolsService } from './resource-pools.service'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

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
    private readonly resourcePools: ResourcePoolsService,
    private readonly recycleEvaluator: ResourceRecycleConditionEvaluator,
  ) {}

  @Cron('0 30 2 * * *')
  async recycleAll() {
    const [rules, autoPools] = await Promise.all([
      this.prisma.poolRule.findMany({ where: { enabled: true }, select: { tenantId: true } }),
      this.prisma.resourcePool.findMany({
        where: { enabled: true, autoRecycle: true },
        select: { tenantId: true },
      }),
    ])
    const tenantIds = [...new Set([...rules, ...autoPools].map((row) => row.tenantId))]
    for (const tenantId of tenantIds) {
      await this.recycleTenant(tenantId).catch((e) =>
        this.logger.error(`租户 ${tenantId} 回收失败: ${e.message}`),
      )
    }
  }

  async recycleTenant(tenantId: string): Promise<{ recycledLeads: number; recycledCustomers: number }> {
    const [newLeadResult, newCustomerResult] = await Promise.all([
      this.recycleLeadByPoolRules(tenantId),
      this.recycleCustomerByPoolRules(tenantId),
    ])

    const legacyRules = await this.prisma.poolRule.findMany({ where: { tenantId, enabled: true } })
    let recycledLeads = newLeadResult.count
    let recycledCustomers = newCustomerResult.count

    if (!newLeadResult.configured) {
      const legacy = legacyRules.find((rule) => rule.module === 'lead')
      if (legacy) recycledLeads += await this.recycleLegacyLead(tenantId, legacy.recycleDays, legacy.notifyDays)
    }
    if (!newCustomerResult.configured) {
      const legacy = legacyRules.find((rule) => rule.module === 'customer')
      if (legacy) {
        recycledCustomers += await this.recycleLegacyCustomer(
          tenantId,
          legacy.recycleDays,
          legacy.notifyDays,
        )
      }
    }

    return { recycledLeads, recycledCustomers }
  }

  private async recycleLeadByPoolRules(tenantId: string) {
    const pools = await this.prisma.resourcePool.findMany({
      where: { tenantId, module: 'lead', enabled: true, autoRecycle: true },
      include: { recycleRule: true },
    })
    const configured = pools.some((pool) =>
      this.recycleEvaluator.hasValidConditions(pool.recycleRule?.conditions),
    )
    if (!configured) return { configured: false, count: 0 }

    const candidates = await this.prisma.lead.findMany({
      where: {
        tenantId,
        inPool: false,
        status: 'FOLLOWING',
        ownerId: { not: null },
      },
    })
    let count = 0
    for (const lead of candidates) {
      const pool = await this.resourcePools.resolveAutoRecyclePool(tenantId, 'lead', lead.ownerId)
      if (!pool?.recycleRule) continue
      if (
        !this.recycleEvaluator.matches(
          pool.recycleRule.operator,
          pool.recycleRule.conditions,
          lead,
        )
      ) {
        continue
      }
      await this.recycleLeadRecord(tenantId, lead, pool.id, '符合自动回收规则，已自动回收')
      count++
    }
    return { configured: true, count }
  }

  private async recycleCustomerByPoolRules(tenantId: string) {
    const pools = await this.prisma.resourcePool.findMany({
      where: { tenantId, module: 'customer', enabled: true, autoRecycle: true },
      include: { recycleRule: true },
    })
    const configured = pools.some((pool) =>
      this.recycleEvaluator.hasValidConditions(pool.recycleRule?.conditions),
    )
    if (!configured) return { configured: false, count: 0 }

    const candidates = await this.prisma.customer.findMany({
      where: { tenantId, inSea: false, ownerId: { not: null } },
    })
    let count = 0
    for (const customer of candidates) {
      const pool = await this.resourcePools.resolveAutoRecyclePool(
        tenantId,
        'customer',
        customer.ownerId,
      )
      if (!pool?.recycleRule) continue
      if (
        !this.recycleEvaluator.matches(
          pool.recycleRule.operator,
          pool.recycleRule.conditions,
          customer,
        )
      ) {
        continue
      }
      await this.recycleCustomerRecord(tenantId, customer, pool.id, '符合自动回收规则，已自动回收')
      count++
    }
    return { configured: true, count }
  }

  private async recycleLegacyLead(tenantId: string, recycleDays: number, notifyDays: number) {
    const { deadline, warnDeadline } = this.legacyDeadlines(recycleDays, notifyDays)
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
    let count = 0
    for (const lead of stale) {
      const pool = await this.resourcePools.resolveRecyclePool(tenantId, 'lead', lead.ownerId)
      if (!pool) continue
      await this.recycleLeadRecord(
        tenantId,
        lead,
        pool.id,
        `超过 ${recycleDays} 天未跟进，已自动回收`,
      )
      count++
    }
    await this.warnUpcoming(tenantId, 'lead', warnDeadline, deadline, recycleDays)
    return count
  }

  private async recycleLegacyCustomer(tenantId: string, recycleDays: number, notifyDays: number) {
    const { deadline, warnDeadline } = this.legacyDeadlines(recycleDays, notifyDays)
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
    let count = 0
    for (const customer of stale) {
      const pool = await this.resourcePools.resolveRecyclePool(
        tenantId,
        'customer',
        customer.ownerId,
      )
      if (!pool) continue
      await this.recycleCustomerRecord(
        tenantId,
        customer,
        pool.id,
        `超过 ${recycleDays} 天未跟进，已自动回收`,
      )
      count++
    }
    await this.warnUpcoming(tenantId, 'customer', warnDeadline, deadline, recycleDays)
    return count
  }

  private legacyDeadlines(recycleDays: number, notifyDays: number) {
    return {
      deadline: new Date(Date.now() - recycleDays * 24 * 3600 * 1000),
      warnDeadline: new Date(Date.now() - (recycleDays - notifyDays) * 24 * 3600 * 1000),
    }
  }

  private async recycleLeadRecord(
    tenantId: string,
    lead: Lead,
    poolId: string,
    reason: string,
  ) {
    if (!lead.ownerId) return
    const ownerId = lead.ownerId
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.resourceOwnerHistory.create({
        data: {
          tenantId,
          module: 'lead',
          resourceId: lead.id,
          ownerId,
          poolId,
          reasonId: 'system',
          collectedAt: lead.collectedAt,
          endedAt: now,
        },
      })
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          inPool: true,
          poolId,
          poolEnteredAt: now,
          ownerId: null,
          deptId: null,
          collectedAt: null,
        },
      })
    })
    await this.notifications.notify(tenantId, ownerId, {
      type: 'pool',
      title: '线索已被回收进线索池',
      content: `线索「${lead.name}」${reason}`,
      link: '/leads',
    })
  }

  private async recycleCustomerRecord(
    tenantId: string,
    customer: Customer,
    poolId: string,
    reason: string,
  ) {
    if (!customer.ownerId) return
    const ownerId = customer.ownerId
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.resourceOwnerHistory.create({
        data: {
          tenantId,
          module: 'customer',
          resourceId: customer.id,
          ownerId,
          poolId,
          reasonId: 'system',
          collectedAt: customer.collectedAt,
          endedAt: now,
        },
      })
      await tx.customer.update({
        where: { id: customer.id },
        data: {
          inSea: true,
          poolId,
          poolEnteredAt: now,
          ownerId: null,
          deptId: null,
          collectedAt: null,
        },
      })
    })
    await this.notifications.notify(tenantId, ownerId, {
      type: 'pool',
      title: '客户已被回收进公海',
      content: `客户「${customer.name}」${reason}`,
      link: '/customers',
    })
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
