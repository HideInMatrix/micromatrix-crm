import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Id32, prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import type {
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

interface ClueSnapshot {
  id: string
  owner: string | null
  collectionTime: bigint | null
}

interface CluePickRuleSnapshot {
  limitOnNumber: boolean
  pickNumber: number | null
  limitPreOwner: boolean
  pickIntervalDays: number | null
  limitNew: boolean
  newPickInterval: number | null
}

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

interface ClueBatchTransferInput {
  organizationId: string
  clueIds: string[]
  ownerId: string
  operatorId: string
  reasonId?: string | null
  now?: bigint
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
    private readonly prisma8: Prisma8Service,
    private readonly calculator: PoolRuleCalculator,
  ) {}

  async listPools(organizationId: string) {
    const organization = prisma8Varchar(organizationId, 32)
    const pools = await this.prisma8.client.orm.public.CluePool.where({
      organizationId: organization,
    })
      .orderBy((pool) => pool.createTime.asc())
      .all()
    if (!pools.length) return []
    const poolIds = pools.map((pool) => pool.id)
    const [hiddenFields, pickRules, recycleRules] = await Promise.all([
      this.prisma8.client.orm.public.CluePoolHiddenField.where((row) => row.poolId.in(poolIds)).all(),
      this.prisma8.client.orm.public.CluePoolPickRule.where((row) => row.poolId.in(poolIds)).all(),
      this.prisma8.client.orm.public.CluePoolRecycleRule.where((row) => row.poolId.in(poolIds)).all(),
    ])
    return pools.map((pool) => ({
      ...pool,
      hiddenFields: hiddenFields.filter((row) => row.poolId === pool.id),
      pickRule: pickRules.find((row) => row.poolId === pool.id) ?? null,
      recycleRule: recycleRules.find((row) => row.poolId === pool.id) ?? null,
    }))
  }

  listCapacities(organizationId: string) {
    return this.prisma8.client.orm.public.ClueCapacity.where({
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .orderBy((row) => row.createTime.asc())
      .all()
  }

  async listOwnerHistory(organizationId: string, clueId: string) {
    const clue = await this.prisma8.client.orm.public.Clue.where({
      id: prisma8Varchar(clueId, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .select('id')
      .first()
    if (!clue) return []
    return this.prisma8.client.orm.public.ClueOwner.where({ clueId: clue.id })
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
      const pool = await tx.orm.public.CluePool.create({
        id: prisma8Id32(),
        name: prisma8Varchar(input.name.trim(), 255),
        organizationId: prisma8Varchar(organizationId, 32),
        scopeId: JSON.stringify(input.scopeIds),
        ownerId: JSON.stringify(input.ownerIds),
        enable: input.enable,
        auto: input.auto,
        createTime: now,
        updateTime: now,
        createUser: prisma8Varchar(operatorId, 32),
        updateUser: prisma8Varchar(operatorId, 32),
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
      const id = prisma8Varchar(poolId, 32)
      const updated = await tx.orm.public.CluePool.where({ id }).update({
        name: prisma8Varchar(input.name.trim(), 255),
        scopeId: JSON.stringify(input.scopeIds),
        ownerId: JSON.stringify(input.ownerIds),
        enable: input.enable,
        auto: input.auto,
        updateTime: now,
        updateUser: prisma8Varchar(operatorId, 32),
      })
      if (!updated) throw new NotFoundException('线索池不存在')
      await this.replacePoolRelations(tx, id, operatorId, input, now)
      return this.loadPoolView(tx, id)
    })
  }

  async togglePool(organizationId: string, poolId: string, operatorId: string) {
    return this.prisma8.client.transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      const updated = await tx.orm.public.CluePool.where({ id: pool.id }).update({
        enable: !pool.enable,
        updateTime: BigInt(Date.now()),
        updateUser: prisma8Varchar(operatorId, 32),
      })
      if (!updated) throw new NotFoundException('线索池不存在')
      return updated
    })
  }

  async deletePool(organizationId: string, poolId: string) {
    return this.prisma8.client.transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      const linked = await tx.orm.public.Clue.where({
        organizationId: prisma8Varchar(organizationId, 32),
        poolId: pool.id,
        inSharedPool: true,
      }).aggregate((agg) => ({ count: agg.count() }))
      if (linked.count)
        throw new BadRequestException('线索池中仍有未领取线索，不能删除')
      await tx.orm.public.CluePool.where({ id: pool.id }).delete()
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
    const deleted = await this.prisma8.client.orm.public.ClueCapacity.where({
      id: prisma8Varchar(capacityId, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    }).deleteAndCount()
    if (!deleted) throw new NotFoundException('线索库容规则不存在')
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
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(
        this.prisma8.client,
        tx,
        poolTransactionLockKeys('clue', input.organizationId, input.clueId, input.ownerId),
      )
      const clue = await tx.orm.public.Clue.where({
        id: prisma8Varchar(input.clueId, 32),
        organizationId: prisma8Varchar(input.organizationId, 32),
        inSharedPool: false,
      }).first()
      if (!clue) throw new NotFoundException('线索不存在或已在线索池中')
      if (!clue.owner || clue.collectionTime === null)
        throw new BadRequestException('线索当前没有可转移的负责人')
      if (clue.owner === input.ownerId) return clue

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const owned = await tx.orm.public.Clue.where({
        organizationId: prisma8Varchar(input.organizationId, 32),
        owner: prisma8Varchar(input.ownerId, 32),
        inSharedPool: false,
      })
        .where((row) => row.transitionType.neq(prisma8Varchar('CUSTOMER', 30)))
        .aggregate((agg) => ({ count: agg.count() }))
      this.calculator.assertCapacity(capacity, owned.count, 0, 1)
      await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      const updated = await tx.orm.public.Clue.where({ id: clue.id }).update({
        owner: prisma8Varchar(input.ownerId, 32),
        collectionTime: now,
        reasonId: input.reasonId ? prisma8Varchar(input.reasonId, 32) : null,
        updateUser: prisma8Varchar(input.operatorId, 32),
        updateTime: now,
      })
      if (!updated) throw new NotFoundException('线索不存在或已在线索池中')
      return updated
    })
  }

  async batchTransfer(input: ClueBatchTransferInput) {
    const clueIds = [...new Set(input.clueIds)]
    if (clueIds.length === 0) throw new BadRequestException('请选择线索')
    const now = input.now ?? BigInt(Date.now())
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(
        this.prisma8.client,
        tx,
        clueIds.flatMap((clueId) =>
          poolTransactionLockKeys('clue', input.organizationId, clueId, input.ownerId),
        ),
      )
      const clues = await tx.orm.public.Clue.where({
        organizationId: prisma8Varchar(input.organizationId, 32),
        inSharedPool: false,
      })
        .where((row) => row.id.in(prisma8Varchars(clueIds, 32)))
        .all()
      if (clues.length !== clueIds.length) {
        throw new NotFoundException('存在不存在或已在线索池中的线索')
      }

      const changed = clues.filter((clue) => clue.owner !== input.ownerId)
      if (changed.length === 0) return { count: 0 }
      if (changed.some((clue) => !clue.owner || clue.collectionTime === null)) {
        throw new BadRequestException('存在没有可转移负责人的线索')
      }

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const owned = await tx.orm.public.Clue.where({
        organizationId: prisma8Varchar(input.organizationId, 32),
        owner: prisma8Varchar(input.ownerId, 32),
        inSharedPool: false,
        transitionId: null,
      }).aggregate((agg) => ({ count: agg.count() }))
      this.calculator.assertCapacity(capacity, owned.count, 0, changed.length)

      for (const clue of changed) {
        await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      }
      const count = await tx.orm.public.Clue.where({
        organizationId: prisma8Varchar(input.organizationId, 32),
      })
        .where((row) => row.id.in(changed.map((clue) => clue.id)))
        .updateAndCount({
          owner: prisma8Varchar(input.ownerId, 32),
          collectionTime: now,
          reasonId: input.reasonId ? prisma8Varchar(input.reasonId, 32) : null,
          updateUser: prisma8Varchar(input.operatorId, 32),
          updateTime: now,
        })
      return { count }
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
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(
        this.prisma8.client,
        tx,
        poolTransactionLockKeys('clue', input.organizationId, input.clueId, input.ownerId),
      )
      const clue = await tx.orm.public.Clue.where({
        id: prisma8Varchar(input.clueId, 32),
        organizationId: prisma8Varchar(input.organizationId, 32),
      }).first()
      if (!clue) throw new NotFoundException('线索不存在')
      const pool = clue.poolId
        ? await tx.orm.public.CluePool.where({
            id: clue.poolId,
            organizationId: prisma8Varchar(input.organizationId, 32),
            enable: true,
          }).first()
        : null
      if (!clue.inSharedPool || !clue.poolId || !pool)
        throw new ConflictException(`线索「${clue.name}」已被领取或所在池已禁用`)
      const pickRule = await tx.orm.public.CluePoolPickRule.where({ poolId: pool.id }).first()

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const [owned, todayPicked, previousOwner] = await Promise.all([
        tx.orm.public.Clue.where({
          organizationId: prisma8Varchar(input.organizationId, 32),
          owner: prisma8Varchar(input.ownerId, 32),
          inSharedPool: false,
        })
          .where((row) => row.transitionType.neq(prisma8Varchar('CUSTOMER', 30)))
          .aggregate((agg) => ({ count: agg.count() })),
        tx.orm.public.Clue.where({
          organizationId: prisma8Varchar(input.organizationId, 32),
          owner: prisma8Varchar(input.ownerId, 32),
          inSharedPool: false,
        })
          .where((row) => row.collectionTime.gte(startOfLocalDay(now)))
          .where((row) => row.collectionTime.lte(now))
          .aggregate((agg) => ({ count: agg.count() })),
        tx.orm.public.ClueOwner.where({ clueId: clue.id })
          .orderBy((row) => row.collectionTime.desc())
          .first(),
      ])

      this.calculator.assertClaimAllowed({
        rule: enforcePickRule ? this.pickRuleSnapshot(pickRule) : null,
        claimantId: input.ownerId,
        processCount: 1,
        todayPickedCount: todayPicked.count,
        previousOwner,
        poolEnteredAt: clue.updateTime,
        capacity,
        ownedCount: owned.count,
        poolAdmin: input.poolAdmin ?? false,
        // Cordys PoolClueService: 池管理员仍执行前负责人冷却校验。
        poolAdminStillChecksPreviousOwner: true,
        now,
      })

      const updated = await tx.orm.public.Clue.where({
        id: clue.id,
        organizationId: prisma8Varchar(input.organizationId, 32),
        poolId: clue.poolId,
        inSharedPool: true,
      }).updateAndCount({
        poolId: null,
        inSharedPool: false,
        owner: prisma8Varchar(input.ownerId, 32),
        collectionTime: now,
        stage: prisma8Varchar('FOLLOWING', 30),
        updateUser: prisma8Varchar(input.ownerId, 32),
        updateTime: now,
      })
      if (updated !== 1) throw new ConflictException(`线索「${clue.name}」已被其他成员领取`)
      const result = await tx.orm.public.Clue.where({ id: clue.id }).first()
      if (!result) throw new ConflictException(`线索「${clue.name}」已被其他成员领取`)
      return result
    })
  }

  private async finishOwnership(input: ClueMoveToPoolInput, automatic: boolean) {
    const now = input.now ?? BigInt(Date.now())
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(
        this.prisma8.client,
        tx,
        poolTransactionLockKeys('clue', input.organizationId, input.clueId, input.operatorId),
      )
      const [clue, pool] = await Promise.all([
        tx.orm.public.Clue.where({
          id: prisma8Varchar(input.clueId, 32),
          organizationId: prisma8Varchar(input.organizationId, 32),
          inSharedPool: false,
        }).first(),
        tx.orm.public.CluePool.where({
          id: prisma8Varchar(input.poolId, 32),
          organizationId: prisma8Varchar(input.organizationId, 32),
          enable: true,
        }).first(),
      ])
      if (!clue) throw new NotFoundException('线索不存在或已在线索池中')
      if (!pool) throw new NotFoundException('目标线索池不存在或已禁用')
      if (!clue.owner || clue.collectionTime === null)
        throw new BadRequestException('线索当前没有可结束的负责人')

      await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      const updated = await tx.orm.public.Clue.where({ id: clue.id }).update({
        poolId: pool.id,
        inSharedPool: true,
        owner: null,
        collectionTime: null,
        reasonId: automatic
          ? prisma8Varchar('system', 32)
          : input.reasonId
            ? prisma8Varchar(input.reasonId, 32)
            : null,
        updateUser: prisma8Varchar(input.operatorId, 32),
        updateTime: now,
      })
      if (!updated) throw new NotFoundException('线索不存在或已在线索池中')
      return updated
    })
  }

  private async findCapacity(
    tx: Prisma8Transaction,
    organizationId: string,
    ownerId: string,
  ): Promise<number | null> {
    const tokens = await loadUserScopeTokensPrisma8(tx, organizationId, ownerId)
    if (!tokens.size) throw new BadRequestException('负责人不存在或已禁用')
    const capacities = await tx.orm.public.ClueCapacity.where({
      organizationId: prisma8Varchar(organizationId, 32),
    })
      .orderBy((row) => row.createTime.desc())
      .all()
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
    return this.prisma8.client.transaction(async (tx) => {
      await acquirePoolTransactionLocksPrisma8(
        this.prisma8.client,
        tx,
        [`pool:clue:${organizationId}:capacity-config`],
      )
      const incoming = await resolveScopeUserIdsPrisma8(tx, organizationId, input.scopeIds)
      let existingQuery = tx.orm.public.ClueCapacity.where({
        organizationId: prisma8Varchar(organizationId, 32),
      })
      if (capacityId) {
        const excluded = prisma8Varchar(capacityId, 32)
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
      if (!capacityId)
        return tx.orm.public.ClueCapacity.create({
          id: prisma8Id32(),
          organizationId: prisma8Varchar(organizationId, 32),
          scopeId: JSON.stringify(input.scopeIds),
          capacity: input.capacity,
          createTime: now,
          updateTime: now,
          createUser: prisma8Varchar(operatorId, 32),
          updateUser: prisma8Varchar(operatorId, 32),
        })
      const id = prisma8Varchar(capacityId, 32)
      const current = await tx.orm.public.ClueCapacity.where({
        id,
        organizationId: prisma8Varchar(organizationId, 32),
      }).first()
      if (!current) throw new NotFoundException('线索库容规则不存在')
      const updated = await tx.orm.public.ClueCapacity.where({ id }).update({
        scopeId: JSON.stringify(input.scopeIds),
        capacity: input.capacity,
        updateTime: now,
        updateUser: prisma8Varchar(operatorId, 32),
      })
      if (!updated) throw new NotFoundException('线索库容规则不存在')
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
    const id = prisma8Varchar(poolId, 32)
    await Promise.all([
      tx.orm.public.CluePoolHiddenField.where({ poolId: id }).deleteAll(),
      tx.orm.public.CluePoolPickRule.where({ poolId: id }).deleteAll(),
      tx.orm.public.CluePoolRecycleRule.where({ poolId: id }).deleteAll(),
    ])
    const hiddenFieldIds = [...new Set(input.hiddenFieldIds)]
    if (hiddenFieldIds.length) {
      await tx.orm.public.CluePoolHiddenField.createAll(
        hiddenFieldIds.map((fieldId) => ({
          poolId: id,
          fieldId: prisma8Varchar(fieldId, 255),
        })),
      )
    }
    await tx.orm.public.CluePoolPickRule.create({
      id: prisma8Id32(),
      poolId: id,
      limitOnNumber: input.pickRule.limitOnNumber,
      pickNumber: input.pickRule.pickNumber,
      limitPreOwner: input.pickRule.limitPreOwner,
      pickIntervalDays: input.pickRule.pickIntervalDays,
      limitNew: input.pickRule.limitNew,
      newPickInterval: input.pickRule.newPickInterval,
      createUser: prisma8Varchar(operatorId, 32),
      createTime: now,
      updateUser: prisma8Varchar(operatorId, 32),
      updateTime: now,
    })
    await tx.orm.public.CluePoolRecycleRule.create({
      id: prisma8Id32(),
      poolId: id,
      operator: input.recycleRule.operator
        ? prisma8Varchar(input.recycleRule.operator, 10)
        : null,
      condition: input.recycleRule.condition,
      createTime: now,
      updateTime: now,
      createUser: prisma8Varchar(operatorId, 32),
      updateUser: prisma8Varchar(operatorId, 32),
    })
  }

  private async loadPoolView(tx: Prisma8Transaction, poolId: string) {
    const id = prisma8Varchar(poolId, 32)
    const pool = await tx.orm.public.CluePool.where({ id }).first()
    if (!pool) throw new NotFoundException('线索池不存在')
    const [hiddenFields, pickRule, recycleRule] = await Promise.all([
      tx.orm.public.CluePoolHiddenField.where({ poolId: id }).all(),
      tx.orm.public.CluePoolPickRule.where({ poolId: id }).first(),
      tx.orm.public.CluePoolRecycleRule.where({ poolId: id }).first(),
    ])
    return { ...pool, hiddenFields, pickRule, recycleRule }
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
    tx: Prisma8Transaction,
    organizationId: string,
    poolId: string,
  ) {
    const pool = await tx.orm.public.CluePool.where({
      id: prisma8Varchar(poolId, 32),
      organizationId: prisma8Varchar(organizationId, 32),
    }).first()
    if (!pool) throw new NotFoundException('线索池不存在')
    return pool
  }

  private appendOwnerHistory(
    tx: Prisma8Transaction,
    clue: ClueSnapshot,
    operatorId: string,
    reasonId: string | null | undefined,
    endTime: bigint,
  ) {
    if (!clue.owner || clue.collectionTime === null)
      throw new BadRequestException('线索负责人历史快照不完整')
    return tx.orm.public.ClueOwner.create({
      id: prisma8Id32(),
      clueId: prisma8Varchar(clue.id, 32),
      owner: prisma8Varchar(clue.owner, 32),
      collectionTime: clue.collectionTime,
      endTime,
      operator: prisma8Varchar(operatorId, 32),
      reasonId:
        reasonId && reasonId !== 'system' ? prisma8Varchar(reasonId, 32) : null,
    })
  }

  private pickRuleSnapshot(rule: CluePickRuleSnapshot | null) {
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
