import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma.module'
import { ModuleFormsModule } from '../metadata/module-forms.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { HomeAnalyticsService } from './home-analytics.service'
import { HomeClueStatisticQuery } from './home-clue-statistic.query'
import { HomeDepartmentScopeService } from './home-department-scope.service'
import { HomeFilterService } from './home-filter.service'
import { HomePeriodService } from './home-period.service'
import { HomeStatisticController } from './home-statistic.controller'
import { HomeStatisticService } from './home-statistic.service'

@Module({
  imports: [PrismaModule, ModuleFormsModule, PoolRulesModule],
  controllers: [HomeStatisticController],
  providers: [
    HomePeriodService,
    HomeDepartmentScopeService,
    HomeFilterService,
    HomeClueStatisticQuery,
    HomeAnalyticsService,
    HomeStatisticService,
  ],
  exports: [HomeFilterService],
})
export class HomeModule {}
