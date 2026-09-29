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
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { LeadPoolSlaService } from '../pool-rules/lead-pool-sla.service'

@Injectable()
export class HomeFilterService {
  constructor(
    private readonly clues: HomeClueStatisticQuery,
    private readonly scopes: HomeDepartmentScopeService,
    private readonly leadSla: LeadPoolSlaService,
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
    if (
      candidate.period !== undefined &&
      !HOME_STATISTIC_PERIODS.includes(candidate.period as never)
    ) {
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
    if (candidate.leadStageKey !== undefined && typeof candidate.leadStageKey !== 'string') {
      throw new BadRequestException('首页阶段筛选无效')
    }
    if (candidate.converted !== undefined && typeof candidate.converted !== 'boolean') {
      throw new BadRequestException('首页转化筛选无效')
    }
    if (candidate.overdue !== undefined && typeof candidate.overdue !== 'boolean') {
      throw new BadRequestException('首页超时筛选无效')
    }
    if (
      candidate.filters !== undefined &&
      (!Array.isArray(candidate.filters) ||
        candidate.filters.length > 50 ||
        candidate.filters.some(
          (item) => !item || typeof item !== 'object' || Array.isArray(item),
        ))
    ) {
      throw new BadRequestException('首页附加筛选格式错误')
    }
    return candidate as unknown as HomeFilterPayload
  }

  async clueWhere(user: AuthUser, payload: HomeFilterPayload) {
    if (payload.module !== 'lead') throw new BadRequestException('首页筛选目标模块不匹配')
    if ((payload.userField ?? 'OWNER') !== 'OWNER') {
      throw new BadRequestException('创建人维度仅用于首页展示，不支持跳转线索列表')
    }
    const where = payload.period
      ? await this.clues.whereForPeriod(user, payload, payload.period)
      : await this.scopeOnlyWhere(user, payload, 'menu:lead')
    const result = {
      ...where,
      ...(payload.leadStageKey ? { stage: payload.leadStageKey } : {}),
      ...(payload.converted === true ? { converted: true } : {}),
    }
    if (!payload.overdue) return result
    const scope = await this.scopes.resolve(
      user,
      'menu:lead',
      payload.searchType,
      payload.deptIds ?? [],
    )
    const overdue = await this.leadSla.overdue(
      user.tenantId,
      scope.all ? null : (scope.userIds ?? []),
    )
    return { ...result, ids: overdue.map((item) => item.id) }
  }

  async customerWhere(user: AuthUser, payload: HomeFilterPayload) {
    if (payload.module !== 'customer') throw new BadRequestException('首页筛选目标模块不匹配')
    return this.scopeOnlyWhere(user, payload, 'menu:customer')
  }

  private async scopeOnlyWhere(
    user: AuthUser,
    payload: HomeFilterPayload,
    permission: string,
  ) {
    const scope = await this.scopes.resolve(
      user,
      permission,
      payload.searchType,
      payload.deptIds ?? [],
    )
    if (scope.all) return { organizationId: user.tenantId, inSharedPool: false }
    return {
      organizationId: user.tenantId,
      inSharedPool: false,
      owner: { in: scope.userIds ?? [] },
    }
  }
}
