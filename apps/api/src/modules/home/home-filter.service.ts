import { BadRequestException, Injectable } from '@nestjs/common'
import {
  HOME_SEARCH_TYPES,
  HOME_STATISTIC_PERIODS,
  HOME_TIME_FIELDS,
  HOME_USER_FIELDS,
  type HomeFilterModule,
  type HomeFilterPayload,
} from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import { HomeOpportunityStatisticQuery } from './home-opportunity-statistic.query'

@Injectable()
export class HomeFilterService {
  constructor(
    private readonly clues: HomeClueStatisticQuery,
    private readonly opportunities: HomeOpportunityStatisticQuery,
  ) {}

  parse(raw: string | undefined, expectedModule: HomeFilterModule): HomeFilterPayload | null {
    if (!raw) return null
    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new BadRequestException('首页筛选格式错误')
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('首页筛选格式错误')
    }
    const candidate = value as Record<string, unknown>
    if (candidate.module !== expectedModule) throw new BadRequestException('首页筛选目标模块不匹配')
    if (!HOME_STATISTIC_PERIODS.includes(candidate.period as never)) {
      throw new BadRequestException('首页筛选周期无效')
    }
    if (!HOME_SEARCH_TYPES.includes(candidate.searchType as never)) {
      throw new BadRequestException('首页筛选范围无效')
    }
    if (
      !Array.isArray(candidate.deptIds) ||
      candidate.deptIds.some((id) => typeof id !== 'string')
    ) {
      throw new BadRequestException('首页筛选部门格式错误')
    }
    if (
      candidate.userField !== undefined &&
      !HOME_USER_FIELDS.includes(candidate.userField as never)
    ) {
      throw new BadRequestException('首页筛选用户字段无效')
    }
    if (
      candidate.timeField !== undefined &&
      !HOME_TIME_FIELDS.includes(candidate.timeField as never)
    ) {
      throw new BadRequestException('首页筛选时间字段无效')
    }
    if (
      candidate.status !== undefined &&
      candidate.status !== 'AFOOT' &&
      candidate.status !== 'SUCCESS'
    ) {
      throw new BadRequestException('首页筛选状态无效')
    }
    return candidate as unknown as HomeFilterPayload
  }

  clueWhere(user: AuthUser, payload: HomeFilterPayload) {
    if (payload.module !== 'lead') throw new BadRequestException('首页筛选目标模块不匹配')
    if ((payload.userField ?? 'OWNER') !== 'OWNER') {
      throw new BadRequestException('创建人维度仅用于首页展示，不支持跳转线索列表')
    }
    return this.clues.whereForPeriod(user, payload, payload.period)
  }

  opportunityWhere(user: AuthUser, payload: HomeFilterPayload) {
    if (payload.module !== 'opportunity') throw new BadRequestException('首页筛选目标模块不匹配')
    const scenario =
      payload.status === 'SUCCESS' ? 'SUCCESS' : payload.status === 'AFOOT' ? 'UNDERWAY' : 'ALL'
    return this.opportunities.whereForPeriod(user, payload, payload.period, scenario)
  }
}
