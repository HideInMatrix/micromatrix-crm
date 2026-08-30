import { Module } from '@nestjs/common'
import { OrdersModule } from '../orders/orders.module'
import { QuotesModule } from '../quotes/quotes.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { ContractController } from './contract.controller'
import { ContractFieldsService } from './contract-fields.service'
import {
  ContractPaymentPlanController,
  ContractPaymentRecordController,
} from './contract-payment.controller'
import {
  ContractPaymentPlanService,
  ContractPaymentRecordService,
} from './contract-payment.service'
import { ContractStageController } from './contract-stage.controller'
import { ContractStageService } from './contract-stage.service'
import {
  BusinessTitleConfigController,
  BusinessTitleController,
  ContractInvoiceController,
  ContractInvoiceDetailController,
  ApprovalResourceController,
} from './contract-invoice.controller'
import { ContractInvoiceService } from './contract-invoice.service'
import { BusinessTitleService } from './business-title.service'
import { ContractsService } from './contracts.service'

@Module({
  imports: [QuotesModule, OrdersModule, UserViewsModule, ImportExportModule],
  controllers: [
    ContractController,
    ContractStageController,
    ContractPaymentPlanController,
    ContractPaymentRecordController,
    ContractInvoiceController,
    ContractInvoiceDetailController,
    ApprovalResourceController,
    BusinessTitleController,
    BusinessTitleConfigController,
  ],
  providers: [
    ContractsService,
    ContractFieldsService,
    ContractStageService,
    ContractPaymentPlanService,
    ContractPaymentRecordService,
    ContractInvoiceService,
    BusinessTitleService,
  ],
  exports: [
    ContractsService,
    ContractStageService,
    ContractPaymentPlanService,
    ContractPaymentRecordService,
    ContractInvoiceService,
    BusinessTitleService,
  ],
})
export class ContractsModule {}
