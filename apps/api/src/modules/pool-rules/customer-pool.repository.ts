import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { not } from '@prisma/orm-postgres/orm-client'
import type { Prisma8Client } from '../../prisma/prisma8-client.js'
import { createLegacyId32 } from '../../common/legacy-id'
import { Prisma8Service } from '../../prisma/prisma8.service.js'
import type {
  CapacityExclusionCondition,
  DirectCapacityConfigurationInput,
  DirectPoolConfigurationInput,
} from './pool-domain.types'
import {
  loadUserScopeTokensPrisma8,
  parseStringArray,
  resolveScopeUserIdsPrisma8,
  scopeMatches,
  startOfLocalDay,
} from './pool-repository.helpers'
import { PoolRuleCalculator } from './pool-rule-calculator.service'
import {
  acquirePoolTransactionLocksPrisma8,
  poolTransactionLockKeys,
} from './pool-transaction-lock'

type Prisma8Transaction = Parameters<Parameters<Prisma8Client['transaction']>[0]>[0]

interface CustomerOwnershipInput {
  organizationId: string
  customerId: string
  ownerId: string
  operatorId: string
  poolAdmin?: boolean
  now?: bigint
}

interface CustomerTransferInput extends CustomerOwnershipInput {
  reasonId?: string | null
}

interface CustomerMoveToPoolInput {
  organizationId: string
  customerId: string
  poolId: string
  operatorId: string
  reasonId?: string | null
  now?: bigint
}

