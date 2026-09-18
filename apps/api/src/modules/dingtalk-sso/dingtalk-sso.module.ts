import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import {
  DingTalkExternalIdentitiesController,
  DingTalkSsoController,
} from './dingtalk-sso.controller'
import { DingTalkSsoService } from './dingtalk-sso.service'

@Module({
  imports: [AuthModule, Prisma8Module, EnterpriseIntegrationsModule],
  controllers: [DingTalkSsoController, DingTalkExternalIdentitiesController],
  providers: [DingTalkSsoService],
  exports: [DingTalkSsoService],
})
export class DingTalkSsoModule {}
