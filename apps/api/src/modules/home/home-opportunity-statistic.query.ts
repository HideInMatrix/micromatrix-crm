import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  HomeOpportunityStatistic,
  HomeStatisticPeriod,
  HomeStatisticRequest,
  HomeStatisticValue,
  HomeTimeField,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma8Service } from '../../prisma/prisma8.service'
import { prisma8Varchar, prisma8Varchars } from '../../prisma/prisma8-varchar'
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomePeriodService } from './home-period.service'

export type OpportunityScenario = 'ALL' | 'UNDERWAY' | 'SUCCESS'

const PERIOD_KEYS: Record<
  HomeStatisticPeriod,
  { count: keyof HomeOpportunityStatistic; amount: keyof HomeOpportunityStatistic }
> = {
  TODAY: { count: 'todayOpportunity', amount: 'todayOpportunityAmount' },
  THIS_WEEK: { count: 'thisWeekOpportunity', amount: 'thisWeekOpportunityAmount' },
  THIS_MONTH: { count: 'thisMonthOpportunity', amount: 'thisMonthOpportunityAmount' },
  THIS_YEAR: { count: 'thisYearOpportunity', amount: 'thisYearOpportunityAmount' },
}

type HomeOpportunityWhere = {
  organizationId?: string
  owner?: string | { in: string[] }
  stageConfig?: { type?: string; rate?: string }
  createTime?: { gte: bigint; lte: bigint }
  expectedEndTime?: { gte: bigint; lte: bigint }
  actualEndTime?: { gte: bigint; lte: bigint }
  AND?: HomeOpportunityWhere[]
}

@Injectable()
export class HomeOpportunityStatisticQuery {
  constructor(
    private readonly prisma8: Prisma8Service,
    private readonly scopes: HomeDepartmentScopeService,
    private readonly periods: HomePeriodService,
  ) {}

  async execute(
    user: AuthUser,
    request: HomeStatisticRequest,
    scenario: OpportunityScenario,
  ): Promise<HomeOpportunityStatistic> {
    const result = {} as HomeOpportunityStatistic
    await Promise.all(
      (Object.keys(PERIOD_KEYS) as HomeStatisticPeriod[]).map(async (period) => {
        const { count, amount } = await this.periodValue(user, request, period, scenario)
        result[PERIOD_KEYS[period].count] = count
        result[PERIOD_KEYS[period].amount] = amount
      }),
    )
    return result
  }

  async whereForPeriod(
    user: AuthUser,
    request: HomeStatisticRequest,
    period: HomeStatisticPeriod,
    scenario: OpportunityScenario,
  ): Promise<HomeOpportunityWhere> {
    const scope = await this.scopes.resolve(
      user,
      'menu:opportunity',
      request.searchType,
      request.deptIds ?? [],
    )
    const range = this.periods.range(period)
    return this.where(user, request, scope, range.start, range.end, scenario)
  }

  private async periodValue(
    user: AuthUser,
    request: HomeStatisticRequest,
    period: HomeStatisticPeriod,
    scenario: OpportunityScenario,
  ) {
    const scope = await this.scopes.resolve(
      user,
      'menu:opportunity',
      request.searchType,
      request.deptIds ?? [],
    )
    const range = this.periods.range(period)
    const current = await this.aggregateRange(user, request, scope, range.start, range.end, scenario)
    const value = current.value
    const amount = current.amount
    if (!request.priorPeriodEnable) {
      return {
        count: { value, priorPeriodCompareRate: null } satisfies HomeStatisticValue,
        amount: { value: amount, priorPeriodCompareRate: null } satisfies HomeStatisticValue,
      }
    }

    const previous = await this.aggregateRange(
      user,
      request,
      scope,
      range.previousStart,
      range.previousEnd,
      scenario,
    )
    return {
      count: { value, priorPeriodCompareRate: this.compare(value, previous.value) },
      amount: { value: amount, priorPeriodCompareRate: this.compare(amount, previous.amount) },
    }
  }

