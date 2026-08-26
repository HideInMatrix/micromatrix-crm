import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  SaveEnterpriseAiModelDto,
  UpdateEnterpriseAiModelStatusDto,
  UpdateEnterpriseAiRouteStrategyDto,
} from './dto/ai-model.dto'
import { EnterpriseAiModelsService } from './enterprise-ai-models.service'

@ApiTags('企业设置 - 模型')
@ApiBearerAuth()
@Controller('enterprise-settings/models')
export class EnterpriseAiModelsController {
  constructor(private readonly models: EnterpriseAiModelsService) {}

  @Get()
  @RequirePermissions('system:setting')
  list(@CurrentUser() user: AuthUser, @Query('keyword') keyword?: string) {
    return this.models.list(user.tenantId, keyword)
  }

  @Get('options')
  @RequirePermissions('system:setting')
  options(@CurrentUser() user: AuthUser) {
    return this.models.options(user.tenantId)
  }

  @Get('route-strategy')
  @RequirePermissions('system:setting')
  route(@CurrentUser() user: AuthUser) {
    return this.models.getRouteStrategy(user.tenantId)
  }

  @Put('route-strategy')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-ai-model', 'update-route-strategy')
  updateRoute(@CurrentUser() user: AuthUser, @Body() input: UpdateEnterpriseAiRouteStrategyDto) {
    return this.models.updateRouteStrategy(user.tenantId, input.modelIds)
  }

  @Post()
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-ai-model', 'create')
  @ApiOperation({ summary: '新增 AI 模型' })
  create(@CurrentUser() user: AuthUser, @Body() input: SaveEnterpriseAiModelDto) {
    return this.models.create(user, input)
  }

  @Put(':id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-ai-model', 'update')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: SaveEnterpriseAiModelDto,
  ) {
    return this.models.update(user, id, input)
  }

  @Patch(':id/status')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-ai-model', 'update-status')
  status(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateEnterpriseAiModelStatusDto,
  ) {
    return this.models.setStatus(user.tenantId, id, input.enable)
  }

  @Delete(':id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-ai-model', 'delete')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.models.remove(user.tenantId, id)
  }
}
