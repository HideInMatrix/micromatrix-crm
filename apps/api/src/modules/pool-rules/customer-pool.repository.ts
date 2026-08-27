import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Customer, CustomerPoolPickRule, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type {
  CapacityExclusionCondition,
  DirectCapacityConfigurationInput,
  DirectPoolConfigurationInput,
} from './pool-domain.types'
import {
  loadUserScopeTokens,
  parseStringArray,
  resolveScopeUserIds,
  scopeMatches,
  startOfLocalDay,
} from './pool-repository.helpers'
import { PoolRuleCalculator } from './pool-rule-calculator.service'
import { acquirePoolTransactionLocks, poolTransactionLockKeys } from './pool-transaction-lock'

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
    private readonly prisma: PrismaService,
    private readonly calculator: PoolRuleCalculator,
  ) {}

  listPools(organizationId: string) {
    return this.prisma.customerPool.findMany({
      where: { organizationId },
      include: { hiddenFields: true, pickRule: true, recycleRule: true },
      orderBy: { createTime: 'asc' },
    })
  }

  listCapacities(organizationId: string) {
    return this.prisma.customerCapacity.findMany({
      where: { organizationId },
      orderBy: { createTime: 'desc' },
    })
  }

  listOwnerHistory(organizationId: string, customerId: string) {
    return this.prisma.customerOwner.findMany({
      where: { customerId, customer: { organizationId } },
      orderBy: { endTime: 'desc' },
    })
  }

  async createPool(
    organizationId: string,
    operatorId: string,
    input: DirectPoolConfigurationInput,
    now = BigInt(Date.now()),
  ) {
    this.assertPoolConfiguration(input)
    return this.prisma.customerPool.create({
      data: {
        name: input.name.trim(),
        organizationId,
        scopeId: JSON.stringify(input.scopeIds),
        ownerId: JSON.stringify(input.ownerIds),
        enable: input.enable,
        auto: input.auto,
        createTime: now,
        updateTime: now,
        createUser: operatorId,
        updateUser: operatorId,
        hiddenFields: {
          create: [...new Set(input.hiddenFieldIds)].map((fieldId) => ({ fieldId })),
        },
        pickRule: {
          create: {
            ...input.pickRule,
            createTime: now,
            updateTime: now,
            createUser: operatorId,
            updateUser: operatorId,
          },
        },
        recycleRule: {
          create: {
            operator: input.recycleRule.operator,
            condition: input.recycleRule.condition,
            createTime: now,
            updateTime: now,
            createUser: operatorId,
            updateUser: operatorId,
          },
        },
      },
      include: { hiddenFields: true, pickRule: true, recycleRule: true },
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
    return this.prisma.$transaction(async (tx) => {
      await this.assertPoolExists(tx, organizationId, poolId)
      await tx.customerPoolHiddenField.deleteMany({ where: { poolId } })
      return tx.customerPool.update({
        where: { id: poolId },
        data: {
          name: input.name.trim(),
          scopeId: JSON.stringify(input.scopeIds),
          ownerId: JSON.stringify(input.ownerIds),
          enable: input.enable,
          auto: input.auto,
          updateTime: now,
          updateUser: operatorId,
          hiddenFields: {
            create: [...new Set(input.hiddenFieldIds)].map((fieldId) => ({ fieldId })),
          },
          pickRule: {
            upsert: {
              create: {
                ...input.pickRule,
                createTime: now,
                updateTime: now,
                createUser: operatorId,
                updateUser: operatorId,
              },
              update: { ...input.pickRule, updateTime: now, updateUser: operatorId },
            },
          },
          recycleRule: {
            upsert: {
              create: {
                operator: input.recycleRule.operator,
                condition: input.recycleRule.condition,
                createTime: now,
                updateTime: now,
                createUser: operatorId,
                updateUser: operatorId,
              },
              update: {
                operator: input.recycleRule.operator,
                condition: input.recycleRule.condition,
                updateTime: now,
                updateUser: operatorId,
              },
            },
          },
        },
        include: { hiddenFields: true, pickRule: true, recycleRule: true },
      })
    })
  }

  async togglePool(organizationId: string, poolId: string, operatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      return tx.customerPool.update({
        where: { id: pool.id },
        data: { enable: !pool.enable, updateTime: BigInt(Date.now()), updateUser: operatorId },
      })
    })
  }

  async deletePool(organizationId: string, poolId: string) {
    return this.prisma.$transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      if (await tx.customer.count({ where: { organizationId, poolId, inSharedPool: true } }))
        throw new BadRequestException('客户公海中仍有未领取客户，不能删除')
      await tx.customerPool.delete({ where: { id: pool.id } })
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
    const deleted = await this.prisma.customerCapacity.deleteMany({
      where: { id: capacityId, organizationId },
    })
    if (!deleted.count) throw new NotFoundException('客户库容规则不存在')
    return { id: capacityId }
  }

  pick(input: CustomerOwnershipInput) {
    return this.takeFromPool(input, true)
  }

  pickInTransaction(tx: Prisma.TransactionClient, input: CustomerOwnershipInput) {
    return this.takeFromPoolInTransaction(tx, input, true)
  }

  assign(input: CustomerOwnershipInput) {
    return this.takeFromPool(input, false)
  }

  async transfer(input: CustomerTransferInput) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(
        tx,
        poolTransactionLockKeys('customer', input.organizationId, input.customerId, input.ownerId),
      )
      const customer = await tx.customer.findFirst({
        where: {
          id: input.customerId,
          organizationId: input.organizationId,
          inSharedPool: false,
        },
      })
      if (!customer) throw new NotFoundException('客户不存在或已在公海中')
      if (!customer.owner || customer.collectionTime === null)
        throw new BadRequestException('客户当前没有可转移的负责人')
      if (customer.owner === input.ownerId) return customer

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const ownedCount = await tx.customer.count({
        where: {
          organizationId: input.organizationId,
          owner: input.ownerId,
          inSharedPool: false,
        },
      })
      const excludedOwnedCount = capacity
        ? await this.countExcludedOwned(tx, input.organizationId, input.ownerId, capacity.filter)
        : 0
      this.calculator.assertCapacity(capacity?.capacity ?? null, ownedCount, excludedOwnedCount, 1)
      await this.appendOwnerHistory(tx, customer, input.operatorId, input.reasonId, now)
      return tx.customer.update({
        where: { id: customer.id },
        data: {
          owner: input.ownerId,
          collectionTime: now,
          reasonId: input.reasonId ?? null,
          updateUser: input.operatorId,
          updateTime: now,
        },
      })
    })
  }

  moveToPool(input: CustomerMoveToPoolInput) {
    return this.finishOwnership(input, false)
  }

  recycle(input: Omit<CustomerMoveToPoolInput, 'reasonId'>) {
    return this.finishOwnership({ ...input, reasonId: 'system' }, true)
  }

  private async takeFromPool(input: CustomerOwnershipInput, enforcePickRule: boolean) {
    return this.prisma.$transaction((tx) => this.takeFromPoolInTransaction(tx, input, enforcePickRule))
  }

  private async takeFromPoolInTransaction(
    tx: Prisma.TransactionClient,
    input: CustomerOwnershipInput,
    enforcePickRule: boolean,
  ) {
    const now = input.now ?? BigInt(Date.now())
    await acquirePoolTransactionLocks(
      tx,
      poolTransactionLockKeys('customer', input.organizationId, input.customerId, input.ownerId),
    )
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, organizationId: input.organizationId },
      include: { pool: { include: { pickRule: true } } },
    })
    if (!customer) throw new NotFoundException('客户不存在')
    if (!customer.inSharedPool || !customer.poolId || !customer.pool?.enable)
      throw new ConflictException(`客户「${customer.name}」已被领取或所在公海已禁用`)

    const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
    const [ownedCount, todayPickedCount, previousOwner] = await Promise.all([
      tx.customer.count({
        where: {
          organizationId: input.organizationId,
          owner: input.ownerId,
          inSharedPool: false,
        },
      }),
      tx.customer.count({
        where: {
          organizationId: input.organizationId,
          owner: input.ownerId,
          inSharedPool: false,
          collectionTime: { gte: startOfLocalDay(now), lte: now },
        },
      }),
      tx.customerOwner.findFirst({
        where: { customerId: customer.id },
        orderBy: { collectionTime: 'desc' },
      }),
    ])
    const excludedOwnedCount = capacity
      ? await this.countExcludedOwned(tx, input.organizationId, input.ownerId, capacity.filter)
      : 0

    this.calculator.assertClaimAllowed({
      rule: enforcePickRule ? this.pickRuleSnapshot(customer.pool.pickRule) : null,
      claimantId: input.ownerId,
      processCount: 1,
      todayPickedCount,
      previousOwner,
      poolEnteredAt: customer.updateTime,
      capacity: capacity?.capacity ?? null,
      ownedCount,
      excludedOwnedCount,
      poolAdmin: input.poolAdmin ?? false,
      poolAdminStillChecksPreviousOwner: false,
      now,
    })

    const updated = await tx.customer.updateMany({
      where: {
        id: customer.id,
        organizationId: input.organizationId,
        poolId: customer.poolId,
        inSharedPool: true,
      },
      data: {
        poolId: null,
        inSharedPool: false,
        owner: input.ownerId,
        collectionTime: now,
        updateUser: input.ownerId,
        updateTime: now,
      },
    })
    if (updated.count !== 1)
      throw new ConflictException(`客户「${customer.name}」已被其他成员领取`)
    return tx.customer.findUniqueOrThrow({ where: { id: customer.id } })
  }

  private async finishOwnership(input: CustomerMoveToPoolInput, automatic: boolean) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(
        tx,
        poolTransactionLockKeys(
          'customer',
          input.organizationId,
          input.customerId,
          input.operatorId,
        ),
      )
      const [customer, pool] = await Promise.all([
        tx.customer.findFirst({
          where: {
            id: input.customerId,
            organizationId: input.organizationId,
            inSharedPool: false,
          },
        }),
        tx.customerPool.findFirst({
          where: { id: input.poolId, organizationId: input.organizationId, enable: true },
        }),
      ])
      if (!customer) throw new NotFoundException('客户不存在或已在公海中')
      if (!pool) throw new NotFoundException('目标客户公海不存在或已禁用')
      if (!customer.owner || customer.collectionTime === null)
        throw new BadRequestException('客户当前没有可结束的负责人')

      await this.appendOwnerHistory(tx, customer, input.operatorId, input.reasonId, now)
      return tx.customer.update({
        where: { id: customer.id },
        data: {
          poolId: pool.id,
          inSharedPool: true,
          owner: null,
          collectionTime: null,
          reasonId: automatic ? 'system' : (input.reasonId ?? null),
          updateUser: input.operatorId,
          updateTime: now,
        },
      })
    })
  }

  private async findCapacity(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ownerId: string,
  ) {
    const tokens = await loadUserScopeTokens(tx, organizationId, ownerId)
    if (!tokens.size) throw new BadRequestException('负责人不存在或已禁用')
    const capacities = await tx.customerCapacity.findMany({
      where: { organizationId },
      orderBy: { createTime: 'desc' },
    })
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
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(tx, [`pool:customer:${organizationId}:capacity-config`])
      const incoming = await resolveScopeUserIds(tx, organizationId, input.scopeIds)
      const existing = await tx.customerCapacity.findMany({
        where: { organizationId, ...(capacityId ? { id: { not: capacityId } } : {}) },
      })
      for (const row of existing) {
        const members = await resolveScopeUserIds(tx, organizationId, parseStringArray(row.scopeId))
        if ([...incoming].some((userId) => members.has(userId)))
          throw new BadRequestException('库容适用范围与已有规则命中相同成员，不能重复')
      }
      const filter = input.filters?.length ? JSON.stringify(input.filters) : null
      if (!capacityId)
        return tx.customerCapacity.create({
          data: {
            organizationId,
            scopeId: JSON.stringify(input.scopeIds),
            capacity: input.capacity,
            filter,
            createTime: now,
            updateTime: now,
            createUser: operatorId,
            updateUser: operatorId,
          },
        })
      const current = await tx.customerCapacity.findFirst({
        where: { id: capacityId, organizationId },
      })
      if (!current) throw new NotFoundException('客户库容规则不存在')
      return tx.customerCapacity.update({
        where: { id: capacityId },
        data: {
          scopeId: JSON.stringify(input.scopeIds),
          capacity: input.capacity,
          filter,
          updateTime: now,
          updateUser: operatorId,
        },
      })
    })
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

  private async assertPoolExists(
    tx: Prisma.TransactionClient,
    organizationId: string,
    poolId: string,
  ) {
    const pool = await tx.customerPool.findFirst({ where: { id: poolId, organizationId } })
    if (!pool) throw new NotFoundException('客户公海不存在')
    return pool
  }

  private async countExcludedOwned(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ownerId: string,
    rawFilter: string | null,
  ): Promise<number> {
    const conditions = this.parseCapacityFilters(rawFilter)
    if (!conditions.length) return 0
    return tx.customer.count({
      where: {
        organizationId,
        owner: ownerId,
        inSharedPool: false,
        AND: conditions.map((condition) => ({
          opportunities: {
            some: {
              tenantId: organizationId,
              stageId:
                condition.operator === 'IN' ? { in: condition.value } : { notIn: condition.value },
            },
          },
        })),
      },
    })
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

  private appendOwnerHistory(
    tx: Prisma.TransactionClient,
    customer: Customer,
    operatorId: string,
    reasonId: string | null | undefined,
    endTime: bigint,
  ) {
    if (!customer.owner || customer.collectionTime === null)
      throw new BadRequestException('客户负责人历史快照不完整')
    return tx.customerOwner.create({
      data: {
        customerId: customer.id,
        owner: customer.owner,
        collectionTime: customer.collectionTime,
        endTime,
        operator: operatorId,
        reasonId: reasonId && reasonId !== 'system' ? reasonId : null,
      },
    })
  }

  private pickRuleSnapshot(rule: CustomerPoolPickRule | null) {
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
