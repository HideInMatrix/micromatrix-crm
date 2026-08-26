import { Injectable } from '@nestjs/common'
import type {
  HomeLeadStatistic,
  HomeStatisticPeriod,
  HomeStatisticRequest,
  HomeStatisticValue,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomePeriodService } from './home-period.service'

const PERIOD_KEY: Record<HomeStatisticPeriod, keyof HomeLeadStatistic> = {
  TODAY: 'todayClue',
  THIS_WEEK: 'thisWeekClue',
  THIS_MONTH: 'thisMonthClue',
  THIS_YEAR: 'thisYearClue',
}

@Injectable()
export class HomeClueStatisticQuery {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopes: HomeDepartmentScopeService,
    private readonly periods: HomePeriodService,
  ) {}

  async execute(user: AuthUser, request: HomeStatisticRequest): Promise<HomeLeadStatistic> {
    const result = {} as HomeLeadStatistic
    await Promise.all(
      (Object.keys(PERIOD_KEY) as HomeStatisticPeriod[]).map(async (period) => {
        result[PERIOD_KEY[period]] = await this.periodValue(user, request, period)
      }),
    )
    return result
  }

  private async periodValue(
    user: AuthUser,
    request: HomeStatisticRequest,
    period: HomeStatisticPeriod,
  ): Promise<HomeStatisticValue> {
    const scope = await this.scopes.resolve(
      user,
      'menu:lead',
      request.searchType,
      request.deptIds ?? [],
    )
    const range = this.periods.range(period)
    const where = this.where(user, request, scope, range.start, range.end)
    const value = await this.prisma.clue.count({ where })
    if (!request.priorPeriodEnable) return { value, priorPeriodCompareRate: null }
    const previousWhere = this.where(user, request, scope, range.previousStart, range.previousEnd)
    const previous = await this.prisma.clue.count({ where: previousWhere })
    return { value, priorPeriodCompareRate: this.compare(value, previous) }
  }

  async whereForPeriod(
    user: AuthUser,
    request: HomeStatisticRequest,
    period: HomeStatisticPeriod,
  ): Promise<Prisma.ClueWhereInput> {
    const scope = await this.scopes.resolve(
      user,
      'menu:lead',
      request.searchType,
      request.deptIds ?? [],
    )
    const range = this.periods.range(period)
    return this.where(user, request, scope, range.start, range.end)
  }

  private where(
    user: AuthUser,
    request: HomeStatisticRequest,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
    start: Date,
    end: Date,
  ): Prisma.ClueWhereInput {
    const userField = request.userField ?? 'OWNER'
    const identityFilter: Prisma.ClueWhereInput = scope.all
      ? {}
      : scope.self
        ? { owner: user.id }
        : userField === 'CREATE_USER'
          ? { createUser: { in: scope.userIds ?? [] } }
          : { owner: { in: scope.userIds ?? [] } }
    return {
      organizationId: user.tenantId,
      createTime: { gte: BigInt(start.getTime()), lte: BigInt(end.getTime()) },
      ...(userField === 'OWNER' ? { inSharedPool: false } : {}),
      AND: [identityFilter, { OR: [{ transitionId: null }, { transitionId: '' }] }],
    }
  }

  private compare(value: number, previous: number) {
    return previous === 0 ? null : ((value - previous) * 100) / previous
  }
}
