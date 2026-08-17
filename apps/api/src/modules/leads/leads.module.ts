import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { SavedViewsModule } from '../saved-views/saved-views.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { LeadsController } from './leads.controller'
import { LeadsService } from './leads.service'

@Module({
  imports: [CustomersModule, OpportunitiesModule, PoolRulesModule, SavedViewsModule, ImportExportModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