  private async aggregateRange(
    user: AuthUser,
    request: HomeStatisticRequest,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
    start: Date,
    end: Date,
    scenario: OpportunityScenario,
  ): Promise<{ value: number; amount: number }> {
    if (!scope.all && !scope.self && (scope.userIds?.length ?? 0) === 0) {
      return { value: 0, amount: 0 }
    }

    const stageIds = await this.stageIds(user.tenantId, scenario)
    if (scenario !== 'ALL' && stageIds.length === 0) return { value: 0, amount: 0 }

    let query = this.prisma8.client.orm.public.Opportunity.where({
      organizationId: prisma8Varchar(user.tenantId, 32),
    })
    if (!scope.all) {
      query = scope.self
        ? query.where({ owner: prisma8Varchar(user.id, 32) })
        : query.where((row) => row.owner.in(prisma8Varchars(scope.userIds ?? [], 32)))
    }
    if (stageIds.length) {
      query = query.where((row) => row.stage.in(prisma8Varchars(stageIds, 32)))
    }

    const field = this.timeField(request, scenario)
    const startMs = BigInt(start.getTime())
    const endMs = BigInt(end.getTime())
    query =
      field === 'CREATE_TIME'
        ? query.where((row) => row.createTime.gte(startMs)).where((row) => row.createTime.lte(endMs))
        : field === 'EXPECTED_END_TIME'
          ? query
              .where((row) => row.expectedEndTime.gte(startMs))
              .where((row) => row.expectedEndTime.lte(endMs))
          : query
              .where((row) => row.actualEndTime.gte(startMs))
              .where((row) => row.actualEndTime.lte(endMs))

    const aggregate = await query.aggregate((agg) => ({
      total: agg.count(),
      amount: agg.sum('amount'),
    }))
    return { value: aggregate.total, amount: Number(aggregate.amount ?? 0) }
  }

  private async stageIds(tenantId: string, scenario: OpportunityScenario): Promise<string[]> {
    if (scenario === 'ALL') return []
    const rows = await this.prisma8.client.orm.public.OpportunityStageConfig.where({
      organizationId: prisma8Varchar(tenantId, 32),
      _type: prisma8Varchar(scenario === 'SUCCESS' ? 'END' : 'AFOOT', 50),
      ...(scenario === 'SUCCESS' ? { rate: prisma8Varchar('100', 10) } : {}),
    })
      .select('id')
      .all()
    return rows.map((row) => row.id)
  }

  private where(
    user: AuthUser,
    request: HomeStatisticRequest,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
    start: Date,
    end: Date,
    scenario: OpportunityScenario,
  ): HomeOpportunityWhere {
    const timeField = this.timeField(request, scenario)
    const timeFilter = this.timeFilter(timeField, start, end)
    const scopeFilter: HomeOpportunityWhere = scope.all
      ? {}
      : scope.self
        ? { owner: user.id }
        : scope.userIds?.length
          ? { owner: { in: scope.userIds } }
          : { owner: '__home_scope_empty__' }
    const stageFilter: HomeOpportunityWhere =
      scenario === 'SUCCESS'
        ? { stageConfig: { type: 'END', rate: '100' } }
        : scenario === 'UNDERWAY'
          ? { stageConfig: { type: 'AFOOT' } }
          : {}
    return {
      organizationId: user.tenantId,
      AND: [scopeFilter, stageFilter, timeFilter],
    }
  }

  private timeField(request: HomeStatisticRequest, scenario: OpportunityScenario): HomeTimeField {
    if (scenario === 'SUCCESS') {
      return request.winOrderTimeField ?? request.timeField ?? 'EXPECTED_END_TIME'
    }
    const field = request.timeField ?? 'CREATE_TIME'
    if (field === 'ACTUAL_END_TIME') {
      throw new BadRequestException('普通/进行中商机统计不支持实际结束时间')
    }
    return field
  }

  private timeFilter(field: HomeTimeField, start: Date, end: Date): HomeOpportunityWhere {
    const range = { gte: BigInt(start.getTime()), lte: BigInt(end.getTime()) }
    if (field === 'CREATE_TIME') return { createTime: range }
    if (field === 'EXPECTED_END_TIME') return { expectedEndTime: range }
    return { actualEndTime: range }
  }

  private compare(value: number, previous: number) {
    return previous === 0 ? null : ((value - previous) * 100) / previous
  }
}
