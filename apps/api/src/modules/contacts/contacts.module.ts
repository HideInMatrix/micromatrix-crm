import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './contacts.service'

@Module({
  imports: [CustomersModule, UserViewsModule, ImportExportModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
