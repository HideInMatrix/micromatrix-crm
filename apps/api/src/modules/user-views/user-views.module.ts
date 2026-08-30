import { Module } from '@nestjs/common'
import {
  CluePoolUserViewsController,
  ClueUserViewsController,
  ContractPaymentPlanUserViewsController,
  ContractPaymentRecordUserViewsController,
  ContractInvoiceUserViewsController,
  ContractUserViewsController,
  CustomerContactUserViewsController,
  CustomerPoolUserViewsController,
  CustomerUserViewsController,
  OpportunityQuotationUserViewsController,
  OpportunityUserViewsController,
} from './user-views.controller'
import { UserViewsService } from './user-views.service'

@Module({
  controllers: [
    ClueUserViewsController,
    CluePoolUserViewsController,
    CustomerUserViewsController,
    CustomerContactUserViewsController,
    CustomerPoolUserViewsController,
    OpportunityUserViewsController,
    OpportunityQuotationUserViewsController,
    ContractUserViewsController,
    ContractPaymentPlanUserViewsController,
    ContractPaymentRecordUserViewsController,
    ContractInvoiceUserViewsController,
  ],
  providers: [UserViewsService],
  exports: [UserViewsService],
})
export class UserViewsModule {}
