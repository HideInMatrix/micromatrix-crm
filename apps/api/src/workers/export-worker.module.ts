import { Module } from '@nestjs/common'
import { CustomersModule } from '../customers/customers.module'
import { ContactsModule } from '../modules/contacts/contacts.module'
import { ContractsModule } from '../modules/contracts/contracts.module'
import { CustomFormsModule } from '../modules/custom-forms/custom-forms.module'
import { ImportExportModule } from '../modules/import-export/import-export.module'
import { LeadsModule } from '../modules/leads/leads.module'
import { OpportunitiesModule } from '../modules/opportunities/opportunities.module'
import { OrdersModule } from '../modules/orders/orders.module'
import { ProductsModule } from '../modules/products/products.module'
import { PrismaModule } from '../prisma/prisma.module.js'
import { ExportWorkerService } from './export-worker.service'

@Module({
  imports: [
    ImportExportModule,
    CustomersModule,
    ContactsModule,
    LeadsModule,
    OpportunitiesModule,
    ProductsModule,
    ContractsModule,
    OrdersModule,
    CustomFormsModule,
    PrismaModule,
  ],
  providers: [ExportWorkerService],
})
export class ExportWorkerModule {}
