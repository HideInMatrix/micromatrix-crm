import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { FollowPlanCommentsController } from './follow-plan-comments.controller'
import { FollowPlanCommentsService } from './follow-plan-comments.service'
import { FollowUpPlansController } from './follow-up-plans.controller'
import { FollowUpPlansService } from './follow-up-plans.service'

@Module({
  imports: [CustomersModule, PoolRulesModule, Prisma8Module],
  controllers: [FollowUpPlansController, FollowPlanCommentsController],
  providers: [FollowUpPlansService, FollowPlanCommentsService],
  exports: [FollowUpPlansService],
})
export class FollowUpPlansModule {}
