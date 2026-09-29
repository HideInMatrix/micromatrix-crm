import { Injectable } from '@nestjs/common'
import { or } from '@prisma/orm-postgres/orm-client'
import { PrismaService } from '../../prisma.service'
import {
  parseStringArray,
  resolveScopeUserIdsPrisma,
} from './pool-repository.helpers'
import { ResourceRecycleConditionEvaluator } from './resource-recycle-condition-evaluator.service'

export interface OverdueLeadSlaItem {
  id: string
  name: string
  ownerId: string
  poolId: string
}

@Injectable()
export class LeadPoolSlaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly evaluator: ResourceRecycleConditionEvaluator,
  ) {}

  async overdue(
    organizationId: string,
    ownerIds: string[] | null,
    now = new Date(),
  ): Promise<OverdueLeadSlaItem[]> {
    if (ownerIds && ownerIds.length === 0) return []

    const pools = await this.prisma.client.orm.public.CluePool.where({
      organizationId,
      enable: true,
    })
      .orderBy((pool) => pool.createTime.desc())
      .all()
    if (!pools.length) return []

    const rules = await this.prisma.client.orm.public.CluePoolRecycleRule.where((rule) =>
      rule.poolId.in(pools.map((pool) => pool.id)),
    ).all()
    const ruleByPool = new Map(rules.map((rule) => [String(rule.poolId), rule]))

    const configuredPools = pools.flatMap((pool) => {
      const rule = ruleByPool.get(String(pool.id))
      if (!rule?.condition) return []
      let conditions: unknown
      try {
        conditions = JSON.parse(rule.condition)
      } catch {
        return []
      }
      if (!this.evaluator.hasValidConditions(conditions)) return []
      return [{ pool, rule, conditions }]
    })
    if (!configuredPools.length) return []

    const poolMembers = await this.prisma.client.transaction(async (tx) => {
      const entries: Array<{ poolId: string; userIds: Set<string> }> = []
      for (const { pool } of configuredPools) {
        entries.push({
          poolId: String(pool.id),
          userIds: await resolveScopeUserIdsPrisma(
            tx,
            organizationId,
            parseStringArray(pool.scopeId),
          ),
        })
      }
      return entries
    })
    const memberByPool = new Map(poolMembers.map((item) => [item.poolId, item.userIds]))

    let query = this.prisma.client.orm.public.Clue.where({
      organizationId,
      inSharedPool: false,
    })
      .where((clue) => clue.owner.isNotNull())
      .where((clue) => or(clue.transitionId.isNull(), clue.transitionId.eq('')))
    if (ownerIds) query = query.where((clue) => clue.owner.in(ownerIds))
    const clues = await query.all()

    const result: OverdueLeadSlaItem[] = []
    for (const clue of clues) {
      const ownerId = clue.owner ? String(clue.owner) : null
      if (!ownerId) continue
      const target = configuredPools.find(({ pool }) =>
        memberByPool.get(String(pool.id))?.has(ownerId),
      )
      if (!target) continue
      if (
        !this.evaluator.matches(
          target.rule.operator,
          target.conditions,
          {
            createdAt: new Date(Number(clue.createTime)),
            collectedAt:
              clue.collectionTime === null ? null : new Date(Number(clue.collectionTime)),
            lastFollowedAt: clue.followTime === null ? null : new Date(Number(clue.followTime)),
          },
          now,
        )
      ) {
        continue
      }
      result.push({
        id: String(clue.id),
        name: String(clue.name),
        ownerId,
        poolId: String(target.pool.id),
      })
    }
    return result
  }
}
