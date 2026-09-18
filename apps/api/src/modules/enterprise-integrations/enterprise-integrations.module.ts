import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { EnterpriseIntegrationsController } from './enterprise-integrations.controller'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
import { DingTalkClient } from './dingtalk.client'
import { LarkClient } from './lark.client'
import { WeComClient } from './wecom.client'

@Module({
  imports: [Prisma8Module],
  controllers: [EnterpriseIntegrationsController],
  providers: [EnterpriseIntegrationsService, WeComClient, DingTalkClient, LarkClient],
  exports: [EnterpriseIntegrationsService, WeComClient, DingTalkClient, LarkClient],
})
export class EnterpriseIntegrationsModule {}
