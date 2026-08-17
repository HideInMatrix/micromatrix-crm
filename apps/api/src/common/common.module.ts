import { Global, Module } from '@nestjs/common'
import { DataScopeService } from './services/data-scope.service'
import { BusinessChangeLogService } from './services/business-change-log.service'
import { ResourceAccessService } from './services/resource-access.service'
import { ScopeResolverService } from './services/scope-resolver.service'

@Global()
@Module({
  providers: [
    DataScopeService,
    ScopeResolverService,
    ResourceAccessService,
    BusinessChangeLogService,
  ],
  exports: [DataScopeService, ScopeResolverService, ResourceAccessService, BusinessChangeLogService],
})
export class CommonModule {}
