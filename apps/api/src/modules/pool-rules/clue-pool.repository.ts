import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Clue, CluePoolPickRule, Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type {
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

interface ClueOwnershipInput {
  organizationId: string
  clueId: string
  ownerId: string
  operatorId: string
  poolAdmin?: boolean
  now?: bigint
}

interface ClueTransferInput extends ClueOwnershipInput {
  reasonId?: string | null
}

interface ClueMoveToPoolInput {
  organizationId: string
  clueId: string
  poolId: string
  operatorId: string
  reasonId?: string | null
  now?: bigint
}

/** 只访问 clue_* 直接表，不根据 module 分派到通用模型。 */
@Injectable()
export class CluePoolRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: PoolRuleCalculator,
  ) {}

  listPools(organizationId: string) {
    return this.prisma.cluePool.findMany({
      where: { organizationId },
      include: { hiddenFields: true, pickRule: true, recycleRule: true },
      orderBy: { createTime: 'asc' },
    })
  }

  listCapacities(organizationId: string) {
    return this.prisma.clueCapacity.findMany({
      where: { organizationId },
      orderBy: { createTime: 'asc' },
    })
  }

  listOwnerHistory(organizationId: string, clueId: string) {
    return this.prisma.clueOwner.findMany({
      where: { clueId, clue: { organizationId } },
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
    return this.prisma.cluePool.create({
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
      await tx.cluePoolHiddenField.deleteMany({ where: { poolId } })
      return tx.cluePool.update({
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
      return tx.cluePool.update({
        where: { id: pool.id },
        data: { enable: !pool.enable, updateTime: BigInt(Date.now()), updateUser: operatorId },
      })
    })
  }

  async deletePool(organizationId: string, poolId: string) {
    return this.prisma.$transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      if (await tx.clue.count({ where: { organizationId, poolId, inSharedPool: true } }))
        throw new BadRequestException('线索池中仍有未领取线索，不能删除')
      await tx.cluePool.delete({ where: { id: pool.id } })
      return pool
    })
  }

  createCapacity(
    organizationId: string,
    operatorId: string,
    input: DirectCapacityConfigurationInput,
  ) {
    return this.saveCapacity(organizationId, operatorId, input)
  }

  updateCapacity(
    organizationId: string,
    capacityId: string,
    operatorId: string,
    input: DirectCapacityConfigurationInput,
  ) {
    return this.saveCapacity(organizationId, operatorId, input, capacityId)
  }

  async deleteCapacity(organizationId: string, capacityId: string) {
    const deleted = await this.prisma.clueCapacity.deleteMany({
      where: { id: capacityId, organizationId },
    })
    if (!deleted.count) throw new NotFoundException('线索库容规则不存在')
    return { id: capacityId }
  }

  pick(input: ClueOwnershipInput) {
    return this.takeFromPool(input, true)
  }

  assign(input: ClueOwnershipInput) {
    return this.takeFromPool(input, false)
  }

  async transfer(input: ClueTransferInput) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(
        tx,
        poolTransactionLockKeys('clue', input.organizationId, input.clueId, input.ownerId),
      )
      const clue = await tx.clue.findFirst({
        where: { id: input.clueId, organizationId: input.organizationId, inSharedPool: false },
      })
      if (!clue) throw new NotFoundException('线索不存在或已在线索池中')
      if (!clue.owner || clue.collectionTime === null)
        throw new BadRequestException('线索当前没有可转移的负责人')
      if (clue.owner === input.ownerId) return clue

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const ownedCount = await tx.clue.count({
        where: {
          organizationId: input.organizationId,
          owner: input.ownerId,
          inSharedPool: false,
          NOT: { transitionType: 'CUSTOMER' },
        },
      })
      this.calculator.assertCapacity(capacity, ownedCount, 0, 1)
      await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      return tx.clue.update({
        where: { id: clue.id },
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

  moveToPool(input: ClueMoveToPoolInput) {
    return this.finishOwnership(input, false)
  }

  recycle(input: Omit<ClueMoveToPoolInput, 'reasonId'>) {
    return this.finishOwnership({ ...input, reasonId: 'system' }, true)
  }

  private async takeFromPool(input: ClueOwnershipInput, enforcePickRule: boolean) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(
        tx,
        poolTransactionLockKeys('clue', input.organizationId, input.clueId, input.ownerId),
      )
      const clue = await tx.clue.findFirst({
        where: { id: input.clueId, organizationId: input.organizationId },
        include: { pool: { include: { pickRule: true } } },
      })
      if (!clue) throw new NotFoundException('线索不存在')
      if (!clue.inSharedPool || !clue.poolId || !clue.pool?.enable)
        throw new ConflictException(`线索「${clue.name}」已被领取或所在池已禁用`)

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const [ownedCount, todayPickedCount, previousOwner] = await Promise.all([
        tx.clue.count({
          where: {
            organizationId: input.organizationId,
            owner: input.ownerId,
            inSharedPool: false,
            NOT: { transitionType: 'CUSTOMER' },
          },
        }),
        tx.clue.count({
          where: {
            organizationId: input.organizationId,
            owner: input.ownerId,
            inSharedPool: false,
            collectionTime: { gte: startOfLocalDay(now), lte: now },
          },
        }),
        tx.clueOwner.findFirst({ where: { clueId: clue.id }, orderBy: { collectionTime: 'desc' } }),
      ])

      this.calculator.assertClaimAllowed({
        rule: enforcePickRule ? this.pickRuleSnapshot(clue.pool.pickRule) : null,
        claimantId: input.ownerId,
        processCount: 1,
        todayPickedCount,
        previousOwner,
        poolEnteredAt: clue.updateTime,
        capacity,
        ownedCount,
        poolAdmin: input.poolAdmin ?? false,
        // Cordys PoolClueService: 池管理员仍执行前负责人冷却校验。
        poolAdminStillChecksPreviousOwner: true,
        now,
      })

      const updated = await tx.clue.updateMany({
        where: {
          id: clue.id,
          organizationId: input.organizationId,
          poolId: clue.poolId,
          inSharedPool: true,
        },
        data: {
          poolId: null,
          inSharedPool: false,
          owner: input.ownerId,
          collectionTime: now,
          stage: 'FOLLOWING',
          updateUser: input.ownerId,
          updateTime: now,
        },
      })
      if (updated.count !== 1) throw new ConflictException(`线索「${clue.name}」已被其他成员领取`)
      return tx.clue.findUniqueOrThrow({ where: { id: clue.id } })
    })
  }

  private async finishOwnership(input: ClueMoveToPoolInput, automatic: boolean) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(
        tx,
        poolTransactionLockKeys('clue', input.organizationId, input.clueId, input.operatorId),
      )
      const [clue, pool] = await Promise.all([
        tx.clue.findFirst({
          where: { id: input.clueId, organizationId: input.organizationId, inSharedPool: false },
        }),
        tx.cluePool.findFirst({
          where: { id: input.poolId, organizationId: input.organizationId, enable: true },
        }),
      ])
      if (!clue) throw new NotFoundException('线索不存在或已在线索池中')
      if (!pool) throw new NotFoundException('目标线索池不存在或已禁用')
      if (!clue.owner || clue.collectionTime === null)
        throw new BadRequestException('线索当前没有可结束的负责人')

      await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      return tx.clue.update({
        where: { id: clue.id },
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
  ): Promise<number | null> {
    const tokens = await loadUserScopeTokens(tx, organizationId, ownerId)
    if (!tokens.size) throw new BadRequestException('负责人不存在或已禁用')
    const capacities = await tx.clueCapacity.findMany({
      where: { organizationId },
      orderBy: { createTime: 'desc' },
    })
    return capacities.find((capacity) => scopeMatches(capacity.scopeId, tokens))?.capacity ?? null
  }

  private async saveCapacity(
    organizationId: string,
    operatorId: string,
    input: DirectCapacityConfigurationInput,
    capacityId?: string,
  ) {
    if (!input.scopeIds.length) throw new BadRequestException('库容适用范围不能为空')
    if (input.capacity !== null && input.capacity < 0)
      throw new BadRequestException('库容不能小于 0')
    const now = BigInt(Date.now())
    return this.prisma.$transaction(async (tx) => {
      await acquirePoolTransactionLocks(tx, [`pool:clue:${organizationId}:capacity-config`])
      const incoming = await resolveScopeUserIds(tx, organizationId, input.scopeIds)
      const existing = await tx.clueCapacity.findMany({
        where: { organizationId, ...(capacityId ? { id: { not: capacityId } } : {}) },
      })
      for (const row of existing) {
        const members = await resolveScopeUserIds(tx, organizationId, parseStringArray(row.scopeId))
        if ([...incoming].some((userId) => members.has(userId)))
          throw new BadRequestException('库容适用范围与已有规则命中相同成员，不能重复')
      }
      if (!capacityId)
        return tx.clueCapacity.create({
          data: {
            organizationId,
            scopeId: JSON.stringify(input.scopeIds),
            capacity: input.capacity,
            createTime: now,
            updateTime: now,
            createUser: operatorId,
            updateUser: operatorId,
          },
        })
      const current = await tx.clueCapacity.findFirst({
        where: { id: capacityId, organizationId },
      })
      if (!current) throw new NotFoundException('线索库容规则不存在')
      return tx.clueCapacity.update({
        where: { id: capacityId },
        data: {
          scopeId: JSON.stringify(input.scopeIds),
          capacity: input.capacity,
          updateTime: now,
          updateUser: operatorId,
        },
      })
    })
  }

  private assertPoolConfiguration(input: DirectPoolConfigurationInput): void {
    if (!input.name.trim()) throw new BadRequestException('线索池名称不能为空')
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
    const pool = await tx.cluePool.findFirst({ where: { id: poolId, organizationId } })
    if (!pool) throw new NotFoundException('线索池不存在')
    return pool
  }

  private appendOwnerHistory(
    tx: Prisma.TransactionClient,
    clue: Clue,
    operatorId: string,
    reasonId: string | null | undefined,
    endTime: bigint,
  ) {
    if (!clue.owner || clue.collectionTime === null)
      throw new BadRequestException('线索负责人历史快照不完整')
    return tx.clueOwner.create({
      data: {
        clueId: clue.id,
        owner: clue.owner,
        collectionTime: clue.collectionTime,
        endTime,
        operator: operatorId,
        reasonId: reasonId && reasonId !== 'system' ? reasonId : null,
      },
    })
  }

  private pickRuleSnapshot(rule: CluePoolPickRule | null) {
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
