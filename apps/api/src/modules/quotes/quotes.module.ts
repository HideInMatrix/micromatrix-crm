import { Module } from '@nestjs/common'
import { UserViewsModule } from '../user-views/user-views.module'
import { QuotationFieldsService } from './quotation-fields.service'
import { QuotesController } from './quotes.controller'
import { QuotesService } from './quotes.service'

@Module({
  imports: [UserViewsModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotationFieldsService],
  exports: [QuotesService, QuotationFieldsService],
})
export class QuotesModule {}
