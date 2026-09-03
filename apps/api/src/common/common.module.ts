import { Global, Module } from '@nestjs/common'
import { AuthContextCacheService } from './services/auth-context-cache.service'
import { DataScopeService } from './services/data-scope.service'
import { BusinessChangeLogService } from './services/business-change-log.service'
import { CredentialCipherService } from './services/credential-cipher.service'
import { ResourceAccessService } from './services/resource-access.service'
import { ScopeResolverService } from './services/scope-resolver.service'
import { TenantDerivedCacheService } from './services/tenant-derived-cache.service'

@Global()
@Module({
  providers: [
    AuthContextCacheService,
    DataScopeService,
    ScopeResolverService,
    ResourceAccessService,
    BusinessChangeLogService,
    CredentialCipherService,
    TenantDerivedCacheService,
  ],
  exports: [
    AuthContextCacheService,
    DataScopeService,
    ScopeResolverService,
    ResourceAccessService,
    BusinessChangeLogService,
    CredentialCipherService,
    TenantDerivedCacheService,
  ],
})
export class CommonModule {}
