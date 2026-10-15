import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import type { ExternalEventTemplateInput } from '@micromatrix/shared'
import {
  PreviewExternalEventDto,
  SaveExternalEventTemplateDto,
  UpdateExternalEventTemplateDto,
} from './dto/external-event-template.dto'
import { ExternalEventTemplatesService } from './external-event-templates.service'

@ApiTags('外部事件配置')
@ApiBearerAuth()
@Controller('external-event-templates')
export class ExternalEventTemplatesController {
  constructor(private readonly templates: ExternalEventTemplatesService) {}

  @Get()
  @RequirePermissions('system:setting')
  @ApiOperation({ summary: '外部事件模板列表' })
  list(@CurrentUser() user: AuthUser) {
    return this.templates.list(user)
  }

  @Get(':id')
  @RequirePermissions('system:setting')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.get(user, id)
  }

  @Post()
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'create-external-event')
  create(@CurrentUser() user: AuthUser, @Body() input: SaveExternalEventTemplateDto) {
    return this.templates.create(user, input as ExternalEventTemplateInput)
  }

  @Patch(':id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'update-external-event')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() input: UpdateExternalEventTemplateDto,
  ) {
    return this.templates.update(user, id, input)
  }

  @Delete(':id')
  @RequirePermissions('system:setting:update')
  @LogOperation('enterprise-setting', 'delete-external-event')
  delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.delete(user, id)
  }

  @Post(':id/preview')
  @RequirePermissions('system:setting:update')
  @ApiOperation({ summary: '仅校验事件资源定位与字段映射，不写入数据' })
  preview(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: PreviewExternalEventDto,
  ) {
    return this.templates.preview(user, id, body.data)
  }

  @Get(':id/logs')
  @RequirePermissions('system:setting')
  logs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.templates.logs(user, id)
  }
}
