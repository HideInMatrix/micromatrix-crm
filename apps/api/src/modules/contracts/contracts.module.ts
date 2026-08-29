import { Module } from '@nestjs/common'
import { QuotesModule } from '../quotes/quotes.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { ContractController } from './contract.controller'
import { ContractFieldsService } from './contract-fields.service'
import { ContractStageController } from './contract-stage.controller'
import { ContractStageService } from './contract-stage.service'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { InvoicesService } from './invoices.service'
import { ReceivablesService } from './receivables.service'

@Module({
  imports: [QuotesModule, UserViewsModule],
  controllers: [ContractController, ContractsController, ContractStageController],
  providers: [
    ContractsService,
    ContractFieldsService,
    ContractStageService,
    ReceivablesService,
    InvoicesService,
  ],
  exports: [ContractsService, ContractStageService],
})
export class ContractsModule {}
