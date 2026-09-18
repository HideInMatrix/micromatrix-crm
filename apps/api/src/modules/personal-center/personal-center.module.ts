import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { FollowUpPlansModule } from '../follow-up-plans/follow-up-plans.module'
import { PersonalApiKeyController } from './personal-api-key.controller'
import { PersonalApiKeyService } from './personal-api-key.service'
import { PersonalCenterController } from './personal-center.controller'
import { PersonalCenterService } from './personal-center.service'

@Module({
  imports: [AuthModule, FollowUpPlansModule, PrismaModule],
  controllers: [PersonalCenterController, PersonalApiKeyController],
  providers: [PersonalCenterService, PersonalApiKeyService],
})
export class PersonalCenterModule {}
