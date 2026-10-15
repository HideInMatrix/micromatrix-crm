import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { PrismaModule } from '../../prisma.module'
import { LeadsModule } from '../leads/leads.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { ExternalEventsController } from './external-events.controller'
import { ExternalEventTemplatesController } from './external-event-templates.controller'
import { ExternalEventTemplatesService } from './external-event-templates.service'
import { ExternalResourceResolverService } from './external-resource-resolver.service'
import { ExternalEventsService } from './external-events.service'

@Module({
  imports: [PrismaModule, CustomersModule, LeadsModule, PoolRulesModule],
  controllers: [ExternalEventsController, ExternalEventTemplatesController],
  providers: [
    ExternalResourceResolverService,
    ExternalEventTemplatesService,
    ExternalEventsService,
  ],
})
export class ExternalEventsModule {}
