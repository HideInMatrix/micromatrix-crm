import { Injectable } from '@nestjs/common'
import type { AuthUser } from '../../common/auth-user'
import { DataScopeService } from '../../common/services/data-scope.service'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

function monthStart(offset = 0): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth() + offset, 1)
}

@Injectable()
export class HomeOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dataScope: DataScopeService,
  ) {}

  /** 销售简报 + 待办（按数据范围统计） */
  async summary(user: AuthUser) {
    const scope = (await this.dataScope.scopeFilter(user, 'menu:dashboard')) as Record<
      string,
      unknown
    >
    const directScope = await this.dataScope.directOwnerFilter(user, 'menu:dashboard')
    const opportunityScope = directScope as Prisma.OpportunityWhereInput
    const since = monthStart()
    const sinceMs = BigInt(since.getTime())
    const tenantId = user.tenantId

    const [newLeads, newCustomers, newOpportunities, wonAgg, receivedAgg] =
      await this.prisma.$transaction([
        this.prisma.clue.count({
          where: {
            organizationId: tenantId,
            AND: [directScope as Prisma.ClueWhereInput],
            createTime: { gte: BigInt(since.getTime()) },
          },
        }),
        this.prisma.customer.count({
          where: {
            organizationId: tenantId,
            AND: [directScope as Prisma.CustomerWhereInput],
            createTime: { gte: BigInt(since.getTime()) },
            inSharedPool: false,
          },
        }),
        this.prisma.opportunity.count({
          where: {
            organizationId: tenantId,
            AND: [opportunityScope],
            createTime: { gte: sinceMs },
          },
        }),
        this.prisma.opportunity.aggregate({
          where: {
            organizationId: tenantId,
            AND: [opportunityScope],
            stageConfig: { type: 'END', rate: '100' },
            actualEndTime: { gte: sinceMs },
          },
          _sum: { amount: true },
        }),
        this.prisma.receivableRecord.aggregate({
          where: {
            tenantId,
            AND: [scope as Prisma.ReceivableRecordWhereInput],
            receivedAt: { gte: since },
            approvalStatus: { in: ['NONE', 'APPROVED'] },
          },
          _sum: { amount: true },
        }),
      ])

    const [pendingApprovals, upcomingFollows] = await this.prisma.$transaction([
      this.prisma.approvalTask.count({
        where: { tenantId, approverId: user.id, status: 'PENDING' },
      }),
      this.prisma.followUpRecord.count({
        where: {
          tenantId,
          ownerId: user.id,
          nextFollowAt: {
            gte: new Date(Date.now() - 24 * 3600 * 1000),
            lte: new Date(Date.now() + 3 * 24 * 3600 * 1000),
          },
        },
      }),
    ])

    const plans = await this.prisma.receivablePlan.findMany({
      where: {
        tenantId,
        dueDate: { lt: new Date() },
        contract: { AND: [scope as Prisma.ContractWhereInput] },
      },
      include: { records: { select: { amount: true, approvalStatus: true } } },
    })
    const overduePlans = plans.filter((p) => {
      const paid = p.records
        .filter((r) => r.approvalStatus === 'NONE' || r.approvalStatus === 'APPROVED')
        .reduce((sum, r) => sum + Number(r.amount), 0)
      return paid < Number(p.amount)
    }).length

    return {
      newLeads,
      newCustomers,
      newOpportunities,
      wonAmount: Number(wonAgg._sum.amount ?? 0),
      receivedAmount: Number(receivedAgg._sum.amount ?? 0),
      pendingApprovals,
      upcomingFollows,
      overduePlans,
    }
  }

  /** 商机漏斗（按阶段） */
  async funnel(user: AuthUser) {
    const scope = (await this.dataScope.directOwnerFilter(
      user,
      'menu:dashboard',
    )) as Prisma.OpportunityWhereInput
    const stages = await this.prisma.opportunityStageConfig.findMany({
      where: { organizationId: user.tenantId },
      orderBy: { pos: 'asc' },
    })
    const grouped = await this.prisma.opportunity.groupBy({
      by: ['stage'],
      where: { organizationId: user.tenantId, AND: [scope] },
      _count: { _all: true },
      _sum: { amount: true },
    })
    const map = new Map(grouped.map((g) => [g.stage, g]))
    return stages
      .filter((s) => !(s.type === 'END' && Number(s.rate) === 0))
      .map((s) => ({
        name: s.name,
        probability: Number(s.rate),
        isWon: s.type === 'END' && Number(s.rate) === 100,
        count: map.get(s.id)?._count._all ?? 0,
        amount: Number(map.get(s.id)?._sum.amount ?? 0),
      }))
  }

  /** 本月业绩排行（赢单金额 / 回款金额 TOP10） */
  async ranking(user: AuthUser) {
    const scope = (await this.dataScope.scopeFilter(user, 'menu:dashboard')) as Record<
      string,
      unknown
    >
    const since = monthStart()
    const opportunityScope = (await this.dataScope.directOwnerFilter(
      user,
      'menu:dashboard',
    )) as Prisma.OpportunityWhereInput

    const [wonGroups, receivedGroups] = await Promise.all([
      this.prisma.opportunity.groupBy({
        by: ['owner'],
        where: {
          organizationId: user.tenantId,
          AND: [opportunityScope],
          stageConfig: { type: 'END', rate: '100' },
          actualEndTime: { gte: BigInt(since.getTime()) },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.receivableRecord.groupBy({
        by: ['ownerId'],
        where: {
          tenantId: user.tenantId,
          AND: [scope as Prisma.ReceivableRecordWhereInput],
          receivedAt: { gte: since },
          approvalStatus: { in: ['NONE', 'APPROVED'] },
          ownerId: { not: null },
        },
        _sum: { amount: true },
      }),
    ])

    const ownerIds = [
      ...new Set([...wonGroups.map((g) => g.owner), ...receivedGroups.map((g) => g.ownerId)]),
    ].filter((v): v is string => !!v)
    const users = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, name: true },
        })
      : []
    const nameMap = new Map(users.map((u) => [u.id, u.name]))

    return {
      won: wonGroups
        .map((g) => ({
          name: nameMap.get(g.owner) ?? '未知',
          amount: Number(g._sum.amount ?? 0),
          count: g._count._all,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
      received: receivedGroups
        .map((g) => ({
          name: nameMap.get(g.ownerId!) ?? '未知',
          amount: Number(g._sum.amount ?? 0),
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    }
  }

  /** 近 6 个月趋势：赢单金额 / 回款金额 */
  async trend(user: AuthUser) {
    const scope = (await this.dataScope.scopeFilter(user, 'menu:dashboard')) as Record<
      string,
      unknown
    >
    const since = monthStart(-5)
    const opportunityScope = (await this.dataScope.directOwnerFilter(
      user,
      'menu:dashboard',
    )) as Prisma.OpportunityWhereInput

    const [wonList, receivedList] = await Promise.all([
      this.prisma.opportunity.findMany({
        where: {
          organizationId: user.tenantId,
          AND: [opportunityScope],
          stageConfig: { type: 'END', rate: '100' },
          actualEndTime: { gte: BigInt(since.getTime()) },
        },
        select: { actualEndTime: true, amount: true },
      }),
      this.prisma.receivableRecord.findMany({
        where: {
          tenantId: user.tenantId,
          AND: [scope as Prisma.ReceivableRecordWhereInput],
          receivedAt: { gte: since },
          approvalStatus: { in: ['NONE', 'APPROVED'] },
        },
        select: { receivedAt: true, amount: true },
      }),
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
      const key = `${r.receivedAt.getFullYear()}-${String(r.receivedAt.getMonth() + 1).padStart(2, '0')}`
      if (receivedByMonth.has(key)) {
        receivedByMonth.set(key, receivedByMonth.get(key)! + Number(r.amount))
      }
    }

    return {
      months,
      won: months.map((m) => Math.round(wonByMonth.get(m)! * 100) / 100),
      received: months.map((m) => Math.round(receivedByMonth.get(m)! * 100) / 100),
    }
  }

  /** 线索转化与输单原因 */
  async conversion(user: AuthUser) {
    const directScope = await this.dataScope.directOwnerFilter(user, 'menu:dashboard')
    const opportunityScope = directScope as Prisma.OpportunityWhereInput
    const since = monthStart(-5)

    const [totalLeads, convertedLeads, lostGroups] = await Promise.all([
      this.prisma.clue.count({
        where: {
          organizationId: user.tenantId,
          AND: [directScope as Prisma.ClueWhereInput],
          createTime: { gte: BigInt(since.getTime()) },
        },
      }),
      this.prisma.clue.count({
        where: {
          organizationId: user.tenantId,
          AND: [directScope as Prisma.ClueWhereInput],
          createTime: { gte: BigInt(since.getTime()) },
          transitionId: { not: null },
        },
      }),
      this.prisma.opportunity.groupBy({
        by: ['failureReason'],
        where: {
          organizationId: user.tenantId,
          AND: [opportunityScope],
          stageConfig: { type: 'END', rate: '0' },
          actualEndTime: { not: null },
        },
        _count: { _all: true },
      }),
    ])

    return {
      totalLeads,
      convertedLeads,
      conversionRate: totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 1000) / 10 : 0,
      lostReasons: lostGroups.map((g) => ({
        reason: g.failureReason?.trim() || '未填写',
        count: g._count._all,
      })),
    }
  }
}
