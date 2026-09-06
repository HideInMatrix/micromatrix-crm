import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { AttachmentsModule } from '../attachments/attachments.module'
import { PoolRulesModule } from '../pool-rules/pool-rules.module'
import { UserViewsModule } from '../user-views/user-views.module'
import { FollowCommentsController } from './follow-comments.controller'
import { FollowCommentsService } from './follow-comments.service'
import { FollowUpsController } from './follow-ups.controller'
import { FollowUpsService } from './follow-ups.service'

@Module({
  imports: [CustomersModule, AttachmentsModule, PoolRulesModule, UserViewsModule],
  controllers: [FollowUpsController, FollowCommentsController],
  providers: [FollowUpsService, FollowCommentsService],
  exports: [FollowUpsService],
})
export class FollowUpsModule {}
