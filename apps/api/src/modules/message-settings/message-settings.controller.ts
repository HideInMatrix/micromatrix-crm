import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import {
  BatchUpdateMessageTaskSettingDto,
  UpdateMessageTaskSettingDto,
} from './dto/message-setting.dto'
import { MessageSettingsService } from './message-settings.service'

@ApiTags('消息设置')
@ApiBearerAuth()
@Controller('message-settings')
export class MessageSettingsController {
  constructor(private readonly messageSettings: MessageSettingsService) {}

  @Get()
  @RequirePermissions('system:message')
  @ApiOperation({ summary: '获取消息事件设置' })
  list(@CurrentUser() user: AuthUser) {
    return this.messageSettings.list(user.tenantId)
  }

  @Post('batch')
  @RequirePermissions('system:message:update')
  @LogOperation('messageSetting', 'batchUpdate')
  @ApiOperation({ summary: '批量更新消息渠道开关' })
  batchUpdate(@CurrentUser() user: AuthUser, @Body() dto: BatchUpdateMessageTaskSettingDto) {
    return this.messageSettings.batchUpdate(user.tenantId, dto)
  }

  @Get(':event/config')
  @RequirePermissions('system:message')
  @ApiOperation({ summary: '获取事件范围配置' })
  getConfig(@CurrentUser() user: AuthUser, @Param('event') event: string) {
    return this.messageSettings.getConfig(user.tenantId, event)
  }

  @Patch(':event')
  @RequirePermissions('system:message:update')
  @LogOperation('messageSetting', 'update')
  @ApiOperation({ summary: '更新单个消息事件设置' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('event') event: string,
    @Body() dto: UpdateMessageTaskSettingDto,
  ) {
    return this.messageSettings.update(user.tenantId, event, dto)
  }
}
