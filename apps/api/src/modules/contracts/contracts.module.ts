import { Module } from '@nestjs/common'
import { QuotesModule } from '../quotes/quotes.module'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { InvoicesService } from './invoices.service'
import { ReceivablesService } from './receivables.service'

@Module({
  imports: [QuotesModule],
  controllers: [ContractsController],
  providers: [ContractsService, ReceivablesService, InvoicesService],
  exports: [ContractsService],
})
export class ContractsModule {}
