import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { LarkExternalIdentitiesController, LarkSsoController } from './lark-sso.controller'
import { LarkSsoService } from './lark-sso.service'

@Module({
  imports: [AuthModule, EnterpriseIntegrationsModule],
  controllers: [LarkSsoController, LarkExternalIdentitiesController],
  providers: [LarkSsoService],
  exports: [LarkSsoService],
})
export class LarkSsoModule {}
