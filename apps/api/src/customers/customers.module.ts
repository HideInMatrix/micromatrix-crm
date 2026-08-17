import { Module } from '@nestjs/common'
import { PoolRulesModule } from '../modules/pool-rules/pool-rules.module'
import { SavedViewsModule } from '../modules/saved-views/saved-views.module'
import { ImportExportModule } from '../modules/import-export/import-export.module'
import { CustomerAccessService } from './customer-access.service'
import { CustomersController } from './customers.controller'
import { CustomersService } from './customers.service'

@Module({
  imports: [PoolRulesModule, SavedViewsModule, ImportExportModule],
  controllers: [CustomersController],
  providers: [CustomersService, CustomerAccessService],
  exports: [CustomerAccessService, CustomersService],
})
export class CustomersModule {}
