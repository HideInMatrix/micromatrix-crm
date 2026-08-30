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
    const directScope = await this.dataScope.directOwnerFilter(user, 'menu:dashboard')
    const opportunityScope = directScope as Prisma.OpportunityWhereInput
    const paymentRecordScope = directScope as Prisma.ContractPaymentRecordWhereInput
    const paymentPlanScope = directScope as Prisma.ContractPaymentPlanWhereInput
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
        this.prisma.contractPaymentRecord.aggregate({
          where: {
            organizationId: tenantId,
            AND: [paymentRecordScope],
            recordEndTime: { gte: BigInt(since.getTime()) },
          },
          _sum: { recordAmount: true },
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

    const overduePlans = await this.prisma.contractPaymentPlan.count({
      where: {
        organizationId: tenantId,
        AND: [paymentPlanScope],
        planEndTime: { lt: BigInt(Date.now()) },
        planStatus: { not: 'COMPLETED' },
      },
    })

    return {
      newLeads,
      newCustomers,
      newOpportunities,
      wonAmount: Number(wonAgg._sum.amount ?? 0),
      receivedAmount: Number(receivedAgg._sum.recordAmount ?? 0),
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
    const since = monthStart()
    const directScope = await this.dataScope.directOwnerFilter(
      user,
      'menu:dashboard',
    )
    const opportunityScope = directScope as Prisma.OpportunityWhereInput
    const paymentRecordScope = directScope as Prisma.ContractPaymentRecordWhereInput

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
      this.prisma.contractPaymentRecord.groupBy({
        by: ['owner'],
        where: {
          organizationId: user.tenantId,
          AND: [paymentRecordScope],
          recordEndTime: { gte: BigInt(since.getTime()) },
        },
        _sum: { recordAmount: true },
      }),
    ])

    const ownerIds = [
      ...new Set([...wonGroups.map((g) => g.owner), ...receivedGroups.map((g) => g.owner)]),
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
          name: nameMap.get(g.owner) ?? '未知',
          amount: Number(g._sum.recordAmount ?? 0),
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10),
    }
  }

  /** 近 6 个月趋势：赢单金额 / 回款金额 */
  async trend(user: AuthUser) {
    const since = monthStart(-5)
    const directScope = await this.dataScope.directOwnerFilter(
      user,
      'menu:dashboard',
    )
    const opportunityScope = directScope as Prisma.OpportunityWhereInput
    const paymentRecordScope = directScope as Prisma.ContractPaymentRecordWhereInput

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
      this.prisma.contractPaymentRecord.findMany({
        where: {
          organizationId: user.tenantId,
          AND: [paymentRecordScope],
          recordEndTime: { gte: BigInt(since.getTime()) },
        },
        select: { recordEndTime: true, recordAmount: true },
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
