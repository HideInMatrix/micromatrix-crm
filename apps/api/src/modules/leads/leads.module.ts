import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { HomeModule } from '../home/home.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { ClueCapacityController } from './clue-capacity.controller'
import { ClueController } from './clue.controller'
import { ClueOwnerHistoryController } from './clue-owner-history.controller'
import { CluePoolConfigController } from './clue-pool-config.controller'
import { CluePoolConfigService } from './clue-pool-config.service'
import { PoolClueController } from './pool-clue.controller'
import { LeadsService } from './leads.service'

@Module({
  imports: [
    CustomersModule,
    HomeModule,
    OpportunitiesModule,
    PoolRulesModule,
    UserViewsModule,
    ImportExportModule,
  ],
  controllers: [
    ClueController,
    PoolClueController,
    CluePoolConfigController,
    ClueCapacityController,
    ClueOwnerHistoryController,
  ],
  providers: [LeadsService, CluePoolConfigService],
})
export class LeadsModule {}
