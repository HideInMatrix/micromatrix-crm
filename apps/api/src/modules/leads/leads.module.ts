import { Module } from '@nestjs/common'
import { OpportunitiesModule } from '../opportunities/opportunities.module'
import { LeadsController } from './leads.controller'
import { LeadsService } from './leads.service'

@Module({
  imports: [OpportunitiesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
