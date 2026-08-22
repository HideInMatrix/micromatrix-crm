import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { FollowUpPlansController } from './follow-up-plans.controller'
import { FollowUpPlansService } from './follow-up-plans.service'

@Module({
  imports: [CustomersModule, PoolRulesModule],
  controllers: [FollowUpPlansController],
  providers: [FollowUpPlansService],
  exports: [FollowUpPlansService],
})
export class FollowUpPlansModule {}
