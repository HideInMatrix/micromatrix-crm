import { Injectable, Optional } from '@nestjs/common'
import type { HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { TenantDerivedCacheService } from '../../common/services/tenant-derived-cache.service'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import { homeCacheUserContext } from './home-cache-context'
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomeOpportunityStatisticQuery } from './home-opportunity-statistic.query'

@Injectable()
export class HomeStatisticService {
  constructor(
    private readonly departments: HomeDepartmentScopeService,
    private readonly clues: HomeClueStatisticQuery,
    private readonly opportunities: HomeOpportunityStatisticQuery,
    @Optional() private readonly cache?: TenantDerivedCacheService,
  ) {}

  departmentTree(user: AuthUser) {
    return this.departments.tree(user)
  }

  lead(user: AuthUser, request: HomeStatisticRequest) {
    return this.remember(user, 'lead', request, () => this.clues.execute(user, request))
  }

  opportunity(user: AuthUser, request: HomeStatisticRequest) {
    return this.remember(user, 'opportunity', request, () =>
      this.opportunities.execute(user, request, 'ALL'),
    )
  }

  underwayOpportunity(user: AuthUser, request: HomeStatisticRequest) {
    return this.remember(user, 'opportunity-underway', request, () =>
      this.opportunities.execute(user, request, 'UNDERWAY'),
    )
  }

  successOpportunity(user: AuthUser, request: HomeStatisticRequest) {
    return this.remember(user, 'opportunity-success', request, () =>
      this.opportunities.execute(user, request, 'SUCCESS'),
    )
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
