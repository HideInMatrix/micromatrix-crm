import { Module } from '@nestjs/common'
import { AuthModule } from '../../auth/auth.module'
import { PrismaModule } from '../../prisma/prisma.module'
import { EnterpriseIntegrationsModule } from '../enterprise-integrations/enterprise-integrations.module'
import { ExternalIdentitiesController, WeComSsoController } from './wecom-sso.controller'
import { WeComSsoService } from './wecom-sso.service'

@Module({
  imports: [AuthModule, PrismaModule, EnterpriseIntegrationsModule],
  controllers: [WeComSsoController, ExternalIdentitiesController],
  providers: [WeComSsoService],
  exports: [WeComSsoService],
})
export class WeComSsoModule {}
