import { Module } from '@nestjs/common'
import { CredentialCipherService } from './credential-cipher.service'
import { EnterpriseIntegrationsController } from './enterprise-integrations.controller'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'
import { WeComClient } from './wecom.client'

@Module({
  controllers: [EnterpriseIntegrationsController],
  providers: [CredentialCipherService, EnterpriseIntegrationsService, WeComClient],
  exports: [EnterpriseIntegrationsService, WeComClient],
})
export class EnterpriseIntegrationsModule {}
