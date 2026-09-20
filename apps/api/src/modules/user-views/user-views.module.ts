import { Module } from '@nestjs/common'
import { PrismaModule } from '../../prisma/prisma.module'
import {
  CluePoolUserViewsController,
  ClueUserViewsController,
  ContractPaymentPlanUserViewsController,
  ContractPaymentRecordUserViewsController,
  ContractInvoiceUserViewsController,
  ContractUserViewsController,
  FollowRecordUserViewsController,
  CustomerContactUserViewsController,
  CustomerPoolUserViewsController,
  CustomerUserViewsController,
  OpportunityQuotationUserViewsController,
  OpportunityUserViewsController,
  OrderUserViewsController,
} from './user-views.controller'
import { UserViewsService } from './user-views.service'

@Module({
  imports: [PrismaModule],
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
    OrderUserViewsController,
    FollowRecordUserViewsController,
  ],
  providers: [UserViewsService],
  exports: [UserViewsService],
})
export class UserViewsModule {}
