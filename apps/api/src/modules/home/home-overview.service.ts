import { Injectable, Optional } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { PrismaService } from '../../prisma/prisma.service'
import { instantFromEpochMilliseconds } from '../../prisma/temporal'

import { homeCacheUserContext } from './home-cache-context'

function monthStart(offset = 0): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + offset, 1)
}

@Injectable()
export class HomeOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  summary(user: AuthUser) {
    return this.remember(user, 'summary', () => this.loadSummary(user))
  }

  funnel(user: AuthUser) {
    return this.remember(user, 'funnel', () => this.loadFunnel(user))
  }

  ranking(user: AuthUser) {
    return this.remember(user, 'ranking', () => this.loadRanking(user))
  }

  trend(user: AuthUser) {
    return this.remember(user, 'trend', () => this.loadTrend(user))
  }

  conversion(user: AuthUser) {
    return this.remember(user, 'conversion', () => this.loadConversion(user))
  }

  /** 销售简报 + 待办（按数据范围统计） */
  private async loadSummary(user: AuthUser) {
    const ownerIds = await this.ownerIds(user)
    const since = monthStart()
    const sinceMs = BigInt(since.getTime())
    const organizationId = user.tenantId
    const wonStageIds = await this.stageIds(user.tenantId, 'END', '100')

    let leads = this.prisma.client.orm.public.Clue.where({ organizationId }).where((row) =>
      row.createTime.gte(sinceMs),
    )
    let customers = this.prisma.client.orm.public.Customer.where({
      organizationId,
      inSharedPool: false,
    }).where((row) => row.createTime.gte(sinceMs))
    let opportunities = this.prisma.client.orm.public.Opportunity.where({ organizationId }).where(
      (row) => row.createTime.gte(sinceMs),
    )
    let won = this.prisma.client.orm.public.Opportunity.where({ organizationId }).where((row) =>
      row.actualEndTime.gte(sinceMs),
    )
    let received = this.prisma.client.orm.public.ContractPaymentRecord.where({
      organizationId,
    }).where((row) => row.recordEndTime.gte(sinceMs))
    let overdue = this.prisma.client.orm.public.ContractPaymentPlan.where({ organizationId })
      .where((row) => row.planEndTime.lt(BigInt(Date.now())))
      .where((row) => row.planStatus.neq('COMPLETED'))

    if (ownerIds !== null) {
      const scoped = ownerIds
      leads = leads.where((row) => row.owner.in(scoped))
      customers = customers.where((row) => row.owner.in(scoped))
      opportunities = opportunities.where((row) => row.owner.in(scoped))
      won = won.where((row) => row.owner.in(scoped))
      received = received.where((row) => row.owner.in(scoped))
      overdue = overdue.where((row) => row.owner.in(scoped))
    }
    if (wonStageIds.length) {
      won = won.where((row) => row.stage.in(wonStageIds))
    } else {
      won = won.where((row) => row.stage.in([]))
    }

    const now = Date.now()
    const [
      newLeadAgg,
      newCustomerAgg,
      newOpportunityAgg,
      wonAgg,
      receivedAgg,
      approvalAgg,
      followAgg,
      overdueAgg,
    ] = await Promise.all([
      leads.aggregate((agg) => ({ count: agg.count() })),
      customers.aggregate((agg) => ({ count: agg.count() })),
      opportunities.aggregate((agg) => ({ count: agg.count() })),
      won.aggregate((agg) => ({ amount: agg.sum('amount') })),
      received.aggregate((agg) => ({ amount: agg.sum('recordAmount') })),
      this.prisma.client.orm.public.ApprovalTasks.where({
        tenantId: user.tenantId,
        approverId: user.id,
        status: 'PENDING',
      }).aggregate((agg) => ({ count: agg.count() })),
      this.prisma.client.orm.public.FollowUpPlans.where({
        tenantId: user.tenantId,
        ownerId: user.id,
      })
        .where((row) => row.status.in(['PREPARED', 'UNDERWAY']))
        .where((row) => row.estimatedAt.gte(instantFromEpochMilliseconds(now - 24 * 3600 * 1000)))
        .where((row) =>
          row.estimatedAt.lte(instantFromEpochMilliseconds(now + 3 * 24 * 3600 * 1000)),
        )
        .aggregate((agg) => ({ count: agg.count() })),
      overdue.aggregate((agg) => ({ count: agg.count() })),
    ])

    return {
      newLeads: newLeadAgg.count,
      newCustomers: newCustomerAgg.count,
      newOpportunities: newOpportunityAgg.count,
      wonAmount: Number(wonAgg.amount ?? 0),
      receivedAmount: Number(receivedAgg.amount ?? 0),
      pendingApprovals: approvalAgg.count,
      upcomingFollows: followAgg.count,
      overduePlans: overdueAgg.count,
    }
  }

  /** 商机漏斗（按阶段） */
  private async loadFunnel(user: AuthUser) {
    const ownerIds = await this.ownerIds(user)
    const organizationId = user.tenantId
    const stages = await this.prisma.client.orm.public.OpportunityStageConfig.where({
      organizationId,
    })
      .orderBy((row) => row.pos.asc())
      .all()
    let opportunities = this.prisma.client.orm.public.Opportunity.where({ organizationId })
    if (ownerIds !== null) {
      opportunities = opportunities.where((row) => row.owner.in(ownerIds))
    }
    const grouped = await opportunities
      .groupBy('stage')
      .aggregate((agg) => ({ count: agg.count(), amount: agg.sum('amount') }))
    const map = new Map(grouped.map((g) => [g.stage, g]))
    return stages
      .filter((s) => !(s._type === 'END' && Number(s.rate) === 0))
      .map((s) => ({
        name: s.name,
        probability: Number(s.rate),
        isWon: s._type === 'END' && Number(s.rate) === 100,
        count: map.get(s.id)?.count ?? 0,
        amount: Number(map.get(s.id)?.amount ?? 0),
      }))
  }

  /** 本月业绩排行（赢单金额 / 回款金额 TOP10） */
  private async loadRanking(user: AuthUser) {
    const since = monthStart()
    const ownerIds = await this.ownerIds(user)
    const organizationId = user.tenantId
    const wonStageIds = await this.stageIds(user.tenantId, 'END', '100')
    let won = this.prisma.client.orm.public.Opportunity.where({ organizationId }).where((row) =>
      row.actualEndTime.gte(BigInt(since.getTime())),
    )
    let received = this.prisma.client.orm.public.ContractPaymentRecord.where({
      organizationId,
    }).where((row) => row.recordEndTime.gte(BigInt(since.getTime())))
    if (ownerIds !== null) {
      const scoped = ownerIds
      won = won.where((row) => row.owner.in(scoped))
      received = received.where((row) => row.owner.in(scoped))
    }
    if (wonStageIds.length) {
      won = won.where((row) => row.stage.in(wonStageIds))
    } else {
      won = won.where((row) => row.stage.in([]))
    }

    const [wonGroups, receivedGroups] = await Promise.all([
      won.groupBy('owner').aggregate((agg) => ({ amount: agg.sum('amount'), count: agg.count() })),
      received.groupBy('owner').aggregate((agg) => ({ amount: agg.sum('recordAmount') })),
    ])

    const rankingOwnerIds = [
      ...new Set([
        ...wonGroups.map((group) => String(group.owner)),
        ...receivedGroups.map((group) => String(group.owner)),
      ]),
    ].filter(Boolean)
    const users = rankingOwnerIds.length
      ? await this.prisma.client.orm.public.Users.where({ tenantId: user.tenantId })
          .where((row) => row.id.in(rankingOwnerIds))
          .select('id', 'name')
          .all()
      : []
    const nameMap = new Map(users.map((u) => [String(u.id), u.name]))

    return {
      won: wonGroups
        .map((g) => ({
          name: nameMap.get(String(g.owner)) ?? '未知',
          amount: Number(g.amount ?? 0),
          count: g.count,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
      received: receivedGroups
        .map((g) => ({
          name: nameMap.get(String(g.owner)) ?? '未知',
          amount: Number(g.amount ?? 0),
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    }
  }

  /** 近 6 个月趋势：赢单金额 / 回款金额 */
  private async loadTrend(user: AuthUser) {
    const since = monthStart(-5)
    const ownerIds = await this.ownerIds(user)
    const organizationId = user.tenantId
    const wonStageIds = await this.stageIds(user.tenantId, 'END', '100')
    let won = this.prisma.client.orm.public.Opportunity.where({ organizationId }).where((row) =>
      row.actualEndTime.gte(BigInt(since.getTime())),
    )
    let received = this.prisma.client.orm.public.ContractPaymentRecord.where({
      organizationId,
    }).where((row) => row.recordEndTime.gte(BigInt(since.getTime())))
    if (ownerIds !== null) {
      const scoped = ownerIds
      won = won.where((row) => row.owner.in(scoped))
      received = received.where((row) => row.owner.in(scoped))
    }
    if (wonStageIds.length) {
      won = won.where((row) => row.stage.in(wonStageIds))
    } else {
      won = won.where((row) => row.stage.in([]))
    }

    const [wonList, receivedList] = await Promise.all([
      won.select('actualEndTime', 'amount').all(),
      received.select('recordEndTime', 'recordAmount').all(),
    ])

    const months: string[] = []
    for (let i = -5; i <= 0; i++) {
      const d = monthStart(i)
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const wonByMonth = new Map(months.map((m) => [m, 0]))
    const receivedByMonth = new Map(months.map((m) => [m, 0]))
    for (const o of wonList) {
      if (!o.actualEndTime) continue
      const wonAt = new Date(Number(o.actualEndTime))
      const key = `${wonAt.getFullYear()}-${String(wonAt.getMonth() + 1).padStart(2, '0')}`
      if (wonByMonth.has(key)) wonByMonth.set(key, wonByMonth.get(key)! + Number(o.amount ?? 0))
    }
    for (const r of receivedList) {
      if (r.recordEndTime === null) continue
      const receivedAt = new Date(Number(r.recordEndTime))
      const key = `${receivedAt.getFullYear()}-${String(receivedAt.getMonth() + 1).padStart(2, '0')}`
      if (receivedByMonth.has(key)) {
        receivedByMonth.set(key, receivedByMonth.get(key)! + Number(r.recordAmount ?? 0))
      }
    }

    return {
      months,
      won: months.map((m) => Math.round(wonByMonth.get(m)! * 100) / 100),
      received: months.map((m) => Math.round(receivedByMonth.get(m)! * 100) / 100),
    }
  }

  /** 线索转化与输单原因 */
  private async loadConversion(user: AuthUser) {
    const ownerIds = await this.ownerIds(user)
    const since = monthStart(-5)
    const organizationId = user.tenantId
    const lostStageIds = await this.stageIds(user.tenantId, 'END', '0')
    let leads = this.prisma.client.orm.public.Clue.where({ organizationId }).where((row) =>
      row.createTime.gte(BigInt(since.getTime())),
    )
    let lost = this.prisma.client.orm.public.Opportunity.where({ organizationId }).where((row) =>
      row.actualEndTime.isNotNull(),
    )
    if (ownerIds !== null) {
      const scoped = ownerIds
      leads = leads.where((row) => row.owner.in(scoped))
      lost = lost.where((row) => row.owner.in(scoped))
    }
    if (lostStageIds.length) {
      lost = lost.where((row) => row.stage.in(lostStageIds))
    } else {
      lost = lost.where((row) => row.stage.in([]))
    }

    const [totalLeads, convertedLeads, lostGroups] = await Promise.all([
      leads.aggregate((agg) => ({ count: agg.count() })),
      leads
        .where((row) => row.transitionId.isNotNull())
        .aggregate((agg) => ({ count: agg.count() })),
      lost.groupBy('failureReason').aggregate((agg) => ({ count: agg.count() })),
    ])

    return {
      totalLeads: totalLeads.count,
      convertedLeads: convertedLeads.count,
      conversionRate:
        totalLeads.count > 0
          ? Math.round((convertedLeads.count / totalLeads.count) * 1000) / 10
          : 0,
      lostReasons: lostGroups.map((g) => ({
        reason: g.failureReason?.trim() || '未填写',
        count: g.count,
      })),
    }
  }

  private async ownerIds(user: AuthUser): Promise<string[] | null> {
    const filter = await this.dataScope.directOwnerFilter(user, 'menu:dashboard')
    if (!filter.owner) return null
    return typeof filter.owner === 'string' ? [filter.owner] : filter.owner.in
  }

  private async stageIds(tenantId: string, type: 'AFOOT' | 'END', rate?: string) {
    const rows = await this.prisma.client.orm.public.OpportunityStageConfig.where({
      organizationId: tenantId,
      _type: type,
      ...(rate ? { rate: rate } : {}),
    })
      .select('id')
      .all()
    return rows.map((row) => String(row.id))
  }

  private remember<T>(user: AuthUser, method: string, loader: () => Promise<T>): Promise<T> {
    if (!this.cache) return loader()
    const key = this.cache.fingerprint({ method, user: homeCacheUserContext(user) })
    return this.cache.remember({
      tenantId: user.tenantId,
      namespace: 'home-overview',
      key,
      ttlSeconds: 30,
      versioned: false,
      loader,
    })
  }
}
