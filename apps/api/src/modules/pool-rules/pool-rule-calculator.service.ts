import { BadRequestException, Injectable } from '@nestjs/common'
import type { ClaimRuleContext } from './pool-domain.types'

export const POOL_DAY_MS = 24n * 60n * 60n * 1000n

/**
 * Clue/Customer 共享的无状态规则计算器。
 *
 * 它只接收快照并返回校验结果，不访问任何数据库；两类资源必须由各自
 * Repository 从各自的 Pool/Capacity/Owner 表构造快照。
 */
@Injectable()
export class PoolRuleCalculator {
  assertClaimAllowed(context: ClaimRuleContext): void {
    this.assertCapacity(
      context.capacity,
      context.ownedCount,
      context.excludedOwnedCount ?? 0,
      context.processCount,
    )

    const rule = context.rule
    if (!rule) return

    if (!context.poolAdmin) {
      this.assertDailyPickLimit(
        rule.limitOnNumber,
        rule.pickNumber,
        context.todayPickedCount,
        context.processCount,
      )
      this.assertNewDataReleased(
        rule.limitNew,
        rule.newPickInterval,
        context.poolEnteredAt,
        context.now,
      )
    }

    if (!context.poolAdmin || context.poolAdminStillChecksPreviousOwner) {
      this.assertPreviousOwnerReleased(
        rule.limitPreOwner,
        rule.pickIntervalDays,
        context.previousOwner,
        context.claimantId,
        context.now,
      )
    }
  }

  assertCapacity(
    capacity: number | null,
    ownedCount: number,
    excludedOwnedCount: number,
    processCount: number,
  ): void {
    if (capacity === null) return
    const effectiveOwned = Math.max(ownedCount - Math.max(excludedOwnedCount, 0), 0)
    const remaining = capacity - effectiveOwned
    if (remaining < processCount) {
      throw new BadRequestException(`库容不足，当前最多还可处理 ${Math.max(remaining, 0)} 条`)
    }
  }

  private assertDailyPickLimit(
    enabled: boolean,
    limit: number | null,
    picked: number,
    processCount: number,
  ): void {
    if (!enabled) return
    if (limit === null || limit < 1) throw new BadRequestException('每日领取规则配置不完整')
    if (picked + processCount > limit) throw new BadRequestException('今日领取数量已达上限')
  }

  private assertNewDataReleased(
    enabled: boolean,
    intervalDays: number | null,
    poolEnteredAt: bigint,
    now: bigint,
  ): void {
    if (!enabled) return
    if (intervalDays === null || intervalDays < 1)
      throw new BadRequestException('新数据保护规则配置不完整')
    const releaseAt = poolEnteredAt + BigInt(intervalDays) * POOL_DAY_MS
    if (now < releaseAt) {
      throw new BadRequestException(
        `该数据需到 ${new Date(Number(releaseAt)).toLocaleString()} 后才能领取`,
      )
    }
  }

  private assertPreviousOwnerReleased(
    enabled: boolean,
    intervalDays: number | null,
    previousOwner: ClaimRuleContext['previousOwner'],
    claimantId: string,
    now: bigint,
  ): void {
    if (!enabled || !previousOwner || previousOwner.owner !== claimantId) return
    if (intervalDays === null || intervalDays < 1)
      throw new BadRequestException('前负责人冷却规则配置不完整')
    const releaseAt = previousOwner.endTime + BigInt(intervalDays) * POOL_DAY_MS
    if (now < releaseAt) {
      throw new BadRequestException(
        `前负责人需到 ${new Date(Number(releaseAt)).toLocaleString()} 后才能再次领取`,
      )
    }
  }
}
