import { Module } from '@nestjs/common'
import { DictionariesModule } from '../dictionaries/dictionaries.module'
import { HomeModule } from '../home/home.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { OpportunityStageController } from './opportunity-stage.controller'
import { OpportunityRuleController } from './opportunity-rule.controller'
import { OpportunityRuleService } from './opportunity-rule.service'
import { OpportunitiesController } from './opportunities.controller'
import { OpportunitiesService } from './opportunities.service'

@Module({
  imports: [HomeModule, UserViewsModule, ImportExportModule, DictionariesModule],
  controllers: [OpportunitiesController, OpportunityStageController, OpportunityRuleController],
  providers: [OpportunitiesService, OpportunityRuleService],
  exports: [OpportunitiesService],
})
export class OpportunitiesModule {}
