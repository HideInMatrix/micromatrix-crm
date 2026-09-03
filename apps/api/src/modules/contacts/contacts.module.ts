import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { AccountContactController } from './account-contact.controller'
import { ContactsService } from './contacts.service'

@Module({
  imports: [CustomersModule, UserViewsModule, ImportExportModule],
  controllers: [AccountContactController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
