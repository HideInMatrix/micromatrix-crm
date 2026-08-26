import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { HomeModule } from '../home/home.module'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { LeadsController } from './leads.controller'
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
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
