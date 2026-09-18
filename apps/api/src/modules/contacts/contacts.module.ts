import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { Prisma8Module } from '../../prisma/prisma8.module.js'
import { ImportExportModule } from '../import-export/import-export.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { AccountContactController } from './account-contact.controller'
import { ContactsService } from './contacts.service'

@Module({
  imports: [Prisma8Module, CustomersModule, UserViewsModule, ImportExportModule],
  controllers: [AccountContactController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
