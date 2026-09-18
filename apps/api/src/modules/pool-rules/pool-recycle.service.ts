import { Injectable, Logger, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Varchar } from '../../prisma/prisma8-varchar'
import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { loadUserScopeTokensPrisma8, scopeMatches } from './pool-repository.helpers'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

interface RecycleResource {
  createTime: bigint
  collectionTime: bigint | null
  followTime: bigint | null
}

/** Cordys 分域自动回收：只读取 clue_pool/customer_pool 及其直接规则。 */
@Injectable()
export class PoolRecycleService {
  private readonly logger = new Logger(PoolRecycleService.name)

  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly notifications: BusinessNotificationsService,
    private readonly cluePools: CluePoolRepository,
    private readonly customerPools: CustomerPoolRepository,
    private readonly evaluator: ResourceRecycleConditionEvaluator,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  @Cron('0 30 2 * * *')
  async scheduledRecycleAll() {
    if (!this.coordinator) return void (await this.recycleAll())
    await this.coordinator.runScheduledOnce('pool-recycle', 'DAILY', () => this.recycleAll())
  }

  async recycleAll() {
    const [clueOrganizations, customerOrganizations] = await Promise.all([
      this.prisma8.client.orm.public.CluePool.where({ enable: true, auto: true })
        .select('organizationId')
        .all(),
      this.prisma8.client.orm.public.CustomerPool.where({ enable: true, auto: true })
        .select('organizationId')
        .all(),
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
    const organization = prisma8Varchar(organizationId, 32)
    const [poolRows, clues] = await Promise.all([
      this.prisma8.client.orm.public.CluePool.where({
        organizationId: organization,
        enable: true,
        auto: true,
      })
        .orderBy((pool) => pool.createTime.desc())
        .all(),
      this.prisma8.client.orm.public.Clue.where({
        organizationId: organization,
        inSharedPool: false,
        transitionId: null,
      })
        .where((clue) => clue.owner.isNotNull())
        .all(),
    ])
    const rules = poolRows.length
      ? await this.prisma8.client.orm.public.CluePoolRecycleRule.where((rule) =>
          rule.poolId.in(poolRows.map((pool) => pool.id)),
        ).all()
      : []
    const ruleByPool = new Map(rules.map((rule) => [String(rule.poolId), rule]))
    const pools = poolRows.map((pool) => ({
      ...pool,
      recycleRule: ruleByPool.get(String(pool.id)) ?? null,
    }))
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
        templateContext: { name: clue.name },
        link: '/leads',
      })
      count++
    }
    return count
  }

  private async recycleCustomers(organizationId: string): Promise<number> {
    const organization = prisma8Varchar(organizationId, 32)
    const [poolRows, customers] = await Promise.all([
      this.prisma8.client.orm.public.CustomerPool.where({
        organizationId: organization,
        enable: true,
        auto: true,
      })
        .orderBy((pool) => pool.createTime.desc())
        .all(),
      this.prisma8.client.orm.public.Customer.where({
        organizationId: organization,
        inSharedPool: false,
      })
        .where((customer) => customer.owner.isNotNull())
        .all(),
    ])
    const rules = poolRows.length
      ? await this.prisma8.client.orm.public.CustomerPoolRecycleRule.where((rule) =>
          rule.poolId.in(poolRows.map((pool) => pool.id)),
        ).all()
      : []
    const ruleByPool = new Map(rules.map((rule) => [String(rule.poolId), rule]))
    const pools = poolRows.map((pool) => ({
      ...pool,
      recycleRule: ruleByPool.get(String(pool.id)) ?? null,
    }))
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
        templateContext: { name: customer.name },
        link: '/customers',
      })
      count++
    }
    return count
  }

  private matches(
    operator: string | null,
    rawCondition: string | null,
    resource: RecycleResource,
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
    const tokens = await this.prisma8.client.transaction((tx) =>
      loadUserScopeTokensPrisma8(tx, organizationId, ownerId),
    )
    return pools.find((pool) => scopeMatches(pool.scopeId, tokens)) ?? null
  }
}
