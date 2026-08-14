import { Module } from '@nestjs/common'
import { AttachmentsModule } from '../attachments/attachments.module'
import { FollowUpsController } from './follow-ups.controller'
import { FollowUpsService } from './follow-ups.service'

@Module({
  imports: [AttachmentsModule],
  controllers: [FollowUpsController],
  providers: [FollowUpsService],
})
export class FollowUpsModule {}