/** 只访问 customer_* 直接表，不根据 module 分派到通用模型。 */
@Injectable()
export class CustomerPoolRepository {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly calculator: PoolRuleCalculator,
  ) {}

  async listPools(organizationId: string) {
    const pools = await this.prisma8.client.orm.public.CustomerPool.where({
      organizationId: organizationId,
    })
      .orderBy((pool) => pool.createTime.asc())
      .all()
    if (!pools.length) return []
    const poolIds = pools.map((pool) => pool.id)
    const [hiddenFields, pickRules, recycleRules] = await Promise.all([
      this.prisma8.client.orm.public.CustomerPoolHiddenField.where((row) =>
        row.poolId.in(poolIds),
      ).all(),
      this.prisma8.client.orm.public.CustomerPoolPickRule.where((row) =>
        row.poolId.in(poolIds),
      ).all(),
      this.prisma8.client.orm.public.CustomerPoolRecycleRule.where((row) =>
        row.poolId.in(poolIds),
      ).all(),
    ])
    return pools.map((pool) => ({
      ...pool,
      hiddenFields: hiddenFields.filter((row) => row.poolId === pool.id),
      pickRule: pickRules.find((row) => row.poolId === pool.id) ?? null,
      recycleRule: recycleRules.find((row) => row.poolId === pool.id) ?? null,
    }))
  }

  listCapacities(organizationId: string) {
    return this.prisma8.client.orm.public.CustomerCapacity.where({
      organizationId: organizationId,
    })
      .orderBy((row) => row.createTime.desc())
      .all()
  }

  async listOwnerHistory(organizationId: string, customerId: string) {
    const customer = await this.prisma8.client.orm.public.Customer.where({
      id: customerId,
      organizationId: organizationId,
    })
      .select('id')
      .first()
    if (!customer) return []
    return this.prisma8.client.orm.public.CustomerOwner.where({ customerId: customer.id })
      .orderBy((row) => row.endTime.desc())
      .all()
  }

  async createPool(
    organizationId: string,
    operatorId: string,
    input: DirectPoolConfigurationInput,
    now = BigInt(Date.now()),
  ) {
    this.assertPoolConfiguration(input)
    return this.prisma8.client.transaction(async (tx) => {
      const pool = await tx.orm.public.CustomerPool.create({
        id: createLegacyId32(),
        name: input.name.trim(),
        organizationId: organizationId,
        scopeId: JSON.stringify(input.scopeIds),
        ownerId: JSON.stringify(input.ownerIds),
        enable: input.enable,
        auto: input.auto,
        createTime: now,
        updateTime: now,
        createUser: operatorId,
        updateUser: operatorId,
      })
      await this.replacePoolRelations(tx, pool.id, operatorId, input, now)
      return this.loadPoolView(tx, pool.id)
    })
  }

  async updatePool(
    organizationId: string,
    poolId: string,
    operatorId: string,
    input: DirectPoolConfigurationInput,
    now = BigInt(Date.now()),
  ) {
    this.assertPoolConfiguration(input)
    return this.prisma8.client.transaction(async (tx) => {
      await this.assertPoolExists(tx, organizationId, poolId)
      const id = poolId
      const updated = await tx.orm.public.CustomerPool.where({ id }).update({
        name: input.name.trim(),
        scopeId: JSON.stringify(input.scopeIds),
        ownerId: JSON.stringify(input.ownerIds),
        enable: input.enable,
        auto: input.auto,
        updateTime: now,
        updateUser: operatorId,
      })
      if (!updated) throw new NotFoundException('客户公海不存在')
      await this.replacePoolRelations(tx, id, operatorId, input, now)
      return this.loadPoolView(tx, id)
    })
  }

  async togglePool(organizationId: string, poolId: string, operatorId: string) {
    return this.prisma8.client.transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      const updated = await tx.orm.public.CustomerPool.where({ id: pool.id }).update({
        enable: !pool.enable,
        updateTime: BigInt(Date.now()),
        updateUser: operatorId,
      })
      if (!updated) throw new NotFoundException('客户公海不存在')
      return updated
    })
  }

  async deletePool(organizationId: string, poolId: string) {
    return this.prisma8.client.transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      const linked = await tx.orm.public.Customer.where({
        organizationId: organizationId,
        poolId: pool.id,
        inSharedPool: true,
      }).aggregate((agg) => ({ count: agg.count() }))
      if (linked.count) throw new BadRequestException('客户公海中仍有未领取客户，不能删除')
      await tx.orm.public.CustomerPool.where({ id: pool.id }).delete()
      return pool
    })
  }

  createCapacity(
    organizationId: string,
    operatorId: string,
    input: DirectCapacityConfigurationInput & { filters?: CapacityExclusionCondition[] },
  ) {
    return this.saveCapacity(organizationId, operatorId, input)
  }

  updateCapacity(
    organizationId: string,
    capacityId: string,
    operatorId: string,
    input: DirectCapacityConfigurationInput & { filters?: CapacityExclusionCondition[] },
  ) {
    return this.saveCapacity(organizationId, operatorId, input, capacityId)
  }

  async deleteCapacity(organizationId: string, capacityId: string) {
    const deleted = await this.prisma8.client.orm.public.CustomerCapacity.where({
      id: capacityId,
      organizationId: organizationId,
    }).deleteAndCount()
    if (!deleted) throw new NotFoundException('客户库容规则不存在')
    return { id: capacityId }
  }

  pick(input: CustomerOwnershipInput) {
    return this.takeFromPool(input, true)
  }

  pickInTransaction(tx: Prisma8Transaction, input: CustomerOwnershipInput) {
    return this.takeFromPoolInTransaction(tx, input, true)
  }

  assign(input: CustomerOwnershipInput) {
    return this.takeFromPool(input, false)
  }

  async transfer(input: CustomerTransferInput) {
    return this.prisma8.client.transaction((tx) => this.transferInTransaction(tx, input))
  }

  async transferInTransaction(tx: Prisma8Transaction, input: CustomerTransferInput) {
    const now = input.now ?? BigInt(Date.now())
    await acquirePoolTransactionLocksPrisma8(
      this.prisma8.client,
      tx,
      poolTransactionLockKeys('customer', input.organizationId, input.customerId, input.ownerId),
    )
    const customer = await tx.orm.public.Customer.where({
      id: input.customerId,
      organizationId: input.organizationId,
      inSharedPool: false,
    }).first()
    if (!customer) throw new NotFoundException('客户不存在或已在公海中')
    if (!customer.owner || customer.collectionTime === null)
      throw new BadRequestException('客户当前没有可转移的负责人')
    if (customer.owner === input.ownerId) return customer

    const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
    const ownedCount = await tx.orm.public.Customer.where({
      organizationId: input.organizationId,
      owner: input.ownerId,
      inSharedPool: false,
    }).aggregate((aggregate) => ({ count: aggregate.count() }))
    const excludedOwnedCount = capacity
      ? await this.countExcludedOwned(tx, input.organizationId, input.ownerId, capacity.filter)
      : 0
    this.calculator.assertCapacity(
      capacity?.capacity ?? null,
      ownedCount.count,
      excludedOwnedCount,
      1,
    )
    await this.appendOwnerHistoryPrisma8(tx, customer, input.operatorId, input.reasonId, now)
    await tx.orm.public.CustomerContact.where({
      organizationId: input.organizationId,
      customerId: customer.id,
    }).updateAndCount({
      owner: input.ownerId,
      updateUser: input.operatorId,
      updateTime: now,
    })
    const updated = await tx.orm.public.Customer.where({ id: customer.id }).update({
      owner: input.ownerId,
      collectionTime: now,
      reasonId: input.reasonId ? input.reasonId : null,
      updateUser: input.operatorId,
      updateTime: now,
    })
    if (!updated) throw new NotFoundException('客户不存在或已在公海中')
    return updated
  }

  moveToPool(input: CustomerMoveToPoolInput) {
    return this.finishOwnership(input, false)
  }

  recycle(input: Omit<CustomerMoveToPoolInput, 'reasonId'>) {
    return this.finishOwnership({ ...input, reasonId: 'system' }, true)
  }

  private async takeFromPool(input: CustomerOwnershipInput, enforcePickRule: boolean) {
    return this.prisma8.client.transaction((tx) =>
      this.takeFromPoolInTransaction(tx, input, enforcePickRule),
    )
  }

  private async takeFromPoolInTransaction(
    tx: Prisma8Transaction,
    input: CustomerOwnershipInput,
    enforcePickRule: boolean,
  ) {
    const now = input.now ?? BigInt(Date.now())
    await acquirePoolTransactionLocksPrisma8(
      this.prisma8.client,
      tx,
      poolTransactionLockKeys('customer', input.organizationId, input.customerId, input.ownerId),
    )
    const customer = await tx.orm.public.Customer.where({
      id: input.customerId,
      organizationId: input.organizationId,
    }).first()
    if (!customer) throw new NotFoundException('客户不存在')
    if (!customer.inSharedPool || !customer.poolId)
      throw new ConflictException(`客户「${customer.name}」已被领取或所在公海已禁用`)
    const pool = await tx.orm.public.CustomerPool.where({
      id: customer.poolId,
      organizationId: input.organizationId,
      enable: true,
    }).first()
    if (!pool) throw new ConflictException(`客户「${customer.name}」已被领取或所在公海已禁用`)
    const pickRule = await tx.orm.public.CustomerPoolPickRule.where({ poolId: pool.id }).first()

    const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
    const owned = tx.orm.public.Customer.where({
      organizationId: input.organizationId,
      owner: input.ownerId,
      inSharedPool: false,
    })
    const [ownedCount, todayPickedCount, previousOwner] = await Promise.all([
      owned.aggregate((aggregate) => ({ count: aggregate.count() })),
      owned
        .where((row) => row.collectionTime.gte(startOfLocalDay(now)))
        .where((row) => row.collectionTime.lte(now))
        .aggregate((aggregate) => ({ count: aggregate.count() })),
      tx.orm.public.CustomerOwner.where({ customerId: customer.id })
        .orderBy((row) => row.collectionTime.desc())
        .first(),
    ])
    const excludedOwnedCount = capacity
      ? await this.countExcludedOwned(tx, input.organizationId, input.ownerId, capacity.filter)
      : 0

    this.calculator.assertClaimAllowed({
      rule: enforcePickRule ? this.pickRuleSnapshot(pickRule) : null,
      claimantId: input.ownerId,
      processCount: 1,
      todayPickedCount: todayPickedCount.count,
      previousOwner,
      poolEnteredAt: customer.updateTime,
      capacity: capacity?.capacity ?? null,
      ownedCount: ownedCount.count,
      excludedOwnedCount,
      poolAdmin: input.poolAdmin ?? false,
      poolAdminStillChecksPreviousOwner: false,
      now,
    })

    const updated = await tx.orm.public.Customer.where({
      id: customer.id,
      organizationId: input.organizationId,
      poolId: customer.poolId,
      inSharedPool: true,
    }).updateAndCount({
      poolId: null,
      inSharedPool: false,
      owner: input.ownerId,
      collectionTime: now,
      updateUser: input.ownerId,
      updateTime: now,
    })
    if (updated !== 1) throw new ConflictException(`客户「${customer.name}」已被其他成员领取`)
    await tx.orm.public.CustomerContact.where({
      organizationId: input.organizationId,
      customerId: customer.id,
    }).updateAndCount({
      owner: input.ownerId,
      updateUser: input.operatorId,
      updateTime: now,
    })
    const claimed = await tx.orm.public.Customer.where({ id: customer.id }).first()
    if (!claimed) throw new NotFoundException('客户不存在')
    return claimed
  }

  private async finishOwnership(input: CustomerMoveToPoolInput, automatic: boolean) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(
        this.prisma8.client,
        tx,
        poolTransactionLockKeys(
          'customer',
          input.organizationId,
          input.customerId,
          input.operatorId,
        ),
      )
      const [customer, pool] = await Promise.all([
        tx.orm.public.Customer.where({
          id: input.customerId,
          organizationId: input.organizationId,
          inSharedPool: false,
        }).first(),
        tx.orm.public.CustomerPool.where({
          id: input.poolId,
          organizationId: input.organizationId,
          enable: true,
        }).first(),
      ])
      if (!customer) throw new NotFoundException('客户不存在或已在公海中')
      if (!pool) throw new NotFoundException('目标客户公海不存在或已禁用')
      if (!customer.owner || customer.collectionTime === null)
        throw new BadRequestException('客户当前没有可结束的负责人')

      await this.appendOwnerHistoryPrisma8(tx, customer, input.operatorId, input.reasonId, now)
      await tx.orm.public.CustomerContact.where({
        organizationId: input.organizationId,
        customerId: customer.id,
      }).updateAndCount({
        owner: '-',
        updateUser: input.operatorId,
        updateTime: now,
      })
      const updated = await tx.orm.public.Customer.where({ id: customer.id }).update({
        poolId: pool.id,
        inSharedPool: true,
        owner: null,
        collectionTime: null,
        reasonId: automatic ? 'system' : input.reasonId ? input.reasonId : null,
        updateUser: input.operatorId,
        updateTime: now,
      })
      if (!updated) throw new NotFoundException('客户不存在或已在公海中')
      return updated
    })
  }

  private async findCapacity(tx: Prisma8Transaction, organizationId: string, ownerId: string) {
    const tokens = await loadUserScopeTokensPrisma8(tx, organizationId, ownerId)
    if (!tokens.size) throw new BadRequestException('负责人不存在或已禁用')
    const capacities = await tx.orm.public.CustomerCapacity.where({
      organizationId: organizationId,
    })
      .orderBy((row) => row.createTime.desc())
      .all()
    return capacities.find((capacity) => scopeMatches(capacity.scopeId, tokens)) ?? null
  }

  private async saveCapacity(
    organizationId: string,
    operatorId: string,
    input: DirectCapacityConfigurationInput & { filters?: CapacityExclusionCondition[] },
    capacityId?: string,
  ) {
    if (!input.scopeIds.length) throw new BadRequestException('库容适用范围不能为空')
    if (input.capacity !== null && input.capacity < 0)
      throw new BadRequestException('库容不能小于 0')
    const now = BigInt(Date.now())
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(this.prisma8.client, tx, [
        `pool:customer:${organizationId}:capacity-config`,
      ])
      const incoming = await resolveScopeUserIdsPrisma8(tx, organizationId, input.scopeIds)
      let existingQuery = tx.orm.public.CustomerCapacity.where({
        organizationId: organizationId,
      })
      if (capacityId) {
        const excluded = capacityId
        existingQuery = existingQuery.where((row) => row.id.neq(excluded))
      }
      const existing = await existingQuery.all()
      for (const row of existing) {
        const members = await resolveScopeUserIdsPrisma8(
          tx,
          organizationId,
          parseStringArray(row.scopeId),
        )
        if ([...incoming].some((userId) => members.has(userId)))
          throw new BadRequestException('库容适用范围与已有规则命中相同成员，不能重复')
      }
      const filter = input.filters?.length ? JSON.stringify(input.filters) : null
      if (!capacityId)
        return tx.orm.public.CustomerCapacity.create({
          id: createLegacyId32(),
          organizationId: organizationId,
          scopeId: JSON.stringify(input.scopeIds),
          capacity: input.capacity,
          filter,
          createTime: now,
          updateTime: now,
          createUser: operatorId,
          updateUser: operatorId,
        })
      const id = capacityId
      const current = await tx.orm.public.CustomerCapacity.where({
        id,
        organizationId: organizationId,
      }).first()
      if (!current) throw new NotFoundException('客户库容规则不存在')
      const updated = await tx.orm.public.CustomerCapacity.where({ id }).update({
        scopeId: JSON.stringify(input.scopeIds),
        capacity: input.capacity,
        filter,
        updateTime: now,
        updateUser: operatorId,
      })
      if (!updated) throw new NotFoundException('客户库容规则不存在')
      return updated
    })
  }

  private async replacePoolRelations(
    tx: Prisma8Transaction,
    poolId: string,
    operatorId: string,
    input: DirectPoolConfigurationInput,
    now: bigint,
  ) {
    const id = poolId
    await Promise.all([
      tx.orm.public.CustomerPoolHiddenField.where({ poolId: id }).deleteAll(),
      tx.orm.public.CustomerPoolPickRule.where({ poolId: id }).deleteAll(),
      tx.orm.public.CustomerPoolRecycleRule.where({ poolId: id }).deleteAll(),
    ])
    const hiddenFieldIds = [...new Set(input.hiddenFieldIds)]
    if (hiddenFieldIds.length) {
      await tx.orm.public.CustomerPoolHiddenField.createAll(
        hiddenFieldIds.map((fieldId) => ({
          poolId: id,
          fieldId: fieldId,
        })),
      )
    }
    await tx.orm.public.CustomerPoolPickRule.create({
      id: createLegacyId32(),
      poolId: id,
      limitOnNumber: input.pickRule.limitOnNumber,
      pickNumber: input.pickRule.pickNumber,
      limitPreOwner: input.pickRule.limitPreOwner,
      pickIntervalDays: input.pickRule.pickIntervalDays,
      limitNew: input.pickRule.limitNew,
      newPickInterval: input.pickRule.newPickInterval,
      createUser: operatorId,
      createTime: now,
      updateUser: operatorId,
      updateTime: now,
    })
    await tx.orm.public.CustomerPoolRecycleRule.create({
      id: createLegacyId32(),
      poolId: id,
      operator: input.recycleRule.operator ? input.recycleRule.operator : null,
      condition: input.recycleRule.condition,
      createTime: now,
      updateTime: now,
      createUser: operatorId,
      updateUser: operatorId,
    })
  }

  private async loadPoolView(tx: Prisma8Transaction, poolId: string) {
    const id = poolId
    const pool = await tx.orm.public.CustomerPool.where({ id }).first()
    if (!pool) throw new NotFoundException('客户公海不存在')
    const [hiddenFields, pickRule, recycleRule] = await Promise.all([
      tx.orm.public.CustomerPoolHiddenField.where({ poolId: id }).all(),
      tx.orm.public.CustomerPoolPickRule.where({ poolId: id }).first(),
      tx.orm.public.CustomerPoolRecycleRule.where({ poolId: id }).first(),
    ])
    return { ...pool, hiddenFields, pickRule, recycleRule }
  }

  private assertPoolConfiguration(input: DirectPoolConfigurationInput): void {
    if (!input.name.trim()) throw new BadRequestException('客户公海名称不能为空')
    if (input.pickRule.limitOnNumber && !input.pickRule.pickNumber)
      throw new BadRequestException('启用每日领取限制时必须填写领取数量')
    if (input.pickRule.limitPreOwner && !input.pickRule.pickIntervalDays)
      throw new BadRequestException('启用前负责人限制时必须填写冷却天数')
    if (input.pickRule.limitNew && !input.pickRule.newPickInterval)
      throw new BadRequestException('启用新数据限制时必须填写冷却天数')
  }

  private async assertPoolExists(tx: Prisma8Transaction, organizationId: string, poolId: string) {
    const pool = await tx.orm.public.CustomerPool.where({
      id: poolId,
      organizationId: organizationId,
    }).first()
    if (!pool) throw new NotFoundException('客户公海不存在')
    return pool
  }

  private async countExcludedOwned(
    tx: Prisma8Transaction,
    organizationId: string,
    ownerId: string,
    rawFilter: string | null,
  ): Promise<number> {
    const conditions = this.parseCapacityFilters(rawFilter)
    if (!conditions.length) return 0
    const owned = await tx.orm.public.Customer.where({
      organizationId: organizationId,
      owner: ownerId,
      inSharedPool: false,
    })
      .select('id')
      .all()
    let matches = new Set(owned.map((customer) => String(customer.id)))
    if (!matches.size) return 0
    for (const condition of conditions) {
      const customerIds = [...matches]
      if (!customerIds.length) return 0
      const stageIds = condition.value
      let opportunities = tx.orm.public.Opportunity.where({
        organizationId: organizationId,
      }).where((row) => row.customerId.in(customerIds))
      opportunities =
        condition.operator === 'IN'
          ? opportunities.where((row) => row.stage.in(stageIds))
          : opportunities.where((row) => not(row.stage.in(stageIds)))
      const rows = await opportunities.select('customerId').all()
      const hitIds = new Set(
        rows.flatMap((row) => (row.customerId ? [String(row.customerId)] : [])),
      )
      matches = new Set([...matches].filter((customerId) => hitIds.has(customerId)))
    }
    return matches.size
  }

  private parseCapacityFilters(rawFilter: string | null): CapacityExclusionCondition[] {
    if (!rawFilter) return []
    try {
      const parsed: unknown = JSON.parse(rawFilter)
      if (!Array.isArray(parsed)) return []
      return parsed.filter((condition): condition is CapacityExclusionCondition => {
        if (!condition || typeof condition !== 'object') return false
        const item = condition as Partial<CapacityExclusionCondition>
        return (
          item.column === 'stage' &&
          (item.operator === 'IN' || item.operator === 'NOT_IN') &&
          Array.isArray(item.value) &&
          item.value.length > 0 &&
          item.value.every((value) => typeof value === 'string')
        )
      })
    } catch {
      return []
    }
  }

  private appendOwnerHistoryPrisma8(
    tx: Prisma8Transaction,
    customer: {
      id: string
      owner: string | null
      collectionTime: bigint | null
    },
    operatorId: string,
    reasonId: string | null | undefined,
    endTime: bigint,
  ) {
    if (!customer.owner || customer.collectionTime === null)
      throw new BadRequestException('客户负责人历史快照不完整')
    return tx.orm.public.CustomerOwner.create({
      id: createLegacyId32(),
      customerId: customer.id,
      owner: customer.owner,
      collectionTime: customer.collectionTime,
      endTime,
      operator: operatorId,
      reasonId: reasonId && reasonId !== 'system' ? reasonId : null,
    })
  }

  private pickRuleSnapshot(
    rule: {
      limitOnNumber: boolean
      pickNumber: number | null
      limitPreOwner: boolean
      pickIntervalDays: number | null
      limitNew: boolean
      newPickInterval: number | null
    } | null,
  ) {
    if (!rule) return null
    return {
      limitOnNumber: rule.limitOnNumber,
      pickNumber: rule.pickNumber,
      limitPreOwner: rule.limitPreOwner,
      pickIntervalDays: rule.pickIntervalDays,
      limitNew: rule.limitNew,
      newPickInterval: rule.newPickInterval,
    }
  }
}
