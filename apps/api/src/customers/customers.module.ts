import { Module } from '@nestjs/common'
import { PoolRulesModule } from '../modules/pool-rules/pool-rules.module'
import { UserViewsModule } from '../modules/user-views/user-views.module'
import { ImportExportModule } from '../modules/import-export/import-export.module'
import { DictionariesModule } from '../modules/dictionaries/dictionaries.module'
import { AccountCollaborationController } from './account-collaboration.controller'
import { AccountController } from './account.controller'
import { AccountOwnerHistoryController } from './account-owner-history.controller'
import { AccountRelationController } from './account-relation.controller'
import { CustomerAccessService } from './customer-access.service'
import { CustomersService } from './customers.service'
import { PoolAccountController } from './pool-account.controller'

@Module({
  imports: [PoolRulesModule, UserViewsModule, ImportExportModule, DictionariesModule],
  controllers: [
    AccountController,
    AccountCollaborationController,
    AccountRelationController,
    AccountOwnerHistoryController,
    PoolAccountController,
  ],
  providers: [CustomersService, CustomerAccessService],
  exports: [CustomerAccessService, CustomersService],
})
export class CustomersModule {}
