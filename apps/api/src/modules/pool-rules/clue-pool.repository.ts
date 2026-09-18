import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { Prisma8Client } from '../../prisma/prisma8-client'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { createLegacyId32 } from '../../common/legacy-id'
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
    const organization = organizationId
    const pools = await this.prisma8.client.orm.public.CluePool.where({
      organizationId: organization,
    })
      .orderBy((pool) => pool.createTime.asc())
      .all()
    if (!pools.length) return []
    const poolIds = pools.map((pool) => pool.id)
    const [hiddenFields, pickRules, recycleRules] = await Promise.all([
      this.prisma8.client.orm.public.CluePoolHiddenField.where((row) =>
        row.poolId.in(poolIds),
      ).all(),
      this.prisma8.client.orm.public.CluePoolPickRule.where((row) => row.poolId.in(poolIds)).all(),
      this.prisma8.client.orm.public.CluePoolRecycleRule.where((row) =>
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
    return this.prisma8.client.orm.public.ClueCapacity.where({
      organizationId: organizationId,
    })
      .orderBy((row) => row.createTime.asc())
      .all()
  }

  async listOwnerHistory(organizationId: string, clueId: string) {
    const clue = await this.prisma8.client.orm.public.Clue.where({
      id: clueId,
      organizationId: organizationId,
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
      const updated = await tx.orm.public.CluePool.where({ id }).update({
        name: input.name.trim(),
        scopeId: JSON.stringify(input.scopeIds),
        ownerId: JSON.stringify(input.ownerIds),
        enable: input.enable,
        auto: input.auto,
        updateTime: now,
        updateUser: operatorId,
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
        updateUser: operatorId,
      })
      if (!updated) throw new NotFoundException('线索池不存在')
      return updated
    })
  }

  async deletePool(organizationId: string, poolId: string) {
    return this.prisma8.client.transaction(async (tx) => {
      const pool = await this.assertPoolExists(tx, organizationId, poolId)
      const linked = await tx.orm.public.Clue.where({
        organizationId: organizationId,
        poolId: pool.id,
        inSharedPool: true,
      }).aggregate((agg) => ({ count: agg.count() }))
      if (linked.count) throw new BadRequestException('线索池中仍有未领取线索，不能删除')
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
      id: capacityId,
      organizationId: organizationId,
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
        id: input.clueId,
        organizationId: input.organizationId,
        inSharedPool: false,
      }).first()
      if (!clue) throw new NotFoundException('线索不存在或已在线索池中')
      if (!clue.owner || clue.collectionTime === null)
        throw new BadRequestException('线索当前没有可转移的负责人')
      if (clue.owner === input.ownerId) return clue

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const owned = await tx.orm.public.Clue.where({
        organizationId: input.organizationId,
        owner: input.ownerId,
        inSharedPool: false,
      })
        .where((row) => row.transitionType.neq('CUSTOMER'))
        .aggregate((agg) => ({ count: agg.count() }))
      this.calculator.assertCapacity(capacity, owned.count, 0, 1)
      await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      const updated = await tx.orm.public.Clue.where({ id: clue.id }).update({
        owner: input.ownerId,
        collectionTime: now,
        reasonId: input.reasonId ? input.reasonId : null,
        updateUser: input.operatorId,
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
        organizationId: input.organizationId,
        inSharedPool: false,
      })
        .where((row) => row.id.in(clueIds))
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
        organizationId: input.organizationId,
        owner: input.ownerId,
        inSharedPool: false,
        transitionId: null,
      }).aggregate((agg) => ({ count: agg.count() }))
      this.calculator.assertCapacity(capacity, owned.count, 0, changed.length)

      for (const clue of changed) {
        await this.appendOwnerHistory(tx, clue, input.operatorId, input.reasonId, now)
      }
      const count = await tx.orm.public.Clue.where({
        organizationId: input.organizationId,
      })
        .where((row) => row.id.in(changed.map((clue) => clue.id)))
        .updateAndCount({
          owner: input.ownerId,
          collectionTime: now,
          reasonId: input.reasonId ? input.reasonId : null,
          updateUser: input.operatorId,
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
        id: input.clueId,
        organizationId: input.organizationId,
      }).first()
      if (!clue) throw new NotFoundException('线索不存在')
      const pool = clue.poolId
        ? await tx.orm.public.CluePool.where({
            id: clue.poolId,
            organizationId: input.organizationId,
            enable: true,
          }).first()
        : null
      if (!clue.inSharedPool || !clue.poolId || !pool)
        throw new ConflictException(`线索「${clue.name}」已被领取或所在池已禁用`)
      const pickRule = await tx.orm.public.CluePoolPickRule.where({ poolId: pool.id }).first()

      const capacity = await this.findCapacity(tx, input.organizationId, input.ownerId)
      const [owned, todayPicked, previousOwner] = await Promise.all([
        tx.orm.public.Clue.where({
          organizationId: input.organizationId,
          owner: input.ownerId,
          inSharedPool: false,
        })
          .where((row) => row.transitionType.neq('CUSTOMER'))
          .aggregate((agg) => ({ count: agg.count() })),
        tx.orm.public.Clue.where({
          organizationId: input.organizationId,
          owner: input.ownerId,
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
        organizationId: input.organizationId,
        poolId: clue.poolId,
        inSharedPool: true,
      }).updateAndCount({
        poolId: null,
        inSharedPool: false,
        owner: input.ownerId,
        collectionTime: now,
        stage: 'FOLLOWING',
        updateUser: input.ownerId,
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
          id: input.clueId,
          organizationId: input.organizationId,
          inSharedPool: false,
        }).first(),
        tx.orm.public.CluePool.where({
          id: input.poolId,
          organizationId: input.organizationId,
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
        reasonId: automatic ? 'system' : input.reasonId ? input.reasonId : null,
        updateUser: input.operatorId,
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
      organizationId: organizationId,
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
      await acquirePoolTransactionLocksPrisma8(this.prisma8.client, tx, [
        `pool:clue:${organizationId}:capacity-config`,
      ])
      const incoming = await resolveScopeUserIdsPrisma8(tx, organizationId, input.scopeIds)
      let existingQuery = tx.orm.public.ClueCapacity.where({
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
      if (!capacityId)
        return tx.orm.public.ClueCapacity.create({
          id: createLegacyId32(),
          organizationId: organizationId,
          scopeId: JSON.stringify(input.scopeIds),
          capacity: input.capacity,
          createTime: now,
          updateTime: now,
          createUser: operatorId,
          updateUser: operatorId,
        })
      const id = capacityId
      const current = await tx.orm.public.ClueCapacity.where({
        id,
        organizationId: organizationId,
      }).first()
      if (!current) throw new NotFoundException('线索库容规则不存在')
      const updated = await tx.orm.public.ClueCapacity.where({ id }).update({
        scopeId: JSON.stringify(input.scopeIds),
        capacity: input.capacity,
        updateTime: now,
        updateUser: operatorId,
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
    const id = poolId
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
          fieldId: fieldId,
        })),
      )
    }
    await tx.orm.public.CluePoolPickRule.create({
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
    await tx.orm.public.CluePoolRecycleRule.create({
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

  private async assertPoolExists(tx: Prisma8Transaction, organizationId: string, poolId: string) {
    const pool = await tx.orm.public.CluePool.where({
      id: poolId,
      organizationId: organizationId,
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
      id: createLegacyId32(),
      clueId: clue.id,
      owner: clue.owner,
      collectionTime: clue.collectionTime,
      endTime,
      operator: operatorId,
      reasonId: reasonId && reasonId !== 'system' ? reasonId : null,
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
