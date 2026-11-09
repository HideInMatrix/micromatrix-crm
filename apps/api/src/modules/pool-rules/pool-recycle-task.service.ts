import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { or } from '@prisma/orm-postgres/orm-client'
import { AsyncJobsService } from '../../async-jobs/async-jobs.service'
import { createLegacyId32 } from '../../common/legacy-id'
import type { PrismaClient } from '../../prisma/db.js'
import { PrismaService } from '../../prisma.service.js'
import { loadUserScopeTokensPrisma, scopeMatches } from './pool-repository.helpers'
import { acquirePoolTransactionLocksPrisma } from './pool-transaction-lock'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

type PrismaTransaction = Parameters<Parameters<PrismaClient['transaction']>[0]>[0]
type ResourceType = 'lead' | 'customer'
const MAX_DISPATCH_ATTEMPTS = 10

interface ResourceSnapshot {
  id: string
  owner: string | null
  createTime: bigint
  collectionTime: bigint | null
  followTime: bigint | null
  inSharedPool: boolean
  transitionId?: string | null
}

interface PoolSnapshot {
  id: string
  scopeId: string
  enable: boolean
  auto: boolean
}

interface RecycleRuleSnapshot {
  poolId: string
  operator: string | null
  condition: string | null
}

export interface PoolRecycleTaskSnapshot {
  id: string
  organizationId: string
  resourceType: string
  resourceId: string
  poolId: string
  dueAt: bigint
  generation: number
  status: string
  expectedOwnerId: string | null
  expectedCreateTime: bigint
  expectedCollectionTime: bigint | null
  expectedFollowTime: bigint | null
  ruleFingerprint: string
  attempts: number
  lockedUntil: bigint | null
  lastError: string | null
  createTime: bigint
  updateTime: bigint
}

export function poolRecycleRuleFingerprint(
  poolId: string,
  operator: string | null,
  condition: string | null,
): string {
  return createHash('sha256').update(JSON.stringify({ poolId, operator, condition })).digest('hex')
}

@Injectable()
export class PoolRecycleTaskService {
  private readonly logger = new Logger(PoolRecycleTaskService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: ResourceRecycleConditionEvaluator,
    private readonly jobs: AsyncJobsService,
  ) {}

  refreshLeadInTransaction(tx: PrismaTransaction, organizationId: string, resourceId: string) {
    return this.refreshOneInTransaction(tx, organizationId, 'lead', resourceId)
  }

  refreshCustomerInTransaction(tx: PrismaTransaction, organizationId: string, resourceId: string) {
    return this.refreshOneInTransaction(tx, organizationId, 'customer', resourceId)
  }

