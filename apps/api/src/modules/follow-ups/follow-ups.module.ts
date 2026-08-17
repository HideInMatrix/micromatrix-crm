import { Module } from '@nestjs/common'
import { CustomersModule } from '../../customers/customers.module'
import { AttachmentsModule } from '../attachments/attachments.module'
import { FollowUpsController } from './follow-ups.controller'
import { FollowUpsService } from './follow-ups.service'

@Module({
  imports: [AttachmentsModule, CustomersModule],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
})
export class FollowUpsModule {}
