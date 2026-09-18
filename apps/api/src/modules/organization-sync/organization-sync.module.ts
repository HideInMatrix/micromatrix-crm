import { Module } from '@nestjs/common'
import { Prisma8Module } from '../../prisma/prisma8.module.js'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { DingTalkOrganizationSyncController } from './dingtalk-organization-sync.controller'
import { LarkOrganizationSyncController } from './lark-organization-sync.controller'
import { OrganizationSyncController } from './organization-sync.controller'
import { OrganizationSyncCoordinationService } from './organization-sync-coordination.service'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'
import { OrganizationSyncPlanner } from './organization-sync.planner'
import { OrganizationSyncService } from './organization-sync.service'

@Module({
  imports: [EnterpriseIntegrationsModule, Prisma8Module],
  controllers: [
    OrganizationSyncController,
    DingTalkOrganizationSyncController,
    LarkOrganizationSyncController,
  ],
  providers: [
    OrganizationSyncPlanner,
    OrganizationSyncCoordinationService,
    OrganizationSyncService,
    OrganizationSyncApplyService,
  ],
})
export class OrganizationSyncModule {}
