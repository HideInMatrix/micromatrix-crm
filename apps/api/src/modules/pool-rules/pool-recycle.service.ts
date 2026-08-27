import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import type { Clue, Customer } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { loadUserScopeTokens, scopeMatches } from './pool-repository.helpers'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

/** Cordys 分域自动回收：只读取 clue_pool/customer_pool 及其直接规则。 */
@Injectable()
export class PoolRecycleService {
  private readonly logger = new Logger(PoolRecycleService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: BusinessNotificationsService,
    private readonly cluePools: CluePoolRepository,
    private readonly customerPools: CustomerPoolRepository,
    private readonly evaluator: ResourceRecycleConditionEvaluator,
  ) {}

  @Cron('0 30 2 * * *')
  async recycleAll() {
    const [clueOrganizations, customerOrganizations] = await Promise.all([
      this.prisma.cluePool.findMany({
        where: { enable: true, auto: true },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
      this.prisma.customerPool.findMany({
        where: { enable: true, auto: true },
        select: { organizationId: true },
        distinct: ['organizationId'],
      }),
    ])
    const organizationIds = [
      ...new Set([...clueOrganizations, ...customerOrganizations].map((row) => row.organizationId)),
    ]
    for (const organizationId of organizationIds) {
      await this.recycleTenant(organizationId).catch((error: unknown) =>
        this.logger.error(
          `组织 ${organizationId} 回收失败: ${error instanceof Error ? error.message : String(error)}`,
        ),
      )
    }
  }

  async recycleTenant(
    organizationId: string,
  ): Promise<{ recycledLeads: number; recycledCustomers: number }> {
    const [recycledLeads, recycledCustomers] = await Promise.all([
      this.recycleClues(organizationId),
      this.recycleCustomers(organizationId),
    ])
    return { recycledLeads, recycledCustomers }
  }

  private async recycleClues(organizationId: string): Promise<number> {
    const [pools, clues] = await Promise.all([
      this.prisma.cluePool.findMany({
        where: { organizationId, enable: true, auto: true },
        include: { recycleRule: true },
        orderBy: { createTime: 'desc' },
      }),
      this.prisma.clue.findMany({
        where: {
          organizationId,
          inSharedPool: false,
          owner: { not: null },
          transitionId: null,
        },
      }),
    ])
    let count = 0
    for (const clue of clues) {
      const pool = await this.resolvePool(organizationId, clue.owner, pools)
      if (!pool?.recycleRule) continue
      if (!this.matches(pool.recycleRule.operator, pool.recycleRule.condition, clue)) continue
      const ownerId = clue.owner!
      await this.cluePools.recycle({
        organizationId,
        clueId: clue.id,
        poolId: pool.id,
        operatorId: 'system',
      })
      await this.notifications.send({
        tenantId: organizationId,
        event: 'CLUE_AUTOMATIC_MOVE_POOL',
        recipientIds: [ownerId],
        type: 'pool',
        title: '线索已被回收进线索池',
        content: `线索「${clue.name}」符合自动回收规则，已自动回收`,
        link: '/leads',
      })
      count++
    }
    return count
  }

  private async recycleCustomers(organizationId: string): Promise<number> {
    const [pools, customers] = await Promise.all([
      this.prisma.customerPool.findMany({
        where: { organizationId, enable: true, auto: true },
        include: { recycleRule: true },
        orderBy: { createTime: 'desc' },
      }),
      this.prisma.customer.findMany({
        where: { organizationId, inSharedPool: false, owner: { not: null } },
      }),
    ])
    let count = 0
    for (const customer of customers) {
      const pool = await this.resolvePool(organizationId, customer.owner, pools)
      if (!pool?.recycleRule) continue
      if (!this.matches(pool.recycleRule.operator, pool.recycleRule.condition, customer)) continue
      const ownerId = customer.owner!
      await this.customerPools.recycle({
        organizationId,
        customerId: customer.id,
        poolId: pool.id,
        operatorId: 'system',
      })
      await this.notifications.send({
        tenantId: organizationId,
        event: 'CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS',
        recipientIds: [ownerId],
        type: 'pool',
        title: '客户已被回收进公海',
        content: `客户「${customer.name}」符合自动回收规则，已自动回收`,
        link: '/customers',
      })
      count++
    }
    return count
  }

  private matches(
    operator: string | null,
    rawCondition: string | null,
    resource: Clue | Customer,
  ): boolean {
    let conditions: unknown
    try {
      conditions = rawCondition ? JSON.parse(rawCondition) : []
    } catch {
      return false
    }
    return this.evaluator.matches(operator, conditions, {
      createdAt: new Date(Number(resource.createTime)),
      collectedAt:
        resource.collectionTime === null ? null : new Date(Number(resource.collectionTime)),
      lastFollowedAt: resource.followTime === null ? null : new Date(Number(resource.followTime)),
    })
  }

  private async resolvePool<T extends { scopeId: string }>(
    organizationId: string,
    ownerId: string | null,
    pools: T[],
  ): Promise<T | null> {
    if (!ownerId) return null
    const tokens = await this.prisma.$transaction((tx) =>
      loadUserScopeTokens(tx, organizationId, ownerId),
    )
    return pools.find((pool) => scopeMatches(pool.scopeId, tokens)) ?? null
  }
}
