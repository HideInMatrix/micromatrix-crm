import { Module } from '@nestjs/common'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { DingTalkOrganizationSyncController } from './dingtalk-organization-sync.controller'
import { OrganizationSyncController } from './organization-sync.controller'
import { OrganizationSyncCoordinationService } from './organization-sync-coordination.service'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'
import { OrganizationSyncPlanner } from './organization-sync.planner'
import { OrganizationSyncService } from './organization-sync.service'

@Module({
  imports: [EnterpriseIntegrationsModule],
  controllers: [OrganizationSyncController, DingTalkOrganizationSyncController],
  providers: [
    OrganizationSyncPlanner,
    OrganizationSyncCoordinationService,
    OrganizationSyncService,
    OrganizationSyncApplyService,
  ],
})
export class OrganizationSyncModule {}