  async completeInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
    resourceId: string,
    expectedGeneration?: number,
  ): Promise<void> {
    await acquirePoolTransactionLocksPrisma(this.prisma.client, tx, [
      `pool-recycle:${organizationId}:${resourceType}:${resourceId}`,
    ])
    const query = tx.orm.public.PoolRecycleTask.where({
      organizationId,
      resourceType,
      resourceId,
      ...(expectedGeneration === undefined ? {} : { generation: expectedGeneration }),
      ...(expectedGeneration === undefined ? {} : { status: 'PROCESSING' }),
    })
    if (expectedGeneration !== undefined) {
      const updated = await query.updateAndCount({
        status: 'COMPLETED',
        lockedUntil: null,
        lastError: null,
        updateTime: BigInt(Date.now()),
      })
      if (updated !== 1) throw new ConflictException('自动回收计划已更新，本次回收任务已失效')
      return
    }
    await query.update({
      status: 'COMPLETED',
      lockedUntil: null,
      lastError: null,
      updateTime: BigInt(Date.now()),
    })
  }

  cancelInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
    resourceId: string,
  ) {
    return this.cancelTaskInTransaction(tx, organizationId, resourceType, resourceId)
  }

  async refreshResource(organizationId: string, resourceType: ResourceType, resourceId: string) {
    await this.prisma.client.transaction((tx) =>
      this.refreshOneInTransaction(tx, organizationId, resourceType, resourceId),
    )
  }

  async cancelResource(organizationId: string, resourceType: ResourceType, resourceId: string) {
    await this.prisma.client.transaction((tx) =>
      this.cancelTaskInTransaction(tx, organizationId, resourceType, resourceId),
    )
  }

  async refreshOrganizationInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
  ): Promise<void> {
    const [pools, resources] = await Promise.all([
      this.loadPools(tx, organizationId, resourceType),
      resourceType === 'lead'
        ? tx.orm.public.Clue.where({ organizationId, inSharedPool: false })
            .where((row) => row.owner.isNotNull())
            .where((row) => or(row.transitionId.isNull(), row.transitionId.eq('')))
            .all()
        : tx.orm.public.Customer.where({ organizationId, inSharedPool: false })
            .where((row) => row.owner.isNotNull())
            .all(),
    ])
    const poolIds = pools.map((pool) => pool.id)
    const rules = await this.loadRules(tx, resourceType, poolIds)
    const ruleByPool = new Map(rules.map((rule) => [rule.poolId, rule]))
    const tokensByOwner = new Map<string, Set<string>>()

    for (const resource of resources) {
      if (!resource.owner) continue
      if (!tokensByOwner.has(resource.owner)) {
        tokensByOwner.set(
          resource.owner,
          await loadUserScopeTokensPrisma(tx, organizationId, resource.owner),
        )
      }
      const tokens = tokensByOwner.get(resource.owner) ?? new Set<string>()
      const pool = pools.find((candidate) => scopeMatches(candidate.scopeId, tokens))
      const rule = pool ? ruleByPool.get(pool.id) : null
      await this.upsertForSnapshotInTransaction(
        tx,
        organizationId,
        resourceType,
        resource as ResourceSnapshot,
        pool && rule ? { pool, rule } : null,
      )
    }
  }

  /** 首次启用延迟回收时，为迁移前已存在的在管资源补建计划；已有计划不会被重置。 */
  async backfillMissingPlans(): Promise<{ leads: number; customers: number }> {
    const [leadPools, customerPools] = await Promise.all([
      this.prisma.client.orm.public.CluePool.where({ enable: true, auto: true })
        .select('organizationId')
        .all(),
      this.prisma.client.orm.public.CustomerPool.where({ enable: true, auto: true })
        .select('organizationId')
        .all(),
    ])
    const leadOrganizations = [...new Set(leadPools.map((row) => row.organizationId))]
    const customerOrganizations = [...new Set(customerPools.map((row) => row.organizationId))]
    let leads = 0
    let customers = 0
    for (const organizationId of leadOrganizations) {
      leads += await this.prisma.client.transaction((tx) =>
        this.backfillOrganizationInTransaction(tx, organizationId, 'lead'),
      )
    }
    for (const organizationId of customerOrganizations) {
      customers += await this.prisma.client.transaction((tx) =>
        this.backfillOrganizationInTransaction(tx, organizationId, 'customer'),
      )
    }
    return { leads, customers }
  }

  async dispatchPending(limit = 100): Promise<{ dispatched: number; failed: number }> {
    if (!this.jobs.enabled) return { dispatched: 0, failed: 0 }
    const now = BigInt(Date.now())
    const pending = await this.prisma.client.orm.public.PoolRecycleTask.where({ status: 'PENDING' })
      .where((row) => or(row.lockedUntil.isNull(), row.lockedUntil.lte(now)))
      .orderBy((row) => row.dueAt.asc())
      .limit(limit)
      .all()
    let dispatched = 0
    let failed = 0

    for (const task of pending) {
      const lockedUntil = now + 30_000n
      const claimed = await this.prisma.client.orm.public.PoolRecycleTask.where({
        id: task.id,
        generation: task.generation,
        status: 'PENDING',
      })
        .where((row) => or(row.lockedUntil.isNull(), row.lockedUntil.lte(now)))
        .updateAndCount({ lockedUntil, updateTime: now })
      if (claimed !== 1) continue

      try {
        await this.jobs.enqueuePoolRecycle(task.id, task.generation, task.dueAt)
        await this.prisma.client.orm.public.PoolRecycleTask.where({
          id: task.id,
          generation: task.generation,
          status: 'PENDING',
        }).update({
          status: 'QUEUED',
          lockedUntil: null,
          lastError: null,
          updateTime: BigInt(Date.now()),
        })
        dispatched++
      } catch (error) {
        const attempts = task.attempts + 1
        const retryDelay = Math.min(60_000, 1_000 * 2 ** Math.min(attempts, 6))
        await this.prisma.client.orm.public.PoolRecycleTask.where({
          id: task.id,
          generation: task.generation,
          status: 'PENDING',
        }).update({
          status: attempts >= MAX_DISPATCH_ATTEMPTS ? 'FAILED' : 'PENDING',
          attempts,
          lockedUntil: attempts >= MAX_DISPATCH_ATTEMPTS ? null : BigInt(Date.now() + retryDelay),
          lastError: this.message(error).slice(0, 2_000),
          updateTime: BigInt(Date.now()),
        })
        failed++
        this.logger.warn(
          `自动回收任务投递失败 task=${task.id} generation=${task.generation}: ${this.message(error)}`,
        )
      }
    }
    return { dispatched, failed }
  }

  async recoverOutstanding(): Promise<{ recovered: number; kept: number; failed: number }> {
    if (!this.jobs.enabled) return { recovered: 0, kept: 0, failed: 0 }
    const now = BigInt(Date.now())
    const tasks = await this.prisma.client.orm.public.PoolRecycleTask.where((row) =>
      or(row.status.eq('PENDING'), row.status.eq('QUEUED'), row.status.eq('PROCESSING')),
    )
      .orderBy((row) => row.dueAt.asc())
      .limit(5_000)
      .all()
    let recovered = 0
    let kept = 0
    let failed = 0

    for (const task of tasks) {
      try {
        if (task.status === 'PROCESSING' && task.lockedUntil !== null && task.lockedUntil > now) {
          kept++
          continue
        }
        const state = await this.jobs.getPoolRecycleJobState(task.id, task.generation)
        if (
          state &&
          ['waiting', 'delayed', 'active', 'prioritized', 'waiting-children'].includes(state)
        ) {
          if (task.status !== 'QUEUED') {
            await this.prisma.client.orm.public.PoolRecycleTask.where({
              id: task.id,
              generation: task.generation,
            }).update({ status: 'QUEUED', lockedUntil: null, updateTime: now })
          }
          kept++
          continue
        }
        await this.prisma.client.orm.public.PoolRecycleTask.where({
          id: task.id,
          generation: task.generation,
        }).update({ status: 'PENDING', lockedUntil: null, updateTime: now })
        recovered++
      } catch (error) {
        failed++
        this.logger.warn(`自动回收任务恢复检查失败 task=${task.id}: ${this.message(error)}`)
      }
    }
    const dispatched = await this.dispatchPending()
    return {
      recovered: recovered + dispatched.dispatched,
      kept,
      failed: failed + dispatched.failed,
    }
  }

  async beginTask(taskId: string, generation: number): Promise<PoolRecycleTaskSnapshot | null> {
    const now = BigInt(Date.now())
    const task = await this.prisma.client.orm.public.PoolRecycleTask.where({
      id: taskId,
      generation,
    })
      .where((row) => or(row.status.eq('QUEUED'), row.status.eq('PROCESSING')))
      .where((row) => or(row.lockedUntil.isNull(), row.lockedUntil.lte(now)))
      .first()
    if (!task) return null
    const updated = await this.prisma.client.orm.public.PoolRecycleTask.where({
      id: taskId,
      generation,
    })
      .where((row) => or(row.status.eq('QUEUED'), row.status.eq('PROCESSING')))
      .where((row) => or(row.lockedUntil.isNull(), row.lockedUntil.lte(now)))
      .updateAndCount({
        status: 'PROCESSING',
        lockedUntil: now + 120_000n,
        updateTime: now,
      })
    return updated === 1 ? (task as PoolRecycleTaskSnapshot) : null
  }

  async completeTask(taskId: string, generation: number): Promise<void> {
    await this.prisma.client.orm.public.PoolRecycleTask.where({
      id: taskId,
      generation,
      status: 'PROCESSING',
    }).update({
      status: 'COMPLETED',
      lockedUntil: null,
      lastError: null,
      updateTime: BigInt(Date.now()),
    })
  }

  async failAttempt(
    taskId: string,
    generation: number,
    error: unknown,
    finalAttempt: boolean,
    attempt: number,
  ): Promise<void> {
    await this.prisma.client.orm.public.PoolRecycleTask.where({
      id: taskId,
      generation,
      status: 'PROCESSING',
    }).update({
      status: finalAttempt ? 'FAILED' : 'QUEUED',
      lockedUntil: null,
      attempts: attempt,
      lastError: this.message(error).slice(0, 2_000),
      updateTime: BigInt(Date.now()),
    })
  }

  async cancelTask(taskId: string, generation: number): Promise<void> {
    await this.prisma.client.orm.public.PoolRecycleTask.where({
      id: taskId,
      generation,
    }).update({ status: 'CANCELED', lockedUntil: null, updateTime: BigInt(Date.now()) })
  }

  private async backfillOrganizationInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
  ): Promise<number> {
    const [pools, resources] = await Promise.all([
      this.loadPools(tx, organizationId, resourceType),
      resourceType === 'lead'
        ? tx.orm.public.Clue.where({ organizationId, inSharedPool: false })
            .where((row) => row.owner.isNotNull())
            .where((row) => or(row.transitionId.isNull(), row.transitionId.eq('')))
            .all()
        : tx.orm.public.Customer.where({ organizationId, inSharedPool: false })
            .where((row) => row.owner.isNotNull())
            .all(),
    ])
    const rules = await this.loadRules(
      tx,
      resourceType,
      pools.map((pool) => pool.id),
    )
    const ruleByPool = new Map(rules.map((rule) => [rule.poolId, rule]))
    const tokensByOwner = new Map<string, Set<string>>()
    let created = 0

    for (const resource of resources) {
      const existing = await tx.orm.public.PoolRecycleTask.where({
        organizationId,
        resourceType,
        resourceId: resource.id,
      }).first()
      if (existing || !resource.owner) continue
      if (!tokensByOwner.has(resource.owner)) {
        tokensByOwner.set(
          resource.owner,
          await loadUserScopeTokensPrisma(tx, organizationId, resource.owner),
        )
      }
      const tokens = tokensByOwner.get(resource.owner) ?? new Set<string>()
      const pool = pools.find((candidate) => scopeMatches(candidate.scopeId, tokens))
      const rule = pool ? ruleByPool.get(pool.id) : null
      if (!pool || !rule) continue
      if (
        await this.upsertForSnapshotInTransaction(
          tx,
          organizationId,
          resourceType,
          resource as ResourceSnapshot,
          { pool, rule },
        )
      ) {
        created++
      }
    }
    return created
  }

  private async refreshOneInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<void> {
    const resource =
      resourceType === 'lead'
        ? await tx.orm.public.Clue.where({ id: resourceId, organizationId }).first()
        : await tx.orm.public.Customer.where({ id: resourceId, organizationId }).first()
    if (!resource) {
      await this.cancelTaskInTransaction(tx, organizationId, resourceType, resourceId)
      return
    }
    const pools = await this.loadPools(tx, organizationId, resourceType)
    const rules = await this.loadRules(
      tx,
      resourceType,
      pools.map((pool) => pool.id),
    )
    const ruleByPool = new Map(rules.map((rule) => [rule.poolId, rule]))
    const tokens = resource.owner
      ? await loadUserScopeTokensPrisma(tx, organizationId, resource.owner)
      : new Set<string>()
    const pool = resource.owner
      ? pools.find((candidate) => scopeMatches(candidate.scopeId, tokens))
      : null
    const rule = pool ? ruleByPool.get(pool.id) : null
    await this.upsertForSnapshotInTransaction(
      tx,
      organizationId,
      resourceType,
      resource as ResourceSnapshot,
      pool && rule ? { pool, rule } : null,
    )
  }

  private async upsertForSnapshotInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
    resource: ResourceSnapshot,
    context: { pool: PoolSnapshot; rule: RecycleRuleSnapshot } | null,
  ): Promise<boolean> {
    await acquirePoolTransactionLocksPrisma(this.prisma.client, tx, [
      `pool-recycle:${organizationId}:${resourceType}:${resource.id}`,
    ])
    const existing = await tx.orm.public.PoolRecycleTask.where({
      organizationId,
      resourceType,
      resourceId: resource.id,
    }).first()
    const now = BigInt(Date.now())
    const eligible =
      !!context &&
      !!resource.owner &&
      !resource.inSharedPool &&
      (resourceType !== 'lead' || !resource.transitionId)

    let dueAt: bigint | null = null
    let fingerprint = ''
    if (eligible && context) {
      fingerprint = poolRecycleRuleFingerprint(
        context.pool.id,
        context.rule.operator,
        context.rule.condition,
      )
      const conditions: unknown = (() => {
        try {
          return context.rule.condition ? JSON.parse(context.rule.condition) : []
        } catch {
          return []
        }
      })()
      const nextDueAt = this.evaluator.nextDueAt(context.rule.operator, conditions, {
        createdAt: new Date(Number(resource.createTime)),
        collectedAt:
          resource.collectionTime === null ? null : new Date(Number(resource.collectionTime)),
        lastFollowedAt: resource.followTime === null ? null : new Date(Number(resource.followTime)),
      })
      if (nextDueAt) dueAt = BigInt(nextDueAt.getTime())
    }

    const generation = (existing?.generation ?? 0) + 1
    if (dueAt === null || !context || !eligible) {
      if (existing) {
        await tx.orm.public.PoolRecycleTask.where({ id: existing.id }).update({
          generation,
          status: 'CANCELED',
          lockedUntil: null,
          lastError: null,
          updateTime: now,
        })
      }
      return false
    }

    const values = {
      poolId: context.pool.id,
      dueAt,
      generation,
      status: 'PENDING',
      expectedOwnerId: resource.owner,
      expectedCreateTime: resource.createTime,
      expectedCollectionTime: resource.collectionTime,
      expectedFollowTime: resource.followTime,
      ruleFingerprint: fingerprint,
      attempts: 0,
      lockedUntil: null,
      lastError: null,
      updateTime: now,
    }
    if (existing) {
      await tx.orm.public.PoolRecycleTask.where({ id: existing.id }).update(values)
      return true
    }
    await tx.orm.public.PoolRecycleTask.create({
      id: createLegacyId32(),
      organizationId,
      resourceType,
      resourceId: resource.id,
      ...values,
      createTime: now,
    })
    return true
  }

  private async cancelTaskInTransaction(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<void> {
    await acquirePoolTransactionLocksPrisma(this.prisma.client, tx, [
      `pool-recycle:${organizationId}:${resourceType}:${resourceId}`,
    ])
    const existing = await tx.orm.public.PoolRecycleTask.where({
      organizationId,
      resourceType,
      resourceId,
    }).first()
    if (!existing) return
    await tx.orm.public.PoolRecycleTask.where({ id: existing.id }).update({
      generation: existing.generation + 1,
      status: 'CANCELED',
      lockedUntil: null,
      lastError: null,
      updateTime: BigInt(Date.now()),
    })
  }

  private async loadPools(
    tx: PrismaTransaction,
    organizationId: string,
    resourceType: ResourceType,
  ): Promise<PoolSnapshot[]> {
    return resourceType === 'lead'
      ? tx.orm.public.CluePool.where({ organizationId, enable: true, auto: true })
          .orderBy((pool) => pool.createTime.desc())
          .select('id', 'scopeId', 'enable', 'auto')
          .all()
      : tx.orm.public.CustomerPool.where({ organizationId, enable: true, auto: true })
          .orderBy((pool) => pool.createTime.desc())
          .select('id', 'scopeId', 'enable', 'auto')
          .all()
  }

  private async loadRules(
    tx: PrismaTransaction,
    resourceType: ResourceType,
    poolIds: string[],
  ): Promise<RecycleRuleSnapshot[]> {
    if (!poolIds.length) return []
    return resourceType === 'lead'
      ? tx.orm.public.CluePoolRecycleRule.where((rule) => rule.poolId.in(poolIds))
          .select('poolId', 'operator', 'condition')
          .all()
      : tx.orm.public.CustomerPoolRecycleRule.where((rule) => rule.poolId.in(poolIds))
          .select('poolId', 'operator', 'condition')
          .all()
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }
}
