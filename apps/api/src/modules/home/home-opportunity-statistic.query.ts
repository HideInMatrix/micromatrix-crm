import { BadRequestException, Injectable } from '@nestjs/common'
import type {
  HomeOpportunityStatistic,
  HomeStatisticPeriod,
  HomeStatisticRequest,
  HomeStatisticValue,
  HomeTimeField,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
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

@Injectable()
export class HomeOpportunityStatisticQuery {
  constructor(
    private readonly prisma: PrismaService,
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
  ): Promise<Prisma.OpportunityWhereInput> {
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
    const where = this.where(user, request, scope, range.start, range.end, scenario)
    const [value, amountAgg] = await Promise.all([
      this.prisma.opportunity.count({ where }),
      this.prisma.opportunity.aggregate({ where, _sum: { amount: true } }),
    ])
    const amount = Number(amountAgg._sum.amount ?? 0)
    if (!request.priorPeriodEnable) {
      return {
        count: { value, priorPeriodCompareRate: null } satisfies HomeStatisticValue,
        amount: { value: amount, priorPeriodCompareRate: null } satisfies HomeStatisticValue,
      }
    }

    const previousWhere = this.where(
      user,
      request,
      scope,
      range.previousStart,
      range.previousEnd,
      scenario,
    )
    const [previousValue, previousAmountAgg] = await Promise.all([
      this.prisma.opportunity.count({ where: previousWhere }),
      this.prisma.opportunity.aggregate({ where: previousWhere, _sum: { amount: true } }),
    ])
    const previousAmount = Number(previousAmountAgg._sum.amount ?? 0)
    return {
      count: { value, priorPeriodCompareRate: this.compare(value, previousValue) },
      amount: { value: amount, priorPeriodCompareRate: this.compare(amount, previousAmount) },
    }
  }

  private where(
    user: AuthUser,
    request: HomeStatisticRequest,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
    start: Date,
    end: Date,
    scenario: OpportunityScenario,
  ): Prisma.OpportunityWhereInput {
    const timeField = this.timeField(request, scenario)
    const timeFilter = this.timeFilter(timeField, start, end)
    const scopeFilter: Prisma.OpportunityWhereInput = scope.all
      ? {}
      : scope.self
        ? { owner: user.id }
        : scope.userIds?.length
          ? { owner: { in: scope.userIds } }
          : { owner: '__home_scope_empty__' }
    const stageFilter: Prisma.OpportunityWhereInput =
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

  private timeFilter(field: HomeTimeField, start: Date, end: Date): Prisma.OpportunityWhereInput {
    const range = { gte: BigInt(start.getTime()), lte: BigInt(end.getTime()) }
    if (field === 'CREATE_TIME') return { createTime: range }
    if (field === 'EXPECTED_END_TIME') return { expectedEndTime: range }
    return { actualEndTime: range }
  }

  private compare(value: number, previous: number) {
    return previous === 0 ? null : ((value - previous) * 100) / previous
  }
}
