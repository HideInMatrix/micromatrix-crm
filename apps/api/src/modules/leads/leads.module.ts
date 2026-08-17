import { Module } from '@nestjs/common'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { SavedViewsModule } from '../saved-views/saved-views.module'
import { LeadsController } from './leads.controller'
import { LeadsService } from './leads.service'

@Module({
  imports: [OpportunitiesModule, PoolRulesModule, SavedViewsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
