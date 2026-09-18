import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module.js'
import { UserViewsModule } from '../user-views/user-views.module'
import { QuotationFieldsService } from './quotation-fields.service'
import { QuotesController } from './quotes.controller'
import { QuotesService } from './quotes.service'

@Module({
  imports: [Prisma8Module, UserViewsModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuotationFieldsService],
  exports: [QuotesService, QuotationFieldsService],
})
export class QuotesModule {}
