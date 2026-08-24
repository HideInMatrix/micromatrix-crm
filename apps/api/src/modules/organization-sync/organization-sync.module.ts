import { Module } from '@nestjs/common'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { OrganizationSyncController } from './organization-sync.controller'
import { OrganizationSyncApplyService } from './organization-sync-apply.service'
import { OrganizationSyncPlanner } from './organization-sync.planner'
import { OrganizationSyncService } from './organization-sync.service'

@Module({
  imports: [EnterpriseIntegrationsModule],
  controllers: [OrganizationSyncController],
  providers: [OrganizationSyncPlanner, OrganizationSyncService, OrganizationSyncApplyService],
})
export class OrganizationSyncModule {}
