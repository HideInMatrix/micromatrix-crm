import { Module } from '@nestjs/common'
import { DashboardAccessService } from './dashboard-access.service'
import { DashboardModuleController } from './dashboard-module.controller'
import { DashboardModuleService } from './dashboard-module.service'
import { DashboardResourceController } from './dashboard-resource.controller'
import { DashboardResourceService } from './dashboard-resource.service'

@Module({
  controllers: [DashboardResourceController, DashboardModuleController],
  providers: [DashboardAccessService, DashboardResourceService, DashboardModuleService],
  exports: [DashboardResourceService, DashboardModuleService],
})
export class DashboardModule {}
