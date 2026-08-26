import { Injectable } from '@nestjs/common'
import type { HomeStatisticRequest } from '@micromatrix/shared'
import type { AuthUser } from '../../common/auth-user'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomeOpportunityStatisticQuery } from './home-opportunity-statistic.query'

@Injectable()
export class HomeStatisticService {
  constructor(
    private readonly departments: HomeDepartmentScopeService,
    private readonly clues: HomeClueStatisticQuery,
    private readonly opportunities: HomeOpportunityStatisticQuery,
  ) {}

  departmentTree(user: AuthUser) {
    return this.departments.tree(user)
  }

  lead(user: AuthUser, request: HomeStatisticRequest) {
    return this.clues.execute(user, request)
  }

  opportunity(user: AuthUser, request: HomeStatisticRequest) {
    return this.opportunities.execute(user, request, 'ALL')
  }

  underwayOpportunity(user: AuthUser, request: HomeStatisticRequest) {
    return this.opportunities.execute(user, request, 'UNDERWAY')
  }

  successOpportunity(user: AuthUser, request: HomeStatisticRequest) {
    return this.opportunities.execute(user, request, 'SUCCESS')
  }
}
