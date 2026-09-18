import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomeFilterService } from './home-filter.service'
import { HomeOpportunityStatisticQuery } from './home-opportunity-statistic.query'
import { HomeOverviewController } from './home-overview.controller'
import { HomeOverviewService } from './home-overview.service'
import { HomePeriodService } from './home-period.service'
import { HomeStatisticController } from './home-statistic.controller'
import { HomeStatisticService } from './home-statistic.service'

@Module({
  imports: [Prisma8Module],
  controllers: [HomeStatisticController, HomeOverviewController],
  providers: [
    HomePeriodService,
    HomeDepartmentScopeService,
    HomeFilterService,
    HomeClueStatisticQuery,
    HomeOpportunityStatisticQuery,
    HomeStatisticService,
    HomeOverviewService,
  ],
  exports: [HomeFilterService],
})
export class HomeModule {}
