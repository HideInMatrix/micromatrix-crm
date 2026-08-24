import { Body, Controller, Get, Put } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AuthUser } from '../../common/auth-user'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import { LogOperation } from '../../common/decorators/log-operation.decorator'
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator'
import { SettingsService } from './settings.service'

@ApiTags('企业设置')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermissions('system:setting')
  @ApiOperation({ summary: '获取企业设置' })
  get(@CurrentUser() user: AuthUser) {
    return this.settingsService.getAll(user.tenantId)
  }

  @Put()
  @RequirePermissions('system:setting:update')
  @LogOperation('setting', 'update')
  @ApiOperation({ summary: '更新企业设置（key-value 批量）' })
  update(@CurrentUser() user: AuthUser, @Body() entries: Record<string, unknown>) {
    return this.settingsService.updateAll(user.tenantId, entries)
  }
}
