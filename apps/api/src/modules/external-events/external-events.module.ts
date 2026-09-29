import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { PrismaModule } from '../../prisma.module'
import { LeadsModule } from '../leads/leads.module'
import { ExternalEventsController } from './external-events.controller'
import { ExternalResourceResolverService } from './external-resource-resolver.service'
import { ExternalEventsService } from './external-events.service'

@Module({
  imports: [PrismaModule, CustomersModule, LeadsModule],
  controllers: [ExternalEventsController],
  providers: [ExternalResourceResolverService, ExternalEventsService],
})
export class ExternalEventsModule {}
