import { ConflictException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { DistributedCoordinatorService } from '../../common/services/distributed-coordinator.service'
import { PrismaService } from '../../prisma.service'

import { BusinessNotificationsService } from '../notifications/business-notifications.service'
import { CustomerFollowUpCompletionService } from '../metadata/customer-follow-up-completion.service'
import { CluePoolRepository } from './clue-pool.repository'
import { CustomerPoolRepository } from './customer-pool.repository'
import { loadUserScopeTokensPrisma, scopeMatches } from './pool-repository.helpers'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'
import {
  PoolRecycleTaskService,
  poolRecycleRuleFingerprint,
  type PoolRecycleTaskSnapshot,
} from './pool-recycle-task.service'

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
    private readonly prisma: PrismaService,
    private readonly notifications: BusinessNotificationsService,
    private readonly cluePools: CluePoolRepository,
    private readonly customerPools: CustomerPoolRepository,
    private readonly evaluator: ResourceRecycleConditionEvaluator,
    private readonly recycleTasks: PoolRecycleTaskService,
    private readonly customerFollowUpCompletion: CustomerFollowUpCompletionService,
    @Optional() private readonly coordinator?: DistributedCoordinatorService,
  ) {}

  @Cron('0 30 2 * * *')
  async scheduledRecycleAll() {
    if (!this.coordinator) return void (await this.recycleAll())
    await this.coordinator.runScheduledOnce('pool-recycle', 'DAILY', () => this.recycleAll())
  }

  async processScheduledTask(task: PoolRecycleTaskSnapshot): Promise<void> {
    if (task.resourceType === 'lead') {
      await this.processScheduledLead(task)
      return
    }
    if (task.resourceType === 'customer') {
      await this.processScheduledCustomer(task)
      return
    }
    await this.recycleTasks.cancelResource(
      task.organizationId,
      task.resourceType as 'lead',
      task.resourceId,
    )
  }

  private async processScheduledLead(task: PoolRecycleTaskSnapshot): Promise<void> {
    const clue = await this.prisma.client.orm.public.Clue.where({
      id: task.resourceId,
      organizationId: task.organizationId,
      inSharedPool: false,
    })
      .where((row) => row.owner.isNotNull())
      .first()
    if (!clue || !clue.owner || clue.transitionId) {
      await this.recycleTasks.cancelResource(task.organizationId, 'lead', task.resourceId)
      return
    }
    const pools = await this.prisma.client.orm.public.CluePool.where({
      organizationId: task.organizationId,
      enable: true,
      auto: true,
    })
      .orderBy((pool) => pool.createTime.desc())
      .all()
    const rules = pools.length
      ? await this.prisma.client.orm.public.CluePoolRecycleRule.where((rule) =>
          rule.poolId.in(pools.map((pool) => pool.id)),
        ).all()
      : []
    const ruleByPool = new Map(rules.map((rule) => [String(rule.poolId), rule]))
    const pool = await this.resolvePool(task.organizationId, clue.owner, pools)
    const rule = pool ? (ruleByPool.get(String(pool.id)) ?? null) : null
    if (!pool || !rule) {
      await this.recycleTasks.cancelResource(task.organizationId, 'lead', task.resourceId)
      return
    }
    const fingerprint = poolRecycleRuleFingerprint(pool.id, rule.operator, rule.condition)
    if (
      task.poolId !== pool.id ||
      task.ruleFingerprint !== fingerprint ||
      task.expectedOwnerId !== clue.owner ||
      task.expectedCreateTime !== clue.createTime ||
      task.expectedCollectionTime !== clue.collectionTime ||
      task.expectedFollowTime !== clue.followTime
    ) {
      await this.recycleTasks.refreshResource(task.organizationId, 'lead', task.resourceId)
      return
    }
    if (!this.matches(rule.operator, rule.condition, clue)) {
      await this.recycleTasks.refreshResource(task.organizationId, 'lead', task.resourceId)
      return
    }

    const ownerId = clue.owner
    try {
      await this.cluePools.recycle({
        organizationId: task.organizationId,
        clueId: clue.id,
        poolId: pool.id,
        operatorId: 'system',
        expectedOwnerId: ownerId,
        expectedCreateTime: clue.createTime,
        expectedCollectionTime: clue.collectionTime ?? undefined,
        expectedFollowTime: clue.followTime,
        expectedTaskGeneration: task.generation,
      })
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        await this.recycleTasks.refreshResource(task.organizationId, 'lead', task.resourceId)
        return
      }
      throw error
    }
    await this.notifications.send({
      tenantId: task.organizationId,
      event: 'CLUE_AUTOMATIC_MOVE_POOL',
      recipientIds: [ownerId],
      type: 'pool',
      templateContext: { name: clue.name },
      link: '/leads',
    })
  }

  private async processScheduledCustomer(task: PoolRecycleTaskSnapshot): Promise<void> {
    const customer = await this.prisma.client.orm.public.Customer.where({
      id: task.resourceId,
      organizationId: task.organizationId,
      inSharedPool: false,
    })
      .where((row) => row.owner.isNotNull())
      .first()
    if (!customer || !customer.owner) {
      await this.recycleTasks.cancelResource(task.organizationId, 'customer', task.resourceId)
      return
    }
    const completion = await this.customerFollowUpCompletion.evaluate(task.organizationId, [
      customer.id,
    ])
    if (completion.rule.enabled && !completion.rule.valid) {
      this.logger.error(
        `组织 ${task.organizationId} 的客户跟进完结规则引用了失效字段，已暂停该客户自动回收`,
      )
      await this.recycleTasks.cancelResource(task.organizationId, 'customer', task.resourceId)
      return
    }
    if (completion.completedIds.has(String(customer.id))) {
      await this.recycleTasks.cancelResource(task.organizationId, 'customer', task.resourceId)
      return
    }

    const pools = await this.prisma.client.orm.public.CustomerPool.where({
      organizationId: task.organizationId,
      enable: true,
      auto: true,
    })
      .orderBy((pool) => pool.createTime.desc())
      .all()
    const rules = pools.length
      ? await this.prisma.client.orm.public.CustomerPoolRecycleRule.where((rule) =>
          rule.poolId.in(pools.map((pool) => pool.id)),
        ).all()
      : []
    const ruleByPool = new Map(rules.map((rule) => [String(rule.poolId), rule]))
    const pool = await this.resolvePool(task.organizationId, customer.owner, pools)
    const rule = pool ? (ruleByPool.get(String(pool.id)) ?? null) : null
    if (!pool || !rule) {
      await this.recycleTasks.cancelResource(task.organizationId, 'customer', task.resourceId)
      return
    }
    const fingerprint = poolRecycleRuleFingerprint(pool.id, rule.operator, rule.condition)
    if (
      task.poolId !== pool.id ||
      task.ruleFingerprint !== fingerprint ||
      task.expectedOwnerId !== customer.owner ||
      task.expectedCreateTime !== customer.createTime ||
      task.expectedCollectionTime !== customer.collectionTime ||
      task.expectedFollowTime !== customer.followTime
    ) {
      await this.recycleTasks.refreshResource(task.organizationId, 'customer', task.resourceId)
      return
    }
    if (!this.matches(rule.operator, rule.condition, customer)) {
      await this.recycleTasks.refreshResource(task.organizationId, 'customer', task.resourceId)
      return
    }

    const ownerId = customer.owner
    try {
      await this.customerPools.recycle({
        organizationId: task.organizationId,
        customerId: customer.id,
        poolId: pool.id,
        operatorId: 'system',
        expectedOwnerId: ownerId,
        expectedCreateTime: customer.createTime,
        expectedCollectionTime: customer.collectionTime ?? undefined,
        expectedFollowTime: customer.followTime,
        expectedTaskGeneration: task.generation,
      })
    } catch (error) {
      if (error instanceof ConflictException || error instanceof NotFoundException) {
        await this.recycleTasks.refreshResource(task.organizationId, 'customer', task.resourceId)
        return
      }
      throw error
    }
    await this.notifications.send({
      tenantId: task.organizationId,
      event: 'CUSTOMER_AUTOMATIC_MOVE_HIGH_SEAS',
      recipientIds: [ownerId],
      type: 'pool',
      templateContext: { name: customer.name },
      link: '/customers',
    })
  }

  async recycleAll() {
    const [clueOrganizations, customerOrganizations] = await Promise.all([
      this.prisma.client.orm.public.CluePool.where({ enable: true, auto: true })
        .select('organizationId')
        .all(),
      this.prisma.client.orm.public.CustomerPool.where({ enable: true, auto: true })
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
    const organization = organizationId
    const [poolRows, clues] = await Promise.all([
      this.prisma.client.orm.public.CluePool.where({
        organizationId: organization,
        enable: true,
        auto: true,
      })
        .orderBy((pool) => pool.createTime.desc())
        .all(),
      this.prisma.client.orm.public.Clue.where({
        organizationId: organization,
        inSharedPool: false,
        transitionId: null,
      })
        .where((clue) => clue.owner.isNotNull())
        .all(),
    ])
    const rules = poolRows.length
      ? await this.prisma.client.orm.public.CluePoolRecycleRule.where((rule) =>
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
      try {
        await this.cluePools.recycle({
          organizationId,
          clueId: clue.id,
          poolId: pool.id,
          operatorId: 'system',
          expectedOwnerId: ownerId,
          expectedCreateTime: clue.createTime,
          expectedCollectionTime: clue.collectionTime ?? undefined,
          expectedFollowTime: clue.followTime,
        })
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) continue
        throw error
      }
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
    const organization = organizationId
    const [poolRows, customers] = await Promise.all([
      this.prisma.client.orm.public.CustomerPool.where({
        organizationId: organization,
        enable: true,
        auto: true,
      })
        .orderBy((pool) => pool.createTime.desc())
        .all(),
      this.prisma.client.orm.public.Customer.where({
        organizationId: organization,
        inSharedPool: false,
      })
        .where((customer) => customer.owner.isNotNull())
        .all(),
    ])
    const completion = await this.customerFollowUpCompletion.evaluate(
      organization,
      customers.map((customer) => String(customer.id)),
    )
    if (completion.rule.enabled && !completion.rule.valid) {
      this.logger.error(
        `组织 ${organization} 的客户跟进完结规则引用了失效字段，已暂停该组织客户自动回收`,
      )
      return 0
    }
    const rules = poolRows.length
      ? await this.prisma.client.orm.public.CustomerPoolRecycleRule.where((rule) =>
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
      if (completion.completedIds.has(String(customer.id))) continue
      const pool = await this.resolvePool(organizationId, customer.owner, pools)
      if (!pool?.recycleRule) continue
      if (!this.matches(pool.recycleRule.operator, pool.recycleRule.condition, customer)) continue
      const ownerId = customer.owner!
      try {
        await this.customerPools.recycle({
          organizationId,
          customerId: customer.id,
          poolId: pool.id,
          operatorId: 'system',
          expectedOwnerId: ownerId,
          expectedCreateTime: customer.createTime,
          expectedCollectionTime: customer.collectionTime ?? undefined,
          expectedFollowTime: customer.followTime,
        })
      } catch (error) {
        if (error instanceof ConflictException || error instanceof NotFoundException) continue
        throw error
      }
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
    const tokens = await this.prisma.client.transaction((tx) =>
      loadUserScopeTokensPrisma(tx, organizationId, ownerId),
    )
    return pools.find((pool) => scopeMatches(pool.scopeId, tokens)) ?? null
  }
}
