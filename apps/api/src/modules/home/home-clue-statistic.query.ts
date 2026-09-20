import { Injectable } from '@nestjs/common'
import type {
  HomeLeadStatistic,
  HomeStatisticPeriod,
  HomeStatisticRequest,
  HomeStatisticValue,
} from '@micromatrix/shared'
import { or } from '@prisma/orm-postgres/orm-client'
import type { AuthUser } from '../../common/auth-user'
import { PrismaService } from '../../prisma/prisma.service'

import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomePeriodService } from './home-period.service'

type HomeClueWhere = {
  organizationId?: string
  owner?: string | { in: string[] }
  createUser?: { in: string[] }
  createTime?: { gte: bigint; lte: bigint }
  inSharedPool?: boolean
  AND?: Array<HomeClueWhere | { OR: Array<{ transitionId: string | null }> }>
}

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
    const value = await this.countRange(user, request, scope, range.start, range.end)
    if (!request.priorPeriodEnable) return { value, priorPeriodCompareRate: null }
    const previous = await this.countRange(
      user,
      request,
      scope,
      range.previousStart,
      range.previousEnd,
    )
    return { value, priorPeriodCompareRate: this.compare(value, previous) }
  }

  private async countRange(
    user: AuthUser,
    request: HomeStatisticRequest,
    scope: Awaited<ReturnType<HomeDepartmentScopeService['resolve']>>,
    start: Date,
    end: Date,
  ): Promise<number> {
    const userField = request.userField ?? 'OWNER'
    if (!scope.all && !scope.self && (scope.userIds?.length ?? 0) === 0) return 0

    let query = this.prisma.client.orm.public.Clue.where({
      organizationId: user.tenantId,
      ...(userField === 'OWNER' ? { inSharedPool: false } : {}),
    })
      .where((row) => row.createTime.gte(BigInt(start.getTime())))
      .where((row) => row.createTime.lte(BigInt(end.getTime())))
      .where((row) => or(row.transitionId.isNull(), row.transitionId.eq('')))

    if (!scope.all) {
      if (scope.self) {
        query = query.where({ owner: user.id })
      } else if (userField === 'CREATE_USER') {
        query = query.where((row) => row.createUser.in(scope.userIds ?? []))
      } else {
        query = query.where((row) => row.owner.in(scope.userIds ?? []))
      }
    }

    const aggregate = await query.aggregate((agg) => ({ total: agg.count() }))
    return aggregate.total
  }

  async whereForPeriod(
    user: AuthUser,
    request: HomeStatisticRequest,
    period: HomeStatisticPeriod,
  ): Promise<HomeClueWhere> {
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
  ): HomeClueWhere {
    const userField = request.userField ?? 'OWNER'
    const identityFilter: HomeClueWhere = scope.all
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
