import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { Prisma8Module } from '../../prisma/prisma8.module'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { LarkExternalIdentitiesController, LarkSsoController } from './lark-sso.controller'
import { LarkSsoService } from './lark-sso.service'

@Module({
  imports: [AuthModule, Prisma8Module, EnterpriseIntegrationsModule],
  controllers: [LarkSsoController, LarkExternalIdentitiesController],
  providers: [LarkSsoService],
  exports: [LarkSsoService],
})
export class LarkSsoModule {}
