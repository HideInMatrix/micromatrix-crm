import { Module } from '@nestjs/common'
import { EnterpriseIntegrationsController } from './enterprise-integrations.controller'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
import { DingTalkClient } from './dingtalk.client'
import { LarkClient } from './lark.client'
import { WeComClient } from './wecom.client'

@Module({
  controllers: [EnterpriseIntegrationsController],
  providers: [EnterpriseIntegrationsService, WeComClient, DingTalkClient, LarkClient],
  exports: [EnterpriseIntegrationsService, WeComClient, DingTalkClient, LarkClient],
})
export class EnterpriseIntegrationsModule {}
