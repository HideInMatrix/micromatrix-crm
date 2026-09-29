import { Module } from '@nestjs/common'
import { CustomersModule } from '../customers/customers.module'
import { ContactsModule } from '../modules/contacts/contacts.module'
import { CustomFormsModule } from '../modules/custom-forms/custom-forms.module'
import { ImportExportModule } from '../modules/import-export/import-export.module'
import { LeadsModule } from '../modules/leads/leads.module'
import { PrismaModule } from '../prisma.module.js'
import { ExportWorkerService } from './export-worker.service'

@Module({
  imports: [
    ImportExportModule,
    CustomersModule,
    ContactsModule,
    LeadsModule,
    CustomFormsModule,
    PrismaModule,
  ],
  providers: [ExportWorkerService],
})
export class ExportWorkerModule {}
