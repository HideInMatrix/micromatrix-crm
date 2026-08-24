import { Body, Controller, Get, Header, Post, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { SaveWeComIntegrationDto } from './dto/wecom-integration.dto'
import { EnterpriseIntegrationsService } from './enterprise-integrations.service'

@ApiTags('企业集成')
@ApiBearerAuth()
@Controller('enterprise-integrations')
export class EnterpriseIntegrationsController {
  constructor(private readonly integrations: EnterpriseIntegrationsService) {}

  @Get('wecom')
  @RequirePermissions('system:setting')
  @ApiOperation({ summary: '获取企业微信配置状态（不返回密钥）' })
  getWeCom(@CurrentUser() user: AuthUser) {
    return this.integrations.getWeCom(user.tenantId)
  }

  @Get('wecom/secret')
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterpriseIntegration', 'viewWeComSecret')
  @ApiOperation({ summary: '查看企业微信应用 Secret（仅配置管理员）' })
  getWeComSecret(@CurrentUser() user: AuthUser) {
    return this.integrations.getWeComSecret(user.tenantId)
  }

  @Put('wecom')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterpriseIntegration', 'updateWeCom')
  @ApiOperation({ summary: '保存企业微信配置' })
  saveWeCom(@CurrentUser() user: AuthUser, @Body() dto: SaveWeComIntegrationDto) {
    return this.integrations.saveWeCom(user, dto)
  }

  @Post('wecom/test')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterpriseIntegration', 'testWeCom')
  @ApiOperation({ summary: '测试并保存企业微信配置状态' })
  testWeCom(@CurrentUser() user: AuthUser, @Body() dto: SaveWeComIntegrationDto) {
    return this.integrations.testWeCom(user, dto)
  }
}
