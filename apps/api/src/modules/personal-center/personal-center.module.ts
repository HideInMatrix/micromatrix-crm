import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { FollowUpPlansModule } from '../follow-up-plans/follow-up-plans.module'
import { PersonalApiKeyController } from './personal-api-key.controller'
import { PersonalApiKeyService } from './personal-api-key.service'
import { PersonalCenterController } from './personal-center.controller'
import { PersonalCenterService } from './personal-center.service'

@Module({
  imports: [AuthModule, FollowUpPlansModule, Prisma8Module],
  controllers: [PersonalCenterController, PersonalApiKeyController],
  providers: [PersonalCenterService, PersonalApiKeyService],
})
export class PersonalCenterModule {}
