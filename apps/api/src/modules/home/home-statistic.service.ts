import { Injectable, Optional } from '@nestjs/common'
import type { HomeLeadSlaStatistic, HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { LeadPoolSlaService } from '../pool-rules/lead-pool-sla.service'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import { homeCacheUserContext } from './home-cache-context'
import { HomeDepartmentScopeService } from './home-department-scope.service'

@Injectable()
export class HomeStatisticService {
  constructor(
    private readonly departments: HomeDepartmentScopeService,
    private readonly clues: HomeClueStatisticQuery,
    private readonly leadSla: LeadPoolSlaService,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  departmentTree(user: AuthUser) {
    return this.departments.tree(user)
  }

  lead(user: AuthUser, request: HomeStatisticRequest) {
    return this.remember(user, 'lead', request, () => this.clues.execute(user, request))
  }

  overdueLead(user: AuthUser, request: HomeStatisticRequest) {
    return this.remember(user, 'lead-overdue', request, async (): Promise<HomeLeadSlaStatistic> => {
      const scope = await this.departments.resolve(
        user,
        'menu:lead',
        request.searchType,
        request.deptIds ?? [],
      )
      const ownerIds = scope.all ? null : (scope.userIds ?? [])
      const overdue = await this.leadSla.overdue(user.tenantId, ownerIds)
      return { overdueClue: overdue.length }
    })
  }

  private remember<T>(
    user: AuthUser,
    method: string,
    request: HomeStatisticRequest,
    loader: () => Promise<T>,
  ): Promise<T> {
    if (!this.cache) return loader()
    const key = this.cache.fingerprint({
      method,
      user: homeCacheUserContext(user),
      request: { ...request, deptIds: [...(request.deptIds ?? [])].sort() },
    })
    return this.cache.remember({
      tenantId: user.tenantId,
      namespace: 'home-statistic',
      key,
      ttlSeconds: 30,
      versioned: false,
      loader,
    })
  }
}
