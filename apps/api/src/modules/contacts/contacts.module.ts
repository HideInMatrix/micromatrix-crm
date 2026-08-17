import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { ImportExportModule } from '../import-export/import-export.module'
import { SavedViewsModule } from '../saved-views/saved-views.module'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './contacts.service'

@Module({
  imports: [CustomersModule, SavedViewsModule, ImportExportModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
