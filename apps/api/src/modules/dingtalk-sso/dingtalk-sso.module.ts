import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import {
  DingTalkExternalIdentitiesController,
  DingTalkSsoController,
} from './dingtalk-sso.controller'
import { DingTalkSsoService } from './dingtalk-sso.service'

@Module({
  imports: [AuthModule, EnterpriseIntegrationsModule],
  controllers: [DingTalkSsoController, DingTalkExternalIdentitiesController],
  providers: [DingTalkSsoService],
  exports: [DingTalkSsoService],
})
export class DingTalkSsoModule {}
