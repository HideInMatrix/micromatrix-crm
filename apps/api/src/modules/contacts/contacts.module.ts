import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { ContactsController } from './contacts.controller'
import { ContactsService } from './contacts.service'

@Module({
  imports: [CustomersModule],
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
