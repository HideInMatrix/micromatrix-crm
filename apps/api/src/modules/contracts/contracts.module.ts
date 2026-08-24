import { Module } from '@nestjs/common'
import { ContractsController } from './contracts.controller'
import { ContractsService } from './contracts.service'
import { InvoicesService } from './invoices.service'
import { ReceivablesService } from './receivables.service'

@Module({
  controllers: [ContractsController],
  providers: [ContractsService, ReceivablesService, InvoicesService],
  exports: [ContractsService],
})
export class ContractsModule {}
